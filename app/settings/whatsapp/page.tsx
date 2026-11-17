"use client";

import { useEffect, useState, useCallback } from "react";
import Nav from "@/components/Nav";

// Emoji + label together, matching the exact states Baileys can
// report through connection.update (see lib/whatsapp/baileysClient.ts).
const STATUS_DISPLAY: Record<string, { emoji: string; label: string }> = {
  NOT_CONNECTED: { emoji: "🔴", label: "Not Connected" },
  CONNECTING: { emoji: "🔄", label: "Connecting..." },
  QR_REQUIRED: { emoji: "🟡", label: "Scan QR to Connect" },
  CONNECTED: { emoji: "🟢", label: "Connected" },
  DISCONNECTED: { emoji: "🔴", label: "Disconnected" },
  RECONNECTING: { emoji: "🔄", label: "Reconnecting..." },
  CONNECTION_ERROR: { emoji: "🔴", label: "Connection Error" },
};

const STATUS_COLORS: Record<string, string> = {
  NOT_CONNECTED: "bg-slate-100 text-slate-600",
  CONNECTING: "bg-amber-100 text-amber-700",
  QR_REQUIRED: "bg-amber-100 text-amber-700",
  CONNECTED: "bg-green-100 text-green-700",
  DISCONNECTED: "bg-red-100 text-red-700",
  RECONNECTING: "bg-amber-100 text-amber-700",
  CONNECTION_ERROR: "bg-red-100 text-red-700",
};

// How often the frontend re-checks the shared connection state. This
// is what makes the UI reflect the real Baileys state without a
// manual refresh — it must run continuously for as long as this page
// is open, not just while a connection attempt is "in progress".
// Polling was previously gated to only run during
// CONNECTING/QR_REQUIRED/RECONNECTING, which meant a live drop from
// CONNECTED (e.g. the phone unlinking the session) was never
// detected until the page was reloaded — that's the bug this fixes.
const POLL_INTERVAL_MS = 3000;

const TEMPLATE_LABELS: Record<string, string> = {
  CUSTOMER_CREATED: "Customer Created",
  SERVICE_APPLIED: "Service Applied",
  AGENT_APPLICATION_TO_EMPLOYEE: "Agent Service Application Received (to Employee)",
  AGENT_PAYMENT_REMINDER: "Agent Payment Reminder",
  APPLICATION_STATUS_CHANGED: "Application Status Changed",
};

// Which audience each template goes to — used to group the editor.
const TEMPLATE_GROUPS: { title: string; types: string[] }[] = [
  { title: "Customer Notifications", types: ["CUSTOMER_CREATED", "SERVICE_APPLIED"] },
  { title: "Employee Notifications", types: ["AGENT_APPLICATION_TO_EMPLOYEE"] },
  { title: "Agent Notifications", types: ["AGENT_PAYMENT_REMINDER"] },
];

// Fallback only — the API returns the authoritative variable list per
// template (see /api/whatsapp/templates).
const TEMPLATE_VARIABLES: Record<string, string[]> = {
  CUSTOMER_CREATED: ["{CUSTOMER_NAME}", "{CUSTOMER_ID}"],
  SERVICE_APPLIED: ["{CUSTOMER_NAME}", "{CUSTOMER_ID}", "{SERVICE_NAME}", "{SERVICE_ID}"],
  AGENT_APPLICATION_TO_EMPLOYEE: ["{AGENT_NAME}", "{ENTERPRISE_NAME}", "{CUSTOMER_NAME}", "{CUSTOMER_ID}", "{SERVICE_NAME}", "{SERVICE_ID}"],
  AGENT_PAYMENT_REMINDER: ["{AGENT_NAME}", "{AGENT_ID}", "{ENTERPRISE_NAME}", "{PENDING_AMOUNT}", "{PENDING_DAYS}", "{UPI_LINK}"],
};

