import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions, canManageUsers, canActOnUserRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { updateUserSchema, SAFE_USER_SELECT, fieldErrorMessage } from "@/lib/validation/user";
import { allocateEmployeeCode } from "@/lib/employeeCode";

async function loadTarget(id: string, actorRole: string) {
  const target = await prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
  if (!target) return null;
  // An actor can only open accounts they may see (agents are never here).
  const visible = actorRole === "ADMIN" ? ["ADMIN", "MANAGER", "EMPLOYEE"] : ["EMPLOYEE"];
  return visible.includes(target.role) ? target : null;
}

// GET /api/users/:id — full user details (never the password hash).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await loadTarget(params.id, role);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user: { ...user, manageable: canActOnUserRole(role, user.role) } });
}

// PUT /api/users/:id — edit profile, change role (Admin only),
// activate/deactivate, or reset the password. Users are deactivated,
// never deleted (their history — activity log, assigned work, WhatsApp
// messages — must stay attached to a real record).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actorId = (session.user as any).id as string;

  const target = await loadTarget(params.id, role);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authorization on the TARGET account's role, server-side.
  if (!canActOnUserRole(role, target.role) || target.id === actorId) {
    return NextResponse.json({ error: "You are not allowed to modify this account" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: fieldErrorMessage(parsed.error), details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Role changes: Admin only, and only to a role Admin may manage.
  if (data.role !== undefined && data.role !== target.role) {
    if (role !== "ADMIN" || !canActOnUserRole(role, data.role)) {
      return NextResponse.json({ error: "You are not allowed to change roles" }, { status: 403 });
    }
  }

  if (data.loginId !== undefined && data.loginId.toLowerCase() !== target.email.toLowerCase()) {
    const clash = await prisma.user.findFirst({
      where: { email: { equals: data.loginId, mode: "insensitive" }, NOT: { id: target.id } },
      select: { id: true },
    });
    if (clash) return NextResponse.json({ error: "That login ID is already in use" }, { status: 409 });
  }
  if (data.mobile !== undefined && data.mobile !== target.mobile) {
    const clash = await prisma.user.findUnique({ where: { mobile: data.mobile }, select: { id: true } });
    if (clash && clash.id !== target.id) {
      return NextResponse.json({ error: "That mobile number is already used by another user" }, { status: 409 });
    }
  }

  if (data.contactEmail && data.contactEmail.toLowerCase() !== (target.contactEmail ?? "").toLowerCase()) {
    const emailClash = await prisma.user.findFirst({
      where: { contactEmail: { equals: data.contactEmail, mode: "insensitive" }, NOT: { id: target.id } },
      select: { id: true },
    });
    if (emailClash) return NextResponse.json({ error: "That email address is already used by another user" }, { status: 409 });
  }

  const update: Record<string, any> = {};
  if (data.fullName !== undefined) update.name = data.fullName;
  if (data.role !== undefined) update.role = data.role;
  if (data.loginId !== undefined) update.email = data.loginId;
  if (data.mobile !== undefined) update.mobile = data.mobile;
  if (data.mobileIsWhatsapp !== undefined) update.mobileIsWhatsapp = data.mobileIsWhatsapp;
  if (data.dateOfJoining !== undefined) update.dateOfJoining = data.dateOfJoining ? new Date(data.dateOfJoining) : null;
  if (data.isActive !== undefined) update.isActive = data.isActive;
  for (const k of ["contactEmail", "address", "state", "district", "tehsil"] as const) {
    if (data[k] !== undefined) update[k] = data[k] === "" ? null : data[k];
  }
  if (data.password !== undefined) update.passwordHash = await bcrypt.hash(data.password, 12);

  try {
    // Employee ID is never taken from the request. It is only ever
    // assigned (once) by the server — e.g. when a Manager is changed to
    // Employee and has no ID yet — and is kept if the role changes later.
    const user = await prisma.$transaction(async (tx) => {
      const becomingEmployee = (data.role ?? target.role) === "EMPLOYEE" && !target.employeeCode;
      if (becomingEmployee) update.employeeCode = await allocateEmployeeCode(tx);
      return tx.user.update({ where: { id: target.id }, data: update, select: SAFE_USER_SELECT });
    });

    await logActivity({
      userId: actorId,
      action: data.password !== undefined ? "USER_PASSWORD_RESET" : data.isActive !== undefined && data.isActive !== target.isActive ? (data.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED") : "USER_UPDATED",
      entityType: "User",
      entityId: user.id,
      // Never log the password or its hash.
      previousValue: { name: target.name, role: target.role, isActive: target.isActive, mobile: target.mobile },
      newValue: {
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        mobile: user.mobile,
        passwordReset: data.password !== undefined,
      },
    });

    return NextResponse.json({ user });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "That login ID or mobile number is already in use" }, { status: 409 });
    }
    throw e;
  }
}
