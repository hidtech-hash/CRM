"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Nav from "@/components/Nav";
import CustomerFormFields, { CustomerFormValue, customerFormFromCustomer, customerFormToPayload } from "@/components/CustomerFormFields";

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

const COMMON_DOCS = ["Aadhaar Card", "Photo", "Signature"];

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canAssign = role === "ADMIN" || role === "MANAGER";
  const canManagePayments = role === "ADMIN" || role === "MANAGER";

  const [data, setData] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showApply, setShowApply] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/customers/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  useEffect(() => {
    load();
    fetch("/api/services")
      .then((r) => r.json())
      .then((d) => setServices(d.services ?? []));
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []));
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees ?? []));
  }, [load]);

  if (!data?.customer) {
    return (
      <div>
        <Nav />
        <main className="max-w-4xl mx-auto p-8 text-slate-400">Loading...</main>
      </div>
    );
  }

  const { customer, activity } = data;

  return (
    <div>
      <Nav />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        {/* Customer info */}
        <div className="bg-white border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold">{customer.fullName}</h1>
              <p className="text-slate-500 text-sm">
                {customer.customerCode} · {customer.mobile}
              </p>
            </div>
            {!editingCustomer && (
              <button onClick={() => setEditingCustomer(true)} className="text-blue-600 text-sm hover:underline">
                Edit Customer
              </button>
            )}
          </div>
          {editingCustomer ? (
            <EditCustomerForm
              customer={customer}
              onDone={() => {
                setEditingCustomer(false);
                load();
              }}
              onCancel={() => setEditingCustomer(false)}
            />
          ) : (
            <div className="grid grid-cols-3 gap-4 text-sm text-slate-600">
              <div>Email: {customer.email ?? "-"}</div>
              <div>Taluka: {customer.tehsil ?? "-"}</div>
              <div>District: {customer.district ?? "-"}</div>
              <div>State: {customer.state ?? "-"}</div>
            </div>
          )}
        </div>

        {/* Applied services */}
        <div className="bg-white border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Applied Services</h2>
            <button
              onClick={() => setShowApply(true)}
              className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm"
            >
              + Apply Service
            </button>
          </div>

          {showApply && (
            <ApplyServiceForm
              customerId={customer.id}
              services={services}
              agents={agents}
              employees={employees}
              canAssign={canAssign}
              canManagePayments={canManagePayments}
              role={role}
              onDone={() => {
                setShowApply(false);
                load();
              }}
              onCancel={() => setShowApply(false)}
            />
          )}

          <div className="divide-y">
            {customer.services.length === 0 && (
              <p className="text-slate-400 text-sm py-4">No services applied yet.</p>
            )}
            {customer.services.map((cs: any) => (
              <div key={cs.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">
                    {cs.service.name}{" "}
                    <span className="text-slate-400 font-normal">· Service ID: {cs.workCode}</span>
                    {cs.amount != null && (
                      <span className="text-slate-400 font-normal"> · ₹{Number(cs.amount).toLocaleString()}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Applied {new Date(cs.appliedDate).toLocaleDateString()}
                    {cs.referenceNumber && <> · Ref: {cs.referenceNumber}</>}
                    {cs.agent && <> · Agent: {cs.agent.name}</>}
                    {cs.assignedEmployee && <> · Assigned: {cs.assignedEmployee.name}</>}
                  </p>
                  {cs.status === "REJECTED" && cs.rejectionReason && (
                    <p className="text-xs text-red-700 mt-0.5">Rejected: {cs.rejectionReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[cs.status] ?? "bg-slate-100"}`}>
                    {cs.status.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      cs.paymentStatus === "PAID"
                        ? "bg-green-100 text-green-700"
                        : cs.paymentStatus === "PARTIAL"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    Payment: {cs.paymentStatus}
                  </span>
                  {/* Always the same page, for every status — this is
                      what keeps submitted fields/documents from ever
                      "disappearing" after acceptance: there's only
                      one view/edit surface for an application's
                      entire lifecycle, not a different one per stage. */}
                  <a href={`/applications/${cs.id}`} className="text-blue-600 text-sm hover:underline">
                    View / Edit →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity log */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="font-semibold mb-4">Activity History</h2>
          <div className="space-y-2 text-sm">
            {activity?.length === 0 && <p className="text-slate-400">No activity yet.</p>}
            {activity?.map((a: any) => (
              <div key={a.id} className="text-slate-600">
                <span className="text-slate-400">
                  {new Date(a.createdAt).toLocaleString()} ·{" "}
                </span>
                {a.user.name} — {a.action.replace(/_/g, " ").toLowerCase()}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function EditCustomerForm({ customer, onDone, onCancel }: { customer: any; onDone: () => void; onCancel: () => void }) {
  // Same field set (and same State → District → Taluka selector) as
  // "Add Customer" and the Agent portal's new-customer form.
  const [form, setForm] = useState<CustomerFormValue>(customerFormFromCustomer(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/customers/${customer.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerFormToPayload(form, { includeNotes: true })),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const fieldErrors = d?.error?.fieldErrors ? Object.values(d.error.fieldErrors).flat().filter(Boolean) : [];
      setError(fieldErrors.length ? (fieldErrors as string[]).join(" · ") : d.error?.toString?.() || "Could not save.");
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <CustomerFormFields value={form} onChange={setForm} showNotes />
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

function ApplyServiceForm({
  customerId,
  services,
  agents,
  employees,
  canAssign,
  canManagePayments,
  role,
  onDone,
  onCancel,
}: {
  customerId: string;
  services: any[];
  agents: any[];
  employees: any[];
  canAssign: boolean;
  canManagePayments: boolean;
  role: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [serviceId, setServiceId] = useState("");
  const [serviceDetail, setServiceDetail] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [agentId, setAgentId] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [requirementFiles, setRequirementFiles] = useState<Record<string, File | null>>({});
  const [commonFiles, setCommonFiles] = useState<Record<string, File | null>>({});
  const [customDocs, setCustomDocs] = useState<{ name: string; file: File | null }[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const roleVisibilityKey = role === "EMPLOYEE" ? "visibleToEmployee" : "visibleToAdmin";

  useEffect(() => {
    if (!serviceId) {
      setServiceDetail(null);
      return;
    }
    fetch(`/api/services/${serviceId}`)
      .then((r) => r.json())
      .then((d) => setServiceDetail(d.service));
    setFieldValues({});
    setRequirementFiles({});
  }, [serviceId]);

  const selectedService = services.find((s) => s.id === serviceId);
  const autoPrice = selectedService
    ? agentId
      ? Number(selectedService.agentPrice)
      : Number(selectedService.customerPrice)
    : null;
  const visibleFields = (serviceDetail?.fields ?? []).filter((f: any) => f[roleVisibilityKey]);

  async function submit() {
    if (!serviceId) return;
    setError("");

    const missingFields = visibleFields
      .filter((f: any) => f.requiredAtSubmission)
      .filter((f: any) => !fieldValues[f.id]?.trim())
      .map((f: any) => f.label);
    if (missingFields.length > 0) {
      setError(`Missing required field(s): ${missingFields.join(", ")}`);
      return;
    }
    const missingDocs = (serviceDetail?.documentRequirements ?? [])
      .filter((d: any) => d.required)
      .filter((d: any) => !requirementFiles[d.id])
      .map((d: any) => d.name);
    if (missingDocs.length > 0) {
      setError(`Missing required document(s): ${missingDocs.join(", ")}`);
      return;
    }

    setSaving(true);
    const form = new FormData();
    form.append("customerId", customerId);
    form.append("serviceId", serviceId);
    if (notes) form.append("notes", notes);
    if (agentId) form.append("agentId", agentId);
    if (assignedEmployeeId) form.append("assignedEmployeeId", assignedEmployeeId);
    if (canManagePayments && amountOverride !== "") form.append("amount", amountOverride);
    form.append("fieldValues", JSON.stringify(fieldValues));
    for (const [reqId, file] of Object.entries(requirementFiles)) {
      if (file) form.append(`requirement_${reqId}`, file);
    }
    for (const [name, file] of Object.entries(commonFiles)) {
      if (file) form.append(`common_${name}`, file);
    }
    for (const doc of customDocs) {
      if (doc.name && doc.file) {
        form.append("customDocName", doc.name);
        form.append("customDocFile", doc.file);
      }
    }

    const res = await fetch("/api/customer-services", { method: "POST", body: form });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error?.toString?.() || "Could not apply service.");
      return;
    }
    onDone();
  }

  return (
    <div className="bg-slate-50 border rounded p-4 mb-4 space-y-3">
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs mb-1">Service</label>
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">Select a service...</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (₹{Number(s.customerPrice)} / agent ₹{Number(s.agentPrice)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs mb-1">Received From Agent (optional)</label>
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Direct / walk-in customer</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.agentCode})
              </option>
            ))}
          </select>
        </div>
      </div>

      {autoPrice !== null && (
        <p className="text-xs text-slate-500">
          Price to be charged:{" "}
          <span className="font-medium text-slate-700">
            ₹{(canManagePayments && amountOverride !== "" ? Number(amountOverride) : autoPrice).toLocaleString()}
          </span>{" "}
          {agentId ? "(agent price)" : "(customer price)"}
          {canManagePayments && (
            <>
              {" — "}
              <input
                placeholder="override ₹"
                className="w-24 border rounded px-1.5 py-0.5 text-xs ml-1"
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
              />
            </>
          )}
        </p>
      )}

      {/* Dynamic fields — same Service configuration an Agent would see, filtered to this role's visibility */}
      {visibleFields.length > 0 && (
        <div className="space-y-3 pt-3 border-t">
          <p className="text-xs text-slate-500">Service Information</p>
          {visibleFields.map((f: any) => (
            <div key={f.id}>
              <label className="block text-xs mb-1">
                {f.label} {f.requiredAtSubmission && <span className="text-red-500">*</span>}
              </label>
              {f.fieldType === "SELECT" ? (
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={fieldValues[f.id] ?? ""}
                  onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })}
                >
                  <option value="">Select...</option>
                  {(f.options ?? []).map((o: string) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    f.fieldType === "DATE" ? "date" : f.fieldType === "EMAIL" ? "email" : f.fieldType === "NUMBER" ? "number" : "text"
                  }
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={fieldValues[f.id] ?? ""}
                  onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dynamic + common documents */}
      {serviceDetail && (
        <div className="space-y-3 pt-3 border-t">
          <p className="text-xs text-slate-500">Documents</p>
          {(serviceDetail.documentRequirements ?? []).map((d: any) => (
            <div key={d.id} className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs mb-1">
                  {d.name} {d.required ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="w-full text-sm"
                  onChange={(e) => setRequirementFiles({ ...requirementFiles, [d.id]: e.target.files?.[0] ?? null })}
                />
              </div>
              <span className={`text-xs px-2 py-1 rounded ${requirementFiles[d.id] ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                {requirementFiles[d.id] ? "Uploaded" : d.required ? "Missing" : "Not uploaded"}
              </span>
            </div>
          ))}
          {COMMON_DOCS.map((name) => (
            <div key={name}>
              <label className="block text-xs mb-1">{name} (optional)</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="w-full text-sm"
                onChange={(e) => setCommonFiles({ ...commonFiles, [name]: e.target.files?.[0] ?? null })}
              />
            </div>
          ))}
          {customDocs.map((doc, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs mb-1">Document Name</label>
                <input
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={doc.name}
                  onChange={(e) => {
                    const next = [...customDocs];
                    next[i] = { ...next[i], name: e.target.value };
                    setCustomDocs(next);
                  }}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs mb-1">Upload</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="w-full text-sm"
                  onChange={(e) => {
                    const next = [...customDocs];
                    next[i] = { ...next[i], file: e.target.files?.[0] ?? null };
                    setCustomDocs(next);
                  }}
                />
              </div>
              <button onClick={() => setCustomDocs(customDocs.filter((_, idx) => idx !== i))} className="text-red-600 text-xs">
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => setCustomDocs([...customDocs, { name: "", file: null }])} className="text-blue-600 text-xs hover:underline">
            + Add Document
          </button>
        </div>
      )}

      <div className="flex items-end gap-3 pt-3 border-t">
        <div className="flex-1">
          <label className="block text-xs mb-1">Notes</label>
          <input
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {canAssign && (
          <div className="flex-1">
            <label className="block text-xs mb-1">Assign To Employee (optional)</label>
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

      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={saving || !serviceId}
          className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add"}
        </button>
        <button onClick={onCancel} className="text-slate-500 text-sm px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
