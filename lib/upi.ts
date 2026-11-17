import QRCode from "qrcode";

// Builds a standard UPI deep-link URI. Any UPI app (GPay, PhonePe,
// Paytm, etc.) recognizes this scheme and pre-fills the payee and
// amount — the payer still confirms in their own app, we're not
// touching money directly.
export function buildUpiUri(params: { upiId: string; payeeName?: string | null; amount: number; note?: string }) {
  const qs = new URLSearchParams({
    pa: params.upiId,
    pn: params.payeeName || "Business",
    am: params.amount.toFixed(2),
    cu: "INR",
    tn: params.note || "Agent payment",
  });
  return `upi://pay?${qs.toString()}`;
}

// Renders the UPI URI as a PNG data URL (server-side), so the amount
// baked into the QR is always whatever the server just computed —
// the agent's browser never gets a chance to alter it before it's
// encoded.
export async function generateUpiQrDataUrl(params: { upiId: string; payeeName?: string | null; amount: number; note?: string }) {
  const uri = buildUpiUri(params);
  const dataUrl = await QRCode.toDataURL(uri, { width: 320, margin: 1 });
  return { uri, dataUrl };
}

// The ONE place an agent's pending-payment UPI link is generated —
// used by both the Agent Dashboard's "Pay Through UPI App" button
// (via /api/agent-portal/qr) and the WhatsApp Agent Payment Reminder
// (lib/whatsapp/scheduler.ts). Both call this exact function, so
// there is no possibility of the two ever disagreeing about the UPI
// ID, payee name, or amount. Reuses the same balance calculation as
// everywhere else (lib/agentContext.ts) — never a second calculation.
// Always returns the current pending amount; `uri` is null when
// there's nothing to pay (pending <= 0) or no UPI has been
// configured yet — callers distinguish those two cases by checking
// `pending` first, same as the Agent Dashboard already does.
export async function generateAgentPendingPaymentUPILink(
  agent: { id: string; agentCode: string }
): Promise<{ pending: number; uri: string | null }> {
  // Imported lazily to avoid a circular import at module load time
  // (agentContext.ts doesn't import this file, but keeping the
  // dependency direction explicit and lazy here is cheap insurance).
  const { getAgentBalance } = await import("./agentContext");
  const { prisma } = await import("./prisma");

  const balance = await getAgentBalance(agent.id);
  if (balance.pending <= 0) return { pending: 0, uri: null };

  const config = await prisma.upiConfig.findFirst({ where: { isActive: true }, orderBy: { updatedAt: "desc" } });
  if (!config) return { pending: balance.pending, uri: null };

  const uri = buildUpiUri({
    upiId: config.upiId,
    payeeName: config.payeeName,
    amount: balance.pending,
    note: `${agent.agentCode} pending payment`,
  });

  return { pending: balance.pending, uri };
}
