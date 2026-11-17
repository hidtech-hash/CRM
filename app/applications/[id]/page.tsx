"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Nav from "@/components/Nav";

const STATUS_OPTIONS = [
  "NEW",
  "PENDING_REVIEW",
  "ASSIGNED",
  "ACCEPTED",
  "PROCESSING",
  "DOCUMENT_REQUIRED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-slate-200 text-slate-700",
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  ACCEPTED: "bg-green-100 text-green-700",
  PROCESSING: "bg-amber-100 text-amber-700",
  DOCUMENT_REQUIRED: "bg-orange-100 text-orange-700",
  SUBMITTED: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-300 text-slate-700",
};

// This is the ONE place staff view and edit an application, at any
// stage of its life — submission review, post-acceptance processing,
// reference number / status updates, everything. Previously the
// customer profile page had a separate, more limited inline edit
// form that didn't show dynamic fields or documents at all, so once
// an application moved past "Pending Review" its submitted
// information effectively became invisible. Consolidating into one
// page (linked from everywhere, for every status) closes that gap
// for good instead of patching each symptom separately.
export default function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canDecide = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const canAssign = role === "ADMIN" || role === "MANAGER";
  const canManagePayments = role === "ADMIN" || role === "MANAGER";
  const roleVisibilityKey = role === "EMPLOYEE" ? "visibleToEmployee" : "visibleToAdmin";

  const [data, setData] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsMessage, setFieldsMessage] = useState("");

  const [uploadingReqId, setUploadingReqId] = useState<string | null>(null);
  const [customDocName, setCustomDocName] = useState("");
  const [customDocFile, setCustomDocFile] = useState<File | null>(null);
  const [docsMessage, setDocsMessage] = useState("");

  // General edit form (status / reference number / agent / assignment / price)
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/customer-services/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  useEffect(() => {
    load();
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []));
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees ?? []));
  }, [load]);

  async function accept() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/customer-services/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACCEPTED" }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.toString?.() || "Could not accept.");
      return;
    }
    load();
  }

  async function reject() {
    if (!rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/customer-services/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED", rejectionReason }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.toString?.() || "Could not reject.");
      return;
    }
    setShowReject(false);
    setRejectionReason("");
    load();
  }

  async function saveFieldEdits() {
    if (Object.keys(fieldEdits).length === 0) return;
    setSavingFields(true);
    setFieldsMessage("");
    const res = await fetch(`/api/customer-services/${params.id}/fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldValues: fieldEdits }),
    });
    setSavingFields(false);
    if (!res.ok) {
      setFieldsMessage("Could not save field updates.");
      return;
    }
    setFieldEdits({});
    setFieldsMessage("Saved.");
    load();
  }

  async function uploadDocument(requirementId: string | null, name: string, file: File) {
    setDocsMessage("");
    const form = new FormData();
    form.append("file", file);
    if (requirementId) form.append("requirementId", requirementId);
    else form.append("documentName", name);
    const res = await fetch(`/api/customer-services/${params.id}/documents`, { method: "POST", body: form });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setDocsMessage(d.error?.toString?.() || "Could not upload document.");
      return;
    }
    setUploadingReqId(null);
    setCustomDocName("");
    setCustomDocFile(null);
    load();
  }

  if (!data?.application) {
    return (
      <div>
        <Nav />
        <main className="max-w-3xl mx-auto p-8 text-slate-400">Loading...</main>
      </div>
    );
  }

  const { application, activity } = data;
  const requiredDocs = application.service.documentRequirements ?? [];
  const uploadedByRequirement = new Set(application.documents.map((d: any) => d.requirementId).filter(Boolean));
  const commonOrCustomDocs = application.documents.filter((d: any) => !d.requirementId);
  const missingRequired = requiredDocs.filter((d: any) => d.required && !uploadedByRequirement.has(d.id));
  const visibleFields = (application.service.fields ?? []).filter((f: any) => f[roleVisibilityKey]);

  return (
    <div>
      <Nav />
      <main className="max-w-3xl mx-auto p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{application.service.name}</h1>
          <p className="text-slate-500 text-sm mt-1">Service ID: {application.workCode}</p>
          <span className={`inline-block mt-2 text-xs px-2 py-1 rounded ${STATUS_COLORS[application.status] ?? "bg-slate-100"}`}>
            {application.status.replace(/_/g, " ")}
          </span>
        </div>

        {/* Accept/Reject action bar — only while awaiting review */}
        {canDecide && application.status === "PENDING_REVIEW" && (
          <div className="bg-white border rounded-lg p-6">
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            {missingRequired.length > 0 && (
              <p className="text-amber-700 text-sm mb-3">
                Missing required document(s): {missingRequired.map((d: any) => d.name).join(", ")}
              </p>
            )}
            {!showReject ? (
              <div className="flex gap-3">
                <button
                  onClick={accept}
                  disabled={saving}
                  className="bg-green-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  className="bg-red-600 text-white px-4 py-2 rounded text-sm"
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs mb-1">Rejection Reason</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="e.g. Aadhaar document is unclear"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={reject}
                    disabled={saving}
                    className="bg-red-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
                  >
                    Confirm Reject
                  </button>
                  <button onClick={() => setShowReject(false)} className="text-slate-500 text-sm px-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {application.status === "REJECTED" && application.rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm">
            <span className="font-medium text-red-800">Rejected: </span>
            <span className="text-red-700">{application.rejectionReason}</span>
          </div>
        )}

        {/* Customer + Agent + processing info, with edit toggle */}
        <div className="bg-white border rounded-lg p-6">
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="text-slate-500 text-xs mb-1">Customer</p>
              <p className="font-medium">{application.customer.fullName}</p>
              <p className="text-slate-500">{application.customer.mobile}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Agent</p>
              <p className="font-medium">{application.agent?.name ?? "Direct / walk-in"}</p>
              {application.agent && <p className="text-slate-500">{application.agent.agentCode}</p>}
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Assigned Employee</p>
              <p className="font-medium">{application.assignedEmployee?.name ?? "Unassigned"}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Applied</p>
              <p className="font-medium">{new Date(application.appliedDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Reference Number</p>
              <p className="font-medium">{application.referenceNumber ?? "-"}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Price / Payment</p>
              <p className="font-medium">
                ₹{Number(application.amount ?? 0).toLocaleString()} ·{" "}
                <span
                  className={
                    application.paymentStatus === "PAID"
                      ? "text-green-700"
                      : application.paymentStatus === "PARTIAL"
                      ? "text-amber-700"
                      : "text-slate-500"
                  }
                >
                  {application.paymentStatus}
                </span>
              </p>
            </div>
          </div>

          {canDecide && !editOpen && (
            <button onClick={() => setEditOpen(true)} className="text-blue-600 text-sm hover:underline">
              Edit Status / Reference Number / Assignment →
            </button>
          )}

          {editOpen && (
            <GeneralEditForm
              application={application}
              agents={agents}
              employees={employees}
              canAssign={canAssign}
              canManagePayments={canManagePayments}
              onDone={() => {
                setEditOpen(false);
                load();
              }}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </div>

        {/* Dynamic field values — filtered to what this role can see */}
        {visibleFields.length > 0 && (
          <div className="bg-white border rounded-lg p-6">
            <h2 className="font-semibold mb-3">Submitted Information</h2>
            {fieldsMessage && <p className="text-xs text-blue-700 mb-3">{fieldsMessage}</p>}
            <div className="text-sm space-y-3">
              {visibleFields.map((f: any) => {
                const v = application.fieldValues.find((fv: any) => fv.serviceFieldId === f.id);
                const currentValue = fieldEdits[f.id] ?? v?.value ?? "";
                if (!f.editableAfterSubmission) {
                  return (
                    <p key={f.id}>
                      <span className="text-slate-500">{f.label}:</span>{" "}
                      {v?.value || <span className="text-slate-400">not provided</span>}
                    </p>
                  );
                }
                return (
                  <div key={f.id} className="flex items-center gap-3">
                    <label className="text-slate-500 w-56 shrink-0">{f.label}:</label>
                    <input
                      className="flex-1 border rounded px-2 py-1.5 text-sm"
                      placeholder={v?.value ? undefined : "not provided yet"}
                      value={currentValue}
                      onChange={(e) => setFieldEdits({ ...fieldEdits, [f.id]: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
            {visibleFields.some((f: any) => f.editableAfterSubmission) && (
              <button
                onClick={saveFieldEdits}
                disabled={savingFields || Object.keys(fieldEdits).length === 0}
                className="mt-4 bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
              >
                {savingFields ? "Saving..." : "Save Field Updates"}
              </button>
            )}
          </div>
        )}

        {/* Documents — view existing, plus add missing/replace/custom */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="font-semibold mb-3">Documents</h2>
          {docsMessage && <p className="text-xs text-red-600 mb-3">{docsMessage}</p>}
          <div className="space-y-2 text-sm">
            {requiredDocs.map((d: any) => {
              const docs = application.documents.filter((ad: any) => ad.requirementId === d.id);
              return (
                <div key={d.id} className="flex items-center justify-between">
                  <span>
                    {d.name} <span className="text-xs text-slate-400">({d.required ? "Required" : "Optional"})</span>
                  </span>
                  <div className="flex items-center gap-3">
                    {docs.map((doc: any) => (
                      <a key={doc.id} href={doc.fileUrl} target="_blank" className="text-blue-600 text-xs hover:underline">
                        View
                      </a>
                    ))}
                    {docs.length === 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded ${d.required ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>
                        Missing
                      </span>
                    )}
                    {canDecide &&
                      (uploadingReqId === d.id ? (
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,application/pdf"
                          className="text-xs w-40"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadDocument(d.id, d.name, file);
                          }}
                        />
                      ) : (
                        <button
                          onClick={() => setUploadingReqId(d.id)}
                          className="text-blue-600 text-xs hover:underline"
                        >
                          {docs.length > 0 ? "Replace" : "Upload"}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
            {commonOrCustomDocs.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between">
                <span>{d.documentName} <span className="text-xs text-slate-400">(additional)</span></span>
                <a href={d.fileUrl} target="_blank" className="text-blue-600 text-xs hover:underline">
                  View
                </a>
              </div>
            ))}
            {requiredDocs.length === 0 && commonOrCustomDocs.length === 0 && (
              <p className="text-slate-400 text-sm">No documents on this application.</p>
            )}
          </div>

          {canDecide && (
            <div className="mt-4 pt-4 border-t flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs mb-1">Add Another Document</label>
                <input
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  placeholder="Document name"
                  value={customDocName}
                  onChange={(e) => setCustomDocName(e.target.value)}
                />
              </div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="text-sm w-40"
                onChange={(e) => setCustomDocFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => customDocName && customDocFile && uploadDocument(null, customDocName, customDocFile)}
                disabled={!customDocName || !customDocFile}
                className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
              >
                Upload
              </button>
            </div>
          )}
        </div>

        {/* Activity history */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="font-semibold mb-3">History</h2>
          <div className="space-y-1 text-sm">
            {activity.length === 0 && <p className="text-slate-400">No activity yet.</p>}
            {activity.map((a: any) => (
              <p key={a.id} className="text-slate-600">
                <span className="text-slate-400">{new Date(a.createdAt).toLocaleString()} · </span>
                {a.user.name} — {a.action.replace(/_/g, " ").toLowerCase()}
              </p>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function GeneralEditForm({
  application,
  agents,
  employees,
  canAssign,
  canManagePayments,
  onDone,
  onCancel,
}: {
  application: any;
  agents: any[];
  employees: any[];
  canAssign: boolean;
  canManagePayments: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState(application.status);
  const [rejectionReason, setRejectionReason] = useState(application.rejectionReason ?? "");
  const [referenceNumber, setReferenceNumber] = useState(application.referenceNumber ?? "");
  const [notes, setNotes] = useState(application.notes ?? "");
  const [agentId, setAgentId] = useState(application.agentId ?? "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(application.assignedEmployeeId ?? "");
  const [amount, setAmount] = useState(application.amount ?? "");
  const [amountReceived, setAmountReceived] = useState(application.amountReceived ?? "");
  const [paymentStatus, setPaymentStatus] = useState(application.paymentStatus ?? "PENDING");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (status === "REJECTED" && !rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = {
      status,
      referenceNumber: referenceNumber || undefined,
      rejectionReason: status === "REJECTED" ? rejectionReason : undefined,
      notes: notes || undefined,
      completedDate: status === "COMPLETED" ? new Date().toISOString() : undefined,
      agentId: agentId || null,
    };
    if (canAssign) body.assignedEmployeeId = assignedEmployeeId || null;
    if (canManagePayments) {
      body.amount = amount !== "" ? Number(amount) : undefined;
      body.amountReceived = amountReceived !== "" ? Number(amountReceived) : undefined;
      body.paymentStatus = paymentStatus;
    }
    const res = await fetch(`/api/customer-services/${application.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.toString?.() || "Could not save.");
      return;
    }
    onDone();
  }

  return (
    <div className="pt-4 border-t mt-2">
      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs mb-1">Status</label>
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1">Reference Number</label>
          <input
            className="w-full border rounded px-2 py-1.5 text-sm"
            placeholder="e.g. online application ref no."
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
          />
        </div>
      </div>

      {status === "REJECTED" && (
        <div className="mb-3">
          <label className="block text-xs mb-1">
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
        </div>
      )}

      <div className="mb-3">
        <label className="block text-xs mb-1">Notes</label>
        <input
          className="w-full border rounded px-2 py-1.5 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs mb-1">Agent</label>
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Direct / walk-in</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.agentCode})
              </option>
            ))}
          </select>
        </div>
        {canAssign && (
          <div>
            <label className="block text-xs mb-1">Assigned Employee</label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={assignedEmployeeId}
              onChange={(e) => setAssignedEmployeeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.role})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {canManagePayments && (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs mb-1">Price (₹)</label>
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Amount Received (₹)</label>
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={amountReceived}
              onChange={(e) => setAmountReceived(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs mb-1">Payment Status</label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
            >
              <option value="PENDING">Pending</option>
              <option value="PARTIAL">Partial</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={saving}
          className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={onCancel} className="text-slate-500 text-sm px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