export default function WhatsAppConfigPage() {
  const [tab, setTab] = useState<"connection" | "templates" | "failed">("connection");
  const [status, setStatus] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [statusTemplates, setStatusTemplates] = useState<any[]>([]);
  const [statusVariables, setStatusVariables] = useState<string[]>([]);
  const [messages, setMessages] = useState<any[]>([]);

  const loadStatus = useCallback(() => {
    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {}); // a transient poll failure shouldn't crash the page
  }, []);

  const loadTemplates = useCallback(() => {
    fetch("/api/whatsapp/templates")
      .then((r) => r.json())
      .then((d) => {
        setTemplates(d.templates ?? []);
        setStatusTemplates(d.statusTemplates ?? []);
        setStatusVariables(d.statusVariables ?? []);
      })
      .catch(() => {});
  }, []);

  const loadMessages = useCallback(() => {
    fetch("/api/whatsapp/messages?status=FAILED")
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []));
  }, []);

  useEffect(() => {
    loadStatus();
    loadTemplates();
    loadMessages();
  }, [loadStatus, loadTemplates, loadMessages]);

  // Continuous polling for as long as this page is mounted — this is
  // the real-time detection mechanism: simple, reliable, and enough
  // for a status that only needs to catch up within a few seconds of
  // actually changing (per the spec's own guidance not to introduce
  // heavier infrastructure like SSE unless polling isn't sufficient).
  useEffect(() => {
    const interval = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // Also re-check the moment the tab regains focus/visibility — in
  // case the interval was throttled by the browser while backgrounded.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") loadStatus();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadStatus]);

  async function connect() {
    await fetch("/api/whatsapp/connect", { method: "POST" });
    loadStatus();
  }
  async function disconnect() {
    if (!confirm("Disconnect WhatsApp? You'll need to scan a new QR code to reconnect.")) return;
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    loadStatus();
  }

  const display = status?.config?.status ? STATUS_DISPLAY[status.config.status] : null;

  return (
    <div>
      <Nav />
      <main className="max-w-3xl mx-auto p-8 space-y-6">
        <h1 className="text-2xl font-semibold">WhatsApp Configuration</h1>
        <p className="text-sm text-slate-500">
          One shared WhatsApp connection and one shared set of message templates for the whole CRM —
          not per-user, not per-agent.
        </p>

        <div className="flex gap-2 border-b">
          {(["connection", "templates", "failed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t ? "border-slate-900 font-medium" : "border-transparent text-slate-500"
              }`}
            >
              {t === "connection" ? "Connection" : t === "templates" ? "Message Templates" : "Failed Messages"}
            </button>
          ))}
        </div>

        {tab === "connection" && status && (
          <div className="bg-white border rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className={`text-sm px-3 py-1.5 rounded font-medium ${STATUS_COLORS[status.config.status] ?? "bg-slate-100"}`}>
                {display ? `${display.emoji} ${display.label}` : status.config.status}
              </span>
              {status.config.connectedNumber && (
                <span className="text-sm text-slate-600">+{status.config.connectedNumber}</span>
              )}
            </div>

            {status.config.lastConnectedAt && (
              <p className="text-xs text-slate-500">
                Last connected: {new Date(status.config.lastConnectedAt).toLocaleString()}
              </p>
            )}
            {status.config.lastDisconnectedAt && (
              <p className="text-xs text-slate-500">
                Last disconnected: {new Date(status.config.lastDisconnectedAt).toLocaleString()}
              </p>
            )}
            {status.config.lastError && <p className="text-xs text-red-600">{status.config.lastError}</p>}

            {status.qr && (
              <div>
                <p className="text-sm text-slate-600 mb-2">Scan this with WhatsApp on your phone (Linked Devices → Link a Device):</p>
                <img src={status.qr} alt="WhatsApp QR code" className="w-56 h-56 border rounded" />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              {status.config.status === "CONNECTED" ? (
                <button onClick={disconnect} className="bg-red-600 text-white px-4 py-2 rounded text-sm">
                  Disconnect
                </button>
              ) : (
                <button onClick={connect} className="bg-slate-900 text-white px-4 py-2 rounded text-sm">
                  {status.config.status === "NOT_CONNECTED" ? "Connect" : "Reconnect"}
                </button>
              )}
            </div>

            <p className="text-xs text-slate-400">
              This status refreshes automatically every few seconds — if WhatsApp is unlinked from your
              phone, this page will reflect that without needing a reload.
            </p>
          </div>
        )}

        {tab === "templates" && (
          <div className="space-y-8">
            {TEMPLATE_GROUPS.map((group) => (
              <div key={group.title} className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group.title}</h2>
                {group.types.map((type) => {
                  const existing = templates.find((t) => t.type === type);
                  return (
                    <TemplateEditor
                      key={type}
                      type={type}
                      label={TEMPLATE_LABELS[type]}
                      variables={existing?.variables ?? TEMPLATE_VARIABLES[type] ?? []}
                      body={existing?.body ?? ""}
                      isDefault={!!existing?.isDefault}
                      onSaved={loadTemplates}
                    />
                  );
                })}
              </div>
            ))}

            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Customer Notifications — Application Status Changed
              </h2>
              <p className="text-xs text-slate-500">
                Sent to the customer (on their WhatsApp number) only when an application actually moves into that
                status. Switch a status off to stop notifying for it.
              </p>
              {statusTemplates.map((st) => (
                <StatusTemplateEditor key={st.status} template={st} variables={statusVariables} onSaved={loadTemplates} />
              ))}
            </div>
          </div>
        )}

        {tab === "failed" && (
          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-4 py-2 whitespace-nowrap">Recipient</th>
                    <th className="px-4 py-2 whitespace-nowrap">Number</th>
                    <th className="px-4 py-2 whitespace-nowrap">Type</th>
                    <th className="px-4 py-2 whitespace-nowrap">Failure Reason</th>
                    <th className="px-4 py-2 whitespace-nowrap">Date</th>
                    <th className="px-4 py-2 whitespace-nowrap">Attempt</th>
                    <th className="px-4 py-2 whitespace-nowrap">Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                        No failed messages.
                      </td>
                    </tr>
                  )}
                  {messages.map((m) => (
                    <FailedMessageRow key={m.id} message={m} onRetried={loadMessages} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function TemplateEditor({
  type,
  label,
  variables,
  body,
  isDefault,
  onSaved,
}: {
  type: string;
  label: string;
  variables: string[];
  body: string;
  isDefault?: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(body);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setValue(body), [body]);

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/whatsapp/templates/${type}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: value }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage("Could not save.");
      return;
    }
    setMessage("Saved.");
    onSaved();
  }

  return (
    <div className="bg-white border rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">
          {label}
          {isDefault && <span className="ml-2 text-xs font-normal text-slate-400">(default — not customised yet)</span>}
        </h2>
        {message && <span className="text-xs text-blue-700">{message}</span>}
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Available variables: <span className="font-mono">{variables.join(" ")}</span>
      </p>
      <textarea
        className="w-full border rounded px-3 py-2 text-sm h-32 font-mono"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Template"}
      </button>
    </div>
  );
}

function StatusTemplateEditor({
  template,
  variables,
  onSaved,
}: {
  template: { status: string; label: string; body: string; isEnabled: boolean; isDefault: boolean };
  variables: string[];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(template.body);
  const [enabled, setEnabled] = useState(template.isEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValue(template.body);
    setEnabled(template.isEnabled);
  }, [template.body, template.isEnabled]);

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/whatsapp/status-templates/${template.status}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: value, isEnabled: enabled }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage("Could not save.");
      return;
    }
    setMessage("Saved.");
    onSaved();
  }

  return (
    <div className="bg-white border rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">
          When status becomes: {template.label}
          {template.isDefault && <span className="ml-2 text-xs font-normal text-slate-400">(default — not customised yet)</span>}
        </h3>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send this notification
        </label>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Available variables: <span className="font-mono">{variables.join(" ")}</span>
      </p>
      <textarea
        className="w-full border rounded px-3 py-2 text-sm h-28 font-mono"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {message && <span className="text-xs text-blue-700">{message}</span>}
      </div>
    </div>
  );
}

function FailedMessageRow({ message, onRetried }: { message: any; onRetried: () => void }) {
  const [newNumber, setNewNumber] = useState(message.toNumber);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState("");

  async function retry() {
    setRetrying(true);
    setResult("");
    const res = await fetch(`/api/whatsapp/messages/${message.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toNumber: newNumber !== message.toNumber ? newNumber : undefined }),
    });
    setRetrying(false);
    const data = await res.json().catch(() => ({}));
    setResult(data.sent ? "Sent!" : data.reason || data.error || "Failed again.");
    onRetried();
  }

  return (
    <tr className="border-t">
      <td className="px-4 py-2 whitespace-nowrap">
        {message.customer?.fullName ?? message.employee?.name ?? message.agent?.name ?? "-"}
        <div className="text-xs text-slate-400">{message.recipientType}</div>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        <input
          className="w-32 border rounded px-2 py-1 text-xs"
          value={newNumber}
          onChange={(e) => setNewNumber(e.target.value)}
        />
      </td>
      <td className="px-4 py-2 whitespace-nowrap">{TEMPLATE_LABELS[message.templateType] ?? message.templateType}</td>
      <td className="px-4 py-2 max-w-[220px]">{message.failureReason}</td>
      <td className="px-4 py-2 whitespace-nowrap">{new Date(message.createdAt).toLocaleString()}</td>
      <td className="px-4 py-2 whitespace-nowrap">#{message.attemptNumber}</td>
      <td className="px-4 py-2 whitespace-nowrap">
        <button
          onClick={retry}
          disabled={retrying}
          className="text-blue-600 text-xs hover:underline disabled:opacity-50"
        >
          {retrying ? "Retrying..." : "Resend"}
        </button>
        {result && <div className="text-xs text-slate-500 mt-1">{result}</div>}
      </td>
    </tr>
  );
}
