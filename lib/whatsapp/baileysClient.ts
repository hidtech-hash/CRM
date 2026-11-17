// ============================================================
// Single shared Baileys/WhatsApp connection for the entire CRM.
//
// IMPORTANT — a plain `let sock = null` at module scope is NOT
// sufficient to guarantee a true singleton in Next.js. Different API
// route handlers can end up bundled as separate module instances
// (this is exactly why lib/prisma.ts anchors its client to
// `globalThis` instead of a plain module-level variable — Next.js
// hot-reload and per-route bundling can otherwise create more than
// one PrismaClient). This module follows that exact same pattern for
// the same reason: without it, `/api/whatsapp/connect` can end up
// setting a `sock` that other routes (like customer creation) never
// see, so they read `sock` as still null and silently report
// "disconnected" even though the connect call itself succeeded.
// `globalThis` is shared across every module instance in the same
// Node process, which is what actually guarantees "one connection".
//
// Auth/session credentials are persisted to a local folder via
// Baileys' own `useMultiFileAuthState` — never written to the
// database, never returned by any API response. Only connection
// *status* (see WhatsAppConfig) is exposed to the frontend.
// ============================================================

import path from "path";
import { mkdir, rm } from "fs/promises";
import P from "pino";
import { prisma } from "@/lib/prisma";
import QRCode from "qrcode";

const AUTH_DIR = path.join(process.cwd(), ".baileys-auth");
type BaileysSocket = any;

// Wipes the locally persisted session files. Required whenever the
// session is actually invalid (logged out from the phone side, or an
// explicit user Disconnect) — Baileys' useMultiFileAuthState does not
// reliably delete these on its own, and leaving stale creds in place
// makes the NEXT connect attempt try to reuse a session WhatsApp has
// already invalidated, which just fails again instead of generating
// a fresh QR.
async function clearAuthState() {
  await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(AUTH_DIR, { recursive: true });
}

type WhatsAppGlobal = {
  sock?: BaileysSocket | null;
  connecting?: boolean;
  currentQrDataUrl?: string | null;
  lastErrorMessage?: string | null;
  reconnectAttempts?: number;
  reconnectTimer?: ReturnType<typeof setTimeout> | null;
};
const g = globalThis as unknown as { __whatsapp?: WhatsAppGlobal };
if (!g.__whatsapp) {
  g.__whatsapp = { sock: null, connecting: false, currentQrDataUrl: null, lastErrorMessage: null, reconnectAttempts: 0, reconnectTimer: null };
}
const state_ = g.__whatsapp;

function logger() {
  return P({ level: "silent" });
}

// Shows only the last 4 digits in logs — enough to recognize which
// number in a test run, never enough to be sensitive.
function maskNumber(n: string | null | undefined) {
  if (!n) return "(none)";
  return n.length > 4 ? `${"*".repeat(n.length - 4)}${n.slice(-4)}` : n;
}

async function setConfigStatus(data: {
  status: "NOT_CONNECTED" | "CONNECTING" | "QR_REQUIRED" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "CONNECTION_ERROR";
  connectedNumber?: string | null;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  lastError?: string | null;
}) {
  const existing = await prisma.whatsAppConfig.findFirst();
  if (existing) {
    await prisma.whatsAppConfig.update({ where: { id: existing.id }, data });
  } else {
    await prisma.whatsAppConfig.create({ data: { ...data, status: data.status } });
  }
}

export async function getWhatsAppStatus() {
  const config = await prisma.whatsAppConfig.findFirst();
  return {
    config: config ?? { status: "NOT_CONNECTED", connectedNumber: null, lastConnectedAt: null, lastDisconnectedAt: null, lastError: null },
    qr: state_.currentQrDataUrl ?? null,
  };
}

