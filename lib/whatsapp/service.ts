// ============================================================
// The ONE centralized WhatsApp messaging service. Every place that
// needs to send a WhatsApp message — customer creation, service
// application, the agent→employee application notice, customer status
// changes, the daily agent payment reminder job, a manual retry —
// calls sendWhatsAppMessage() from here. Nothing else touches Baileys
// directly or duplicates template-loading/variable-replacement logic.
//
// Critically: this function NEVER throws. It always resolves to a
// result object. A CRM operation (creating a customer, applying a
// service, changing a status) calls this and moves on regardless of
// what happened to the WhatsApp message — that's what "WhatsApp must
// never block core CRM operations" means at the code level.
//
// Message lifecycle: a WhatsAppMessage row is created as QUEUED
// BEFORE anything is attempted, then updated to SENT or FAILED
// afterward — so if the process crashes mid-send there is still a
// database record proving an attempt was made.
//
// Idempotency: callers may pass a `dedupeKey`. The database allows only
// one message per key, so the same event (double request, retry of the
// API call, repeated save) can never notify twice.
// ============================================================

import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber, toWhatsAppJid } from "./phone";
import { isWhatsAppConnected, isNumberOnWhatsApp, sendWhatsAppText } from "./baileysClient";
import { renderTemplate, TemplateVars } from "./render";
import { DEFAULT_TEMPLATES, SharedTemplateType } from "./defaultTemplates";

type TemplateType = SharedTemplateType | "APPLICATION_STATUS_CHANGED";
type RecipientType = "CUSTOMER" | "AGENT" | "EMPLOYEE";

export type SendResult =
  | { sent: true; messageId: string }
  | { sent: false; messageId: string; reason: string; duplicate?: boolean };

function maskNumber(n: string | null | undefined) {
  if (!n) return "(none)";
  return n.length > 4 ? `${"*".repeat(n.length - 4)}${n.slice(-4)}` : n;
}

// Primary number if marked as WhatsApp, else alternate if marked, else
// don't attempt at all. Never blindly sends to every number a customer
// has on file.
export function resolveCustomerWhatsAppNumber(customer: {
  mobile: string;
  mobileIsWhatsapp: boolean;
  altMobile: string | null;
  altMobileIsWhatsapp: boolean;
}): string | null {
  if (customer.mobileIsWhatsapp) return customer.mobile;
  if (customer.altMobile && customer.altMobileIsWhatsapp) return customer.altMobile;
  return null;
}

type SendParams = {
  templateType: TemplateType;
  recipientType: RecipientType;
  toNumberRaw: string;
  variables: TemplateVars;
  customerId?: string;
  agentId?: string;
  employeeId?: string;
  customerServiceId?: string;
  // Status notifications pass their own (per-status) template body.
  templateBody?: string;
  dedupeKey?: string;
};

// The single send entry point. `toNumberRaw` is the number as stored
// in our own data (not yet normalized) — this function owns
// normalization so callers never have to think about it.
export async function sendWhatsAppMessage(params: SendParams): Promise<SendResult> {
  try {
    return await sendInternal(params);
  } catch (e: any) {
    // Truly never throws: whatever went wrong, the caller's CRM
    // operation must not be affected.
    console.error("[WhatsApp] Unexpected error in sendWhatsAppMessage:", e?.message);
    return { sent: false, messageId: "", reason: e?.message || "Unexpected WhatsApp error" };
  }
}

