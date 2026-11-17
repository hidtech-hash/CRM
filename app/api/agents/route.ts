import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageAgents } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextAgentCode } from "@/lib/codes";
import { logActivity } from "@/lib/activityLog";
import { getAllAgentsBalances } from "@/lib/agentContext";
import bcrypt from "bcryptjs";
import { z } from "zod";

// GET /api/agents?search=raj
// Each agent in the list now also carries `pendingPayment` and
// `pendingSinceDays` (null if no due) — computed from the same
// ledger-based calculation used everywhere else (lib/agentContext.ts),
// never from anything the frontend supplies.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";

  const where = {
    deletedAt: null,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { enterpriseName: { contains: search, mode: "insensitive" as const } },
            { mobile: { contains: search } },
            { agentCode: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [agents, balances] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { customerServices: true } },
        user: { select: { email: true, isActive: true } },
      },
    }),
    getAllAgentsBalances(),
  ]);

  const now = Date.now();
  const enriched = agents.map((a) => {
    const b = balances[a.id];
    const pendingPayment = b ? Math.max(0, b.total - b.received) : 0;
    const pendingSinceDays =
      pendingPayment > 0 && b?.oldestUnpaidAcceptedAt
        ? Math.floor((now - new Date(b.oldestUnpaidAcceptedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
    return { ...a, pendingPayment, pendingSinceDays };
  });

  return NextResponse.json({ agents: enriched });
}

const createAgentSchema = z.object({
  name: z.string().trim().min(2),
  // Mandatory — whitespace-only does not count.
  enterpriseName: z.string().trim().min(1, "Enterprise Name is required"),
  mobile: z.string().trim().min(10).max(15),
  altMobile: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  notes: z.string().optional(),
  // Optional: create a portal login for this agent at the same time.
  createLogin: z.boolean().optional(),
  loginId: z.string().trim().toLowerCase().min(3).optional(),
  password: z.string().min(6).optional(),
});

// POST /api/agents
// No commission fields — agents simply get the fixed "agent price"
// defined per service (see /api/services). Enterprise Name is
// mandatory (server-side, not just in the form) — an agent cannot be
// created without one. Optionally also creates a portal login
// (role=AGENT) linked 1:1 to this agent record.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageAgents(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const userId = (session.user as any).id as string;

  if (data.createLogin) {
    if (!data.loginId || !data.password) {
      return NextResponse.json(
        { error: "loginId and password are required to create a login" },
        { status: 400 }
      );
    }
    // Login IDs are shared with Manager/Employee logins; compare
    // case-insensitively so "Rahul01" and "rahul01" can't both exist.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: data.loginId, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json({ error: "That login ID is already in use" }, { status: 409 });
    }
  }

  // Duplicate agent registration: the same mobile number must not be
  // registered twice (agents that were deleted don't count).
  const duplicateAgent = await prisma.agent.findFirst({
    where: { mobile: data.mobile, deletedAt: null },
    select: { agentCode: true, name: true },
  });
  if (duplicateAgent) {
    return NextResponse.json(
      { error: `An agent with this mobile number already exists (${duplicateAgent.agentCode} — ${duplicateAgent.name})` },
      { status: 409 }
    );
  }

  const passwordHash = data.createLogin && data.password ? await bcrypt.hash(data.password, 10) : null;

  // The agent code is generated just before the insert; if two agents
  // are created at the same instant and collide, the unique constraint
  // rejects the loser and we simply take the next free code.
  let agent: Awaited<ReturnType<typeof createAgentOnce>> | null = null;
  for (let attempt = 0; attempt < 3 && !agent; attempt++) {
    try {
      agent = await createAgentOnce(await nextAgentCode());
    } catch (e: any) {
      const target = String(e?.meta?.target ?? "");
      if (e?.code === "P2002" && target.includes("agentCode") && attempt < 2) continue;
      if (e?.code === "P2002" && target.includes("email")) {
        return NextResponse.json({ error: "That login ID is already in use" }, { status: 409 });
      }
      throw e;
    }
  }
  if (!agent) return NextResponse.json({ error: "Could not allocate an agent ID. Please try again." }, { status: 500 });

  function createAgentOnce(agentCode: string) {
    // Agent profile + (optional) login are created together, linked 1:1
    // through Agent.userId — all or nothing.
    return prisma.$transaction(async (tx) => {
      let newUserId: string | undefined;
      if (data.createLogin && data.loginId && passwordHash) {
        const newUser = await tx.user.create({
          data: {
            name: data.name,
            email: data.loginId,
            passwordHash,
            role: "AGENT",
          },
        });
        newUserId = newUser.id;
      }

      return tx.agent.create({
        data: {
          agentCode,
          name: data.name,
          enterpriseName: data.enterpriseName,
          mobile: data.mobile,
          altMobile: data.altMobile || null,
          email: data.email || null,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          notes: data.notes || null,
          createdById: userId,
          userId: newUserId,
        },
      });
    });
  }

  await logActivity({
    userId,
    action: "AGENT_CREATED",
    entityType: "Agent",
    entityId: agent.id,
    newValue: { agentCode: agent.agentCode, name: agent.name, enterpriseName: agent.enterpriseName, loginCreated: !!data.createLogin },
  });

  return NextResponse.json({ agent }, { status: 201 });
}
