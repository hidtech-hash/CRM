import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { disconnectWhatsApp } from "@/lib/whatsapp/baileysClient";

// POST /api/whatsapp/disconnect
// Explicit user-initiated disconnect + session clear. A fresh
// Connect afterward requires a new QR scan.
export async function POST() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await disconnectWhatsApp();
  return NextResponse.json({ disconnected: true });
}