// Starts (or restarts) the shared Baileys connection. Safe to call
// repeatedly — a `connecting` guard prevents ever running two
// connection attempts at once.
export async function connectWhatsApp() {
  console.log("[WhatsApp] Connect requested");

  if (state_.connecting) {
    console.log("[WhatsApp] Already connecting — ignoring duplicate request");
    return;
  }
  if (state_.sock?.user) {
    console.log("[WhatsApp] Already connected — ignoring duplicate request. JID:", maskNumber(state_.sock.user.id));
    return;
  }

  console.log("[WhatsApp] Creating/reusing shared Baileys connection");
  state_.connecting = true;
  state_.lastErrorMessage = null;

  try {
    await mkdir(AUTH_DIR, { recursive: true });

    const baileys = await import("@whiskeysockets/baileys");
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys as any;
    const { Boom } = await import("@hapi/boom");

    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    await setConfigStatus({ status: "CONNECTING" });

    const sock = makeWASocket({
      version,
      auth: authState,
      logger: logger(),
      printQRInTerminal: false,
    });
    state_.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update: any) => {
      // Ignore events from a socket that has been replaced or
      // deliberately detached (e.g. the explicit Disconnect button) —
      // otherwise its closing event would trigger an unwanted
      // auto-reconnect and fight the Disconnect.
      if (sock !== state_.sock) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[WhatsApp] QR generated — waiting for scan");
        state_.currentQrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        await setConfigStatus({ status: "QR_REQUIRED" });
      }

      if (connection === "open") {
        console.log("[WhatsApp] Connection opened");
        state_.currentQrDataUrl = null;
        state_.connecting = false;
        state_.reconnectAttempts = 0;
        const number: string | undefined = state_.sock?.user?.id?.split(":")?.[0];
        console.log("[WhatsApp] Connected WhatsApp JID:", maskNumber(number));
        await setConfigStatus({
          status: "CONNECTED",
          connectedNumber: number ?? null,
          lastConnectedAt: new Date(),
          lastError: null,
        });
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as InstanceType<typeof Boom>)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.log("[WhatsApp] Connection closed. statusCode:", statusCode, "loggedOut:", loggedOut);

        state_.connecting = false;
        state_.currentQrDataUrl = null;

        if (loggedOut) {
          console.log("[WhatsApp] Logged out from phone side — clearing invalid session and regenerating QR");
          state_.sock = null;
          // Immediately reflect reality — the account is no longer
          // connected, full stop — before doing anything else.
          await setConfigStatus({
            status: "DISCONNECTED",
            connectedNumber: null,
            lastDisconnectedAt: new Date(),
            lastError: "Logged out from WhatsApp — generating a new QR to reconnect.",
          });
          // The locally persisted session is now invalid — WhatsApp
          // itself revoked it. Reusing those files would just fail
          // authentication again instead of producing a fresh QR, so
          // wipe them, then immediately start a new connection
          // attempt so a scannable QR appears without the user having
          // to click Connect themselves.
          await clearAuthState();
          connectWhatsApp().catch((e) => {
            state_.lastErrorMessage = e?.message ?? "Reconnect after logout failed";
            console.error("[WhatsApp] Reconnect after logout failed:", e?.message);
          });
        } else {
          console.log("[WhatsApp] Unexpected disconnect — attempting automatic reconnect");
          await setConfigStatus({ status: "RECONNECTING", lastDisconnectedAt: new Date() });
          state_.sock = null;
          // Exponential backoff (2s, 4s, … capped at 60s) so a persistent
          // failure can't spin in a tight reconnect loop.
          const attempt = (state_.reconnectAttempts = (state_.reconnectAttempts ?? 0) + 1);
          const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempt - 1, 5));
          console.log(`[WhatsApp] Reconnect attempt #${attempt} in ${delay}ms`);
          if (state_.reconnectTimer) clearTimeout(state_.reconnectTimer);
          state_.reconnectTimer = setTimeout(() => {
            state_.reconnectTimer = null;
            connectWhatsApp().catch((e) => {
              state_.lastErrorMessage = e?.message ?? "Reconnect failed";
              console.error("[WhatsApp] Reconnect failed:", e?.message);
            });
          }, delay);
        }
      }
    });
  } catch (e: any) {
    console.error("[WhatsApp] Connect failed:", e?.message);
    state_.connecting = false;
    state_.lastErrorMessage = e?.message ?? "Failed to start WhatsApp connection";
    await setConfigStatus({ status: "CONNECTION_ERROR", lastError: state_.lastErrorMessage });
    throw e;
  }
}

