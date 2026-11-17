// ============================================================
// Daily Agent Payment Reminder job. Scheduled once at server
// startup (see instrumentation.ts) via node-cron, running inside
// the same long-lived Node process as everything else — no separate
// worker/queue infrastructure needed for a job that only needs to
// run once a day.
// ============================================================

import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { getAllAgentsBalances } from "@/lib/agentContext";
import { generateAgentPendingPaymentUPILink } from "@/lib/upi";
import { sendWhatsAppMessage } from "./service";

const PENDING_DAYS_THRESHOLD = 7; // "more than 7 days" — 8+ triggers a reminder

let started = false;

// Runs the actual reminder pass. Exported separately from the cron
// registration so it can also be triggered manually (e.g. a "Send
// Reminders Now" admin action, or for testing) without waiting for
// the schedule.
export async function runAgentPaymentReminders() {
  const agents = await prisma.agent.findMany({ where: { deletedAt: null, status: "ACTIVE" } });
  const balances = await getAllAgentsBalances();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let sent = 0;
  let skipped = 0;

  for (const agent of agents) {
    const balance = balances[agent.id];
    if (!balance) continue;
    const pending = Math.max(0, balance.total - balance.received);
    if (pending <= 0 || !balance.oldestUnpaidAcceptedAt) continue;

    const daysPending = Math.floor(
      (Date.now() - new Date(balance.oldestUnpaidAcceptedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysPending <= PENDING_DAYS_THRESHOLD) continue;

    // Duplicate prevention: has a reminder already gone out today for
    // this agent? Tracked by querying the message log itself —
    // reusing the existing table rather than a separate "reminders
    // sent" tracker.
    // Only a reminder that actually went out (or is in flight) counts:
    // a FAILED attempt must not suppress the later retry pass today.
    const alreadySentToday = await prisma.whatsAppMessage.findFirst({
      where: {
        templateType: "AGENT_PAYMENT_REMINDER",
        agentId: agent.id,
        status: { in: ["QUEUED", "SENT"] },
        createdAt: { gte: startOfToday },
      },
    });
    if (alreadySentToday) {
      skipped++;
      continue;
    }

    const link = await generateAgentPendingPaymentUPILink(agent);
    if (!link.uri) continue; // no UPI configured — nothing to send a link for

    const result = await sendWhatsAppMessage({
      templateType: "AGENT_PAYMENT_REMINDER",
      recipientType: "AGENT",
      toNumberRaw: agent.mobile,
      agentId: agent.id,
      variables: {
        AGENT_NAME: agent.name,
        AGENT_ID: agent.agentCode,
        ENTERPRISE_NAME: agent.enterpriseName || agent.name,
        PENDING_AMOUNT: pending.toLocaleString("en-IN"),
        PENDING_DAYS: String(daysPending),
        UPI_LINK: link.uri,
      },
    });
    if (result.sent) sent++;
  }

  return { checked: agents.length, sent, skipped };
}

// Registers the daily cron job exactly once per server process.
// Runs at 10:00 and again at 16:00 server time every day. The second
// pass only matters for agents whose morning reminder FAILED (e.g.
// WhatsApp was disconnected) — agents who already received one today
// are skipped by the duplicate check, so nobody gets two.
export function startAgentPaymentReminderScheduler() {
  if (started) return;
  started = true;
  cron.schedule("0 10,16 * * *", () => {
    runAgentPaymentReminders().catch((e) => {
      console.error("[whatsapp] agent payment reminder job failed:", e?.message);
    });
  });
}
