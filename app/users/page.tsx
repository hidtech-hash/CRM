"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import LocationSelect from "@/components/LocationSelect";

type UserRow = {
  id: string;
  name: string;
  email: string; // login id
  role: string;
  isActive: boolean;
  mobile: string | null;
  mobileIsWhatsapp: boolean;
  employeeCode: string | null;
  dateOfJoining: string | null;
  contactEmail: string | null;
  address: string | null;
  state: string | null;
  district: string | null;
  tehsil: string | null;
  manageable: boolean;
};

type FormState = {
  fullName: string;
  role: string;
  loginId: string;
  password: string;
  mobile: string;
  mobileIsWhatsapp: boolean;
  dateOfJoining: string;
  contactEmail: string;
  address: string;
  state: string;
  district: string;
  tehsil: string;
  isActive: boolean;
};

const emptyForm = (role: string): FormState => ({
  fullName: "",
  role,
  loginId: "",
  password: "",
  mobile: "",
  mobileIsWhatsapp: true,
  dateOfJoining: "",
  contactEmail: "",
  address: "",
  state: "",
  district: "",
  tehsil: "",
  isActive: true,
});

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [creatableRoles, setCreatableRoles] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (roleFilter) qs.set("role", roleFilter);
    if (statusFilter) qs.set("status", statusFilter);
    fetch(`/api/users?${qs.toString()}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not load users");
        setUsers(d.users ?? []);
        setCreatableRoles(d.creatableRoles ?? []);
        setLoadError("");
      })
      .catch((e) => setLoadError(e.message));
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Nav />
      <main className="max-w-6xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Users</h1>
          {creatableRoles.length > 0 && !editing && (
            <button onClick={() => setEditing("new")} className="bg-slate-900 text-white px-4 py-2 rounded text-sm">
              + Add User
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500">
          Manager and Employee accounts. Agent logins are managed from the Agents page. Users are deactivated, not
          deleted, so their history stays intact.
        </p>

        {editing && (
          <UserForm
            key={editing === "new" ? "new" : editing.id}
            user={editing === "new" ? null : editing}
            creatableRoles={creatableRoles}
            onDone={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        <div className="flex gap-3 items-center">
          <input
            className="border rounded px-3 py-2 text-sm w-64"
            placeholder="Search name, login ID or mobile"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="border rounded px-2 py-2 text-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            <option value="ADMIN">Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="EMPLOYEE">Employee</option>
          </select>
          <select className="border rounded px-2 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Active + inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {loadError && <p className="text-red-600 text-sm">{loadError}</p>}

        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-4 py-2">Employee ID</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Login ID</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No users found.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-2 font-mono text-xs">{u.employeeCode ?? "—"}</td>
                    <td className="px-4 py-2">{u.name}</td>
                    <td className="px-4 py-2">{u.email}</td>
                    <td className="px-4 py-2">{u.role}</td>
                    <td className="px-4 py-2">
                      {u.mobile ?? <span className="text-amber-600">Not set</span>}
                      {u.mobile && u.mobileIsWhatsapp && <span className="ml-1 text-xs text-green-700">(WhatsApp)</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={u.isActive ? "text-green-700" : "text-slate-400"}>{u.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {u.manageable && (
                        <button onClick={() => setEditing(u)} className="text-blue-600 text-xs hover:underline">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function UserForm({
  user,
  creatableRoles,
  onDone,
  onCancel,
}: {
  user: UserRow | null;
  creatableRoles: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const isNew = !user;
  const [form, setForm] = useState<FormState>(
    user
      ? {
          fullName: user.name,
          role: user.role,
          loginId: user.email,
          password: "",
          mobile: user.mobile ?? "",
          mobileIsWhatsapp: user.mobileIsWhatsapp,
          dateOfJoining: user.dateOfJoining ? String(user.dateOfJoining).slice(0, 10) : "",
          contactEmail: user.contactEmail ?? "",
          address: user.address ?? "",
          state: user.state ?? "",
          district: user.district ?? "",
          tehsil: user.tehsil ?? "",
          isActive: user.isActive,
        }
      : emptyForm(creatableRoles[0] ?? "EMPLOYEE")
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const input = "w-full border rounded px-3 py-2 text-sm";

  async function submit() {
    setSaving(true);
    setError("");
    const payload: Record<string, any> = {
      fullName: form.fullName,
      role: form.role,
      loginId: form.loginId,
      mobile: form.mobile,
      mobileIsWhatsapp: form.mobileIsWhatsapp,
      dateOfJoining: form.dateOfJoining,
      contactEmail: form.contactEmail,
      address: form.address,
      state: form.state,
      district: form.district,
      tehsil: form.tehsil,
      isActive: form.isActive,
    };
    if (form.password) payload.password = form.password;

    const res = await fetch(isNew ? "/api/users" : `/api/users/${user!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not save user.");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="bg-white border rounded-lg p-6 space-y-4"
    >
      <h2 className="font-semibold">{isNew ? "Add User" : `Edit ${user!.name}`}</h2>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1">Employee ID</label>
          <input
            className={`${input} bg-slate-100 font-mono`}
            disabled
            value={user?.employeeCode ?? (form.role === "EMPLOYEE" ? "Generated automatically on save" : "Not applicable (Managers have no Employee ID)")}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Date of Joining</label>
          <input className={input} type="date" value={form.dateOfJoining} onChange={(e) => set({ dateOfJoining: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm mb-1">
            Full Name <span className="text-red-500">*</span>
          </label>
          <input className={input} required value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm mb-1">Role</label>
          <select
            className={input}
            value={form.role}
            onChange={(e) => set({ role: e.target.value })}
            disabled={!isNew && creatableRoles.length < 2}
          >
            {(creatableRoles.length ? creatableRoles : [form.role]).map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">
            Login ID (username or email) <span className="text-red-500">*</span>
          </label>
          <input className={input} required autoCapitalize="none" value={form.loginId} onChange={(e) => set({ loginId: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm mb-1">
            {isNew ? "Password" : "Reset password (leave blank to keep)"} {isNew && <span className="text-red-500">*</span>}
          </label>
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            required={isNew}
            value={form.password}
            onChange={(e) => set({ password: e.target.value })}
          />
          <p className="text-xs text-slate-400 mt-1">At least 8 characters, with a letter and a number.</p>
        </div>
        <div>
          <label className="block text-sm mb-1">
            Mobile Number (used for WhatsApp notifications) <span className="text-red-500">*</span>
          </label>
          <input className={input} required value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
          <label className="flex items-center gap-2 text-xs mt-1 text-slate-600">
            <input type="checkbox" checked={form.mobileIsWhatsapp} onChange={(e) => set({ mobileIsWhatsapp: e.target.checked })} />
            This is a WhatsApp number (WhatsApp notifications are sent only to WhatsApp numbers)
          </label>
        </div>
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input className={input} type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm mb-1">Address</label>
          <input className={input} value={form.address} onChange={(e) => set({ address: e.target.value })} />
        </div>
        <div className="col-span-2">
          <LocationSelect
            state={form.state}
            district={form.district}
            taluka={form.tehsil}
            onChange={(l) => set({ state: l.state, district: l.district, tehsil: l.taluka })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm col-span-2">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active (inactive users cannot sign in)
        </label>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="bg-slate-900 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
          {saving ? "Saving..." : isNew ? "Create User" : "Save Changes"}
        </button>
        <button type="button" onClick={onCancel} className="text-slate-500 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