export async function disconnectWhatsApp() {
  console.log("[WhatsApp] Disconnect requested");
  // Detach the socket BEFORE logging out so its resulting "close" event
  // is recognised as stale by the connection.update handler and does not
  // kick off an automatic reconnect.
  const sockToClose = state_.sock;
  state_.sock = null;
  if (state_.reconnectTimer) {
    clearTimeout(state_.reconnectTimer);
    state_.reconnectTimer = null;
  }
  state_.reconnectAttempts = 0;
  try {
    if (sockToClose) {
      await sockToClose.logout().catch(() => {});
    }
  } finally {
    state_.sock = null;
    state_.currentQrDataUrl = null;
    state_.connecting = false;
    // Explicit cleanup rather than relying on sock.logout() to have
    // deleted the local session files itself — this is our own
    // responsibility since we manage the file-based auth store.
    await clearAuthState();
    await setConfigStatus({ status: "NOT_CONNECTED", connectedNumber: null, lastDisconnectedAt: new Date() });
    console.log("[WhatsApp] Disconnected and session cleared");
  }
}

// Whether the shared connection is currently usable for sending.
export function isWhatsAppConnected() {
  const connected = !!state_.sock?.user;
  console.log("[WhatsApp] Connection check:", connected ? "connected" : "NOT connected");
  return connected;
}

export async function isNumberOnWhatsApp(jid: string): Promise<boolean> {
  if (!state_.sock) {
    console.log("[WhatsApp] Cannot check number registration — no active socket");
    return false;
  }
  try {
    const results = await state_.sock.onWhatsApp(jid);
    const exists = !!results?.[0]?.exists;
    console.log("[WhatsApp] Number registration check for", maskNumber(jid), "->", exists);
    return exists;
  } catch (e: any) {
    console.warn("[WhatsApp] Number registration check failed, proceeding to send anyway:", e?.message);
    // If the lookup itself fails, don't block sending on it — let
    // the actual send attempt be the source of truth for the error.
    return true;
  }
}

// Sends a plain text message. Throws on failure — callers (always
// lib/whatsapp/service.ts, never anything else directly) are
// responsible for catching this and recording a WhatsAppMessage
// failure row; this function itself has no knowledge of the
// database.
export async function sendWhatsAppText(jid: string, text: string) {
  console.log("[WhatsApp] Baileys sendMessage starting. Target JID:", maskNumber(jid));
  if (!state_.sock?.user) {
    console.error("[WhatsApp] Baileys sendMessage aborted — socket not connected");
    throw new Error("WhatsApp is not connected");
  }
  try {
    await state_.sock.sendMessage(jid, { text });
    console.log("[WhatsApp] Baileys sendMessage succeeded");
  } catch (e: any) {
    console.error("[WhatsApp] Baileys sendMessage failed:", e?.message);
    throw e;
  }
}

export async function restoreWhatsAppConnectionIfConfigured() {
  const config = await prisma.whatsAppConfig.findFirst();
  if (config && (config.status === "CONNECTED" || config.status === "RECONNECTING" || config.status === "DISCONNECTED")) {
    console.log("[WhatsApp] Restoring previous connection on server startup (last status:", config.status, ")");
    connectWhatsApp().catch((e) => {
      console.error("[WhatsApp] Failed to restore connection on startup:", e?.message);
    });
  } else {
    console.log("[WhatsApp] No previous connection to restore on startup");
  }
}
