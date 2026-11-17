import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAgentRole } from "@/lib/auth";
import { getAgentForUser } from "@/lib/agentContext";
import { generateAgentPendingPaymentUPILink } from "@/lib/upi";
import QRCode from "qrcode";

// GET /api/agent-portal/qr
// AGENT role only. Generates a UPI QR (and the raw deep-link URI, for
// the "Pay Through UPI App" button) for this agent's CURRENT pending
// amount, computed fresh on the server every time this is called —
// the agent cannot influence the amount in any way. Uses
// generateAgentPendingPaymentUPILink (lib/upi.ts) — the SAME function
// the WhatsApp Agent Payment Reminder uses, so the two can never
// disagree about the link. If pending is 0, no QR/link is generated.
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAgentRole(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = (session.user as any).id as string;
  const agent = await getAgentForUser(userId);
  if (!agent) {
    return NextResponse.json({ error: "No agent profile is linked to this login" }, { status: 404 });
  }

  const link = await generateAgentPendingPaymentUPILink(agent);
  if (link.pending <= 0) {
    return NextResponse.json({ pending: 0, qr: null, uri: null });
  }
  if (!link.uri) {
    // Pending amount exists, but no UPI has been configured yet —
    // distinct from "no pending" so the UI can say so specifically.
    return NextResponse.json({ pending: link.pending, qr: null, uri: null, error: "UPI not configured yet" });
  }

  const dataUrl = await QRCode.toDataURL(link.uri, { width: 320, margin: 1 });
  return NextResponse.json({ pending: link.pending, qr: dataUrl, uri: link.uri });
}
