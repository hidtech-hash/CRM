import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions, canManageUsers, canActOnUserRole, manageableUserRoles } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { createUserSchema, SAFE_USER_SELECT, fieldErrorMessage } from "@/lib/validation/user";
import { allocateEmployeeCode } from "@/lib/employeeCode";

// Which roles' accounts each actor may SEE in this list. Agent logins are
// managed from the Agents module, not here.
function visibleRoles(actorRole: string): string[] {
  if (actorRole === "ADMIN") return ["ADMIN", "MANAGER", "EMPLOYEE"];
  if (actorRole === "MANAGER") return ["EMPLOYEE"];
  return [];
}

// GET /api/users?search=&role=&status=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const roleFilter = searchParams.get("role");
  const status = searchParams.get("status");

  const roles = visibleRoles(role).filter((r) => !roleFilter || roleFilter === r);
  const users = await prisma.user.findMany({
    where: {
      role: { in: roles as any },
      ...(status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { mobile: { contains: search } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: SAFE_USER_SELECT,
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: 500,
  });

  return NextResponse.json({
    users: users.map((u) => ({ ...u, manageable: canActOnUserRole(role, u.role) })),
    creatableRoles: manageableUserRoles(role),
  });
}

// POST /api/users — create a Manager or Employee login with profile.
// Admin: Manager + Employee. Manager: Employee only. Enforced here, not
// just by hiding options in the form.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actorId = (session.user as any).id as string;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: fieldErrorMessage(parsed.error), details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (!canActOnUserRole(role, data.role)) {
    return NextResponse.json({ error: `You are not allowed to create ${data.role} accounts` }, { status: 403 });
  }

  // Login ID is stored in User.email and is shared with agent logins,
  // so check against every account (case-insensitively).
  const loginClash = await prisma.user.findFirst({
    where: { email: { equals: data.loginId, mode: "insensitive" } },
    select: { id: true },
  });
  if (loginClash) return NextResponse.json({ error: "That login ID is already in use" }, { status: 409 });

  const mobileClash = await prisma.user.findUnique({ where: { mobile: data.mobile }, select: { id: true } });
  if (mobileClash) return NextResponse.json({ error: "That mobile number is already used by another user" }, { status: 409 });

  if (data.contactEmail) {
    const emailClash = await prisma.user.findFirst({
      where: { contactEmail: { equals: data.contactEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (emailClash) return NextResponse.json({ error: "That email address is already used by another user" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  try {
    // Employee ID is allocated on the server, inside the same transaction
    // as the user insert (concurrency-safe, no gaps if the insert fails).
    const user = await prisma.$transaction(async (tx) => {
      const employeeCode = data.role === "EMPLOYEE" ? await allocateEmployeeCode(tx) : null;
      return tx.user.create({
        data: {
          name: data.fullName,
          email: data.loginId,
          passwordHash,
          role: data.role,
          isActive: data.isActive ?? true,
          mobile: data.mobile,
          mobileIsWhatsapp: data.mobileIsWhatsapp ?? false,
          employeeCode,
          dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : null,
          contactEmail: data.contactEmail || null,
          address: data.address || null,
          state: data.state || null,
          district: data.district || null,
          tehsil: data.tehsil || null,
        },
        select: SAFE_USER_SELECT,
      });
    });

    await logActivity({
      userId: actorId,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      newValue: { name: user.name, loginId: user.email, role: user.role, employeeCode: user.employeeCode },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "That login ID or mobile number is already in use" }, { status: 409 });
    }
    throw e;
  }
}
