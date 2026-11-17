import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { getWhatsAppStatus } from "@/lib/whatsapp/baileysClient";

// GET /api/whatsapp/status
// Polled by the WhatsApp Configuration page while a QR is being
// scanned or a connection is settling. Returns status metadata only —
// never anything resembling the actual session credentials.
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = await getWhatsAppStatus();
  return NextResponse.json(status);
}
