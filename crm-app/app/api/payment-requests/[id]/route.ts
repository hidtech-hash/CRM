import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canVerifyPayments } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { allocatePaymentToAgentWork, roundMoney } from "@/lib/agentContext";
import { z } from "zod";

const verifySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), verifiedAmount: z.number().positive() }),
  z.object({ action: z.literal("REJECT"), rejectionReason: z.string().min(1).optional() }),
]);

// PUT /api/payment-requests/:id
// Admin/Manager only. This is the ONLY place an agent's received/
// pending balance changes as a result of a payment request. The
// agent never supplies an amount (see the agent-portal submit route
// — there is no amount field there at all); the Manager checks the
// actual UTR/screenshot and enters what was really received here.
//
// On APPROVE: verifiedAmount is recorded, and immediately allocated
// across the agent's outstanding applications (oldest first) so
// per-application payment status and the agent's aggregate totals
// never disagree.
// On REJECT: nothing about the agent's balance changes at all.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canVerifyPayments(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const existing = await prisma.agentPaymentRequest.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "PENDING_VERIFICATION") {
    return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "APPROVE") {
    const verifiedAmount = roundMoney(parsed.data.verifiedAmount);

    // Approval + allocation in ONE transaction, guarded by a
    // compare-and-set on the request status: if two people click
    // Approve at once only one wins (the other gets a 409), and if the
    // allocation fails the approval rolls back with it — the request can
    // never end up APPROVED with the agent's balance untouched, nor be
    // credited twice.
    let result;
    try {
      result = await prisma.$transaction(
        async (tx) => {
          const claimed = await tx.agentPaymentRequest.updateMany({
            where: { id: params.id, status: "PENDING_VERIFICATION" },
            data: { status: "APPROVED", verifiedAmount, verifiedById: userId, verifiedAt: new Date() },
          });
          if (claimed.count === 0) throw new Error("ALREADY_DECIDED");
          const allocation = await allocatePaymentToAgentWork(existing.agentId, verifiedAmount, tx);
          const updated = await tx.agentPaymentRequest.findUniqueOrThrow({ where: { id: params.id } });
          return { updated, allocation };
        },
        { timeout: 20000 }
      );
    } catch (e: any) {
      if (e?.message === "ALREADY_DECIDED") {
        return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
      }
      console.error("[payment approve] failed:", e?.message);
      return NextResponse.json({ error: "Could not approve this payment. Nothing was changed." }, { status: 500 });
    }

    await logActivity({
      userId,
      action: "AGENT_PAYMENT_APPROVED",
      entityType: "AgentPaymentRequest",
      entityId: result.updated.id,
      newValue: {
        agentId: existing.agentId,
        verifiedAmount,
        allocated: result.allocation.allocated,
        // Anything above the agent's outstanding dues is not applied to
        // any application; recorded here so it is never silently lost.
        unallocated: result.allocation.unallocated,
      },
    });

    return NextResponse.json({ request: result.updated, allocation: result.allocation });
  } else {
    const claimed = await prisma.agentPaymentRequest.updateMany({
      where: { id: params.id, status: "PENDING_VERIFICATION" },
      data: {
        status: "REJECTED",
        rejectionReason: parsed.data.rejectionReason || null,
        verifiedById: userId,
        verifiedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.agentPaymentRequest.findUniqueOrThrow({ where: { id: params.id } });

    await logActivity({
      userId,
      action: "AGENT_PAYMENT_REJECTED",
      entityType: "AgentPaymentRequest",
      entityId: updated.id,
      newValue: { agentId: existing.agentId, reason: parsed.data.rejectionReason },
    });

    return NextResponse.json({ request: updated });
  }
}
