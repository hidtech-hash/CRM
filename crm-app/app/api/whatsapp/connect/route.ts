import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { connectWhatsApp } from "@/lib/whatsapp/baileysClient";

// POST /api/whatsapp/connect
// Starts (or restarts) the ONE shared Baileys connection. Admin/
// Manager/Employee only — Agents cannot reach this route at all
// (outside the AGENT middleware allowlist), and this check is the
// server-side enforcement for everyone else too, not just a hidden
// button.
export async function POST() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Fire-and-await the start; the actual QR/connected state arrives
    // asynchronously via connection.update and is picked up by the
    // frontend polling /api/whatsapp/status right after this returns.
    connectWhatsApp().catch((e) => console.error("[WhatsApp] Connect error:", e?.message));
    return NextResponse.json({ started: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not start WhatsApp connection" }, { status: 500 });
  }
}