async function sendInternal(params: SendParams): Promise<SendResult> {
  console.log(`[WhatsApp] Notification triggered: ${params.templateType} (${params.recipientType})`);

  if (params.dedupeKey) {
    const dup = await prisma.whatsAppMessage.findUnique({ where: { dedupeKey: params.dedupeKey }, select: { id: true } });
    if (dup) {
      console.log("[WhatsApp] Duplicate notification skipped (dedupe key already used)");
      return { sent: false, messageId: dup.id, reason: "Duplicate notification skipped", duplicate: true };
    }
  }

  const normalized = normalizePhoneNumber(params.toNumberRaw);
  console.log(`[WhatsApp] Number selected: ${maskNumber(params.toNumberRaw)} -> normalized ${maskNumber(normalized)}`);

  if (!normalized) {
    console.warn("[WhatsApp] Invalid phone number — recording failed message without attempting send");
    return recordImmediateFailure(params, params.toNumberRaw, "", "Invalid phone number");
  }

  console.log(`[WhatsApp] Loading template: ${params.templateType}`);
  let templateBody = params.templateBody;
  if (!templateBody && params.templateType !== "APPLICATION_STATUS_CHANGED") {
    const template = await prisma.whatsAppTemplate.findUnique({ where: { type: params.templateType } });
    templateBody = template?.body ?? DEFAULT_TEMPLATES[params.templateType];
  }
  if (!templateBody) {
    console.warn(`[WhatsApp] No template configured for ${params.templateType} — recording failed message`);
    return recordImmediateFailure(params, normalized, "", "No template configured for this notification type");
  }

  const body = renderTemplate(templateBody, params.variables);
  if (!body) {
    return recordImmediateFailure(params, normalized, "", "Template produced an empty message");
  }
  console.log(`[WhatsApp] Placeholders replaced — message length ${body.length} chars`);

  // Create the QUEUED record BEFORE attempting anything.
  let record;
  try {
    record = await prisma.whatsAppMessage.create({
      data: {
        templateType: params.templateType,
        recipientType: params.recipientType,
        toNumber: normalized,
        body,
        status: "QUEUED",
        customerId: params.customerId,
        agentId: params.agentId,
        employeeId: params.employeeId,
        customerServiceId: params.customerServiceId,
        dedupeKey: params.dedupeKey,
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002" && params.dedupeKey) {
      // Lost a race against an identical concurrent request.
      return { sent: false, messageId: "", reason: "Duplicate notification skipped", duplicate: true };
    }
    throw e;
  }
  console.log(`[WhatsApp] Message record created (QUEUED): ${record.id}`);

  if (!isWhatsAppConnected()) {
    console.warn("[WhatsApp] Not connected — marking message as FAILED");
    return finalizeFailure(record.id, "WhatsApp is disconnected");
  }

  const jid = toWhatsAppJid(normalized);

  const registered = await isNumberOnWhatsApp(jid);
  if (!registered) {
    console.warn("[WhatsApp] Number not registered on WhatsApp — marking message as FAILED");
    return finalizeFailure(record.id, "This number is not registered on WhatsApp");
  }

  console.log("[WhatsApp] Attempting send. Message type:", params.templateType, "Target JID:", maskNumber(jid));
  try {
    await sendWhatsAppText(jid, body);
    return await finalizeSuccess(record.id);
  } catch (e: any) {
    console.error("[WhatsApp] Send failed:", e?.message);
    return finalizeFailure(record.id, e?.message || "WhatsApp connection error while sending");
  }
}

async function finalizeSuccess(messageId: string): Promise<SendResult> {
  await prisma.whatsAppMessage.update({
    where: { id: messageId },
    data: { status: "SENT", sentAt: new Date() },
  });
  console.log(`[WhatsApp] Message ${messageId} marked SENT`);
  return { sent: true, messageId };
}

async function finalizeFailure(messageId: string, reason: string): Promise<SendResult> {
  await prisma.whatsAppMessage.update({
    where: { id: messageId },
    data: { status: "FAILED", failureReason: reason },
  });
  console.log(`[WhatsApp] Message ${messageId} marked FAILED: ${reason}`);
  return { sent: false, messageId, reason };
}

// For failures that happen before a QUEUED record can even be created
// meaningfully (invalid number, missing template) — still creates a
// FAILED record directly, so nothing is ever silently dropped.
async function recordImmediateFailure(params: SendParams, toNumber: string, body: string, reason: string): Promise<SendResult> {
  try {
    const record = await prisma.whatsAppMessage.create({
      data: {
        templateType: params.templateType,
        recipientType: params.recipientType,
        toNumber,
        body,
        status: "FAILED",
        failureReason: reason,
        customerId: params.customerId,
        agentId: params.agentId,
        employeeId: params.employeeId,
        customerServiceId: params.customerServiceId,
        dedupeKey: params.dedupeKey,
      },
    });
    console.log(`[WhatsApp] Message ${record.id} recorded as FAILED (pre-send): ${reason}`);
    return { sent: false, messageId: record.id, reason };
  } catch (e: any) {
    if (e?.code === "P2002") return { sent: false, messageId: "", reason: "Duplicate notification skipped", duplicate: true };
    throw e;
  }
}

// True if this message, or any retry descended from it, already got SENT.
async function chainAlreadySent(messageId: string): Promise<boolean> {
  const queue = [messageId];
  for (let i = 0; i < 50 && queue.length > 0; i++) {
    const id = queue.shift()!;
    const msgs = await prisma.whatsAppMessage.findMany({
      where: { OR: [{ id }, { retryOfId: id }] },
      select: { id: true, status: true, retryOfId: true },
    });
    for (const m of msgs) {
      if (m.status === "SENT") return true;
      if (m.id !== id) queue.push(m.id);
    }
  }
  return false;
}

// Retries a previously failed message, optionally with a corrected
// number. Creates a NEW WhatsAppMessage row linked via retryOfId —
// the original failed row is never modified or deleted, preserving
// the complete attempt history. Refuses to resend something that
// already went out (no accidental duplicate messages).
export async function retryWhatsAppMessage(originalId: string, correctedNumberRaw?: string): Promise<SendResult> {
  console.log(`[WhatsApp] Retry requested for message ${originalId}`);
  const original = await prisma.whatsAppMessage.findUnique({ where: { id: originalId } });
  if (!original) {
    throw new Error("Original message not found");
  }
  if (original.status !== "FAILED") {
    throw new Error("Only a failed message can be retried");
  }
  if (await chainAlreadySent(original.id)) {
    throw new Error("This message was already delivered by an earlier retry");
  }

  const toNumberRaw = correctedNumberRaw || original.toNumber;
  const normalized = normalizePhoneNumber(toNumberRaw);

  async function createRetryRecord(status: "QUEUED" | "SENT" | "FAILED", extra: Record<string, unknown> = {}) {
    return prisma.whatsAppMessage.create({
      data: {
        templateType: original!.templateType,
        recipientType: original!.recipientType,
        toNumber: normalized ?? toNumberRaw,
        body: original!.body,
        status,
        attemptNumber: original!.attemptNumber + 1,
        retryOfId: original!.id,
        customerId: original!.customerId ?? undefined,
        agentId: original!.agentId ?? undefined,
        employeeId: original!.employeeId ?? undefined,
        customerServiceId: original!.customerServiceId ?? undefined,
        ...extra,
      },
    });
  }

  if (!normalized) {
    const record = await createRetryRecord("FAILED", { failureReason: "Invalid phone number" });
    return { sent: false, messageId: record.id, reason: "Invalid phone number" };
  }

  const record = await createRetryRecord("QUEUED");
  console.log(`[WhatsApp] Retry message record created (QUEUED): ${record.id}, attempt #${record.attemptNumber}`);

  if (!isWhatsAppConnected()) {
    return finalizeFailure(record.id, "WhatsApp is disconnected");
  }

  const jid = toWhatsAppJid(normalized);
  const registered = await isNumberOnWhatsApp(jid);
  if (!registered) {
    return finalizeFailure(record.id, "This number is not registered on WhatsApp");
  }

  console.log("[WhatsApp] Attempting resend. Target JID:", maskNumber(jid));
  try {
    await sendWhatsAppText(jid, original.body);
    return await finalizeSuccess(record.id);
  } catch (e: any) {
    console.error("[WhatsApp] Resend failed:", e?.message);
    return finalizeFailure(record.id, e?.message || "WhatsApp connection error while sending");
  }
}
