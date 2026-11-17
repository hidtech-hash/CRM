// Next.js runs `register()` exactly once, when the server process
// starts — the officially supported place to kick off background
// work like a cron scheduler or restoring a persistent connection,
// as opposed to doing it inside an API route (which would run again
// on every request/hot-reload in dev, and has no "server just
// started" hook of its own).
//
// This only runs in the actual Node server runtime, never in the
// Edge runtime or in the browser.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { restoreWhatsAppConnectionIfConfigured } = await import("./lib/whatsapp/baileysClient");
  const { startAgentPaymentReminderScheduler } = await import("./lib/whatsapp/scheduler");

  await restoreWhatsAppConnectionIfConfigured();
  startAgentPaymentReminderScheduler();
}
