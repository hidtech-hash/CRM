"use client";

import LocationSelect from "./LocationSelect";

// The ONE set of customer-information fields, used by:
//   - staff "Add Customer"   (app/customers/new)
//   - staff "Edit Customer"  (app/customers/[id])
//   - Agent "Apply for Service → new customer" (app/agent/apply)
// so Agents and Employees always see the same fields. The only
// difference: internal staff `notes` are hidden for Agents.

export type CustomerFormValue = {
  fullName: string;
  mobile: string;
  mobileIsWhatsapp: boolean;
  altMobile: string;
  altMobileIsWhatsapp: boolean;
  email: string;
  address: string;
  village: string;
  tehsil: string;
  district: string;
  state: string;
  pincode: string;
  dob: string; // yyyy-mm-dd
  gender: string;
  notes: string;
};

export const emptyCustomerForm = (mobile = ""): CustomerFormValue => ({
  fullName: "",
  mobile,
  mobileIsWhatsapp: false,
  altMobile: "",
  altMobileIsWhatsapp: false,
  email: "",
  address: "",
  village: "",
  tehsil: "",
  district: "",
  state: "",
  pincode: "",
  dob: "",
  gender: "",
  notes: "",
});

export function customerFormFromCustomer(c: any): CustomerFormValue {
  return {
    fullName: c.fullName ?? "",
    mobile: c.mobile ?? "",
    mobileIsWhatsapp: !!c.mobileIsWhatsapp,
    altMobile: c.altMobile ?? "",
    altMobileIsWhatsapp: !!c.altMobileIsWhatsapp,
    email: c.email ?? "",
    address: c.address ?? "",
    village: c.village ?? "",
    tehsil: c.tehsil ?? "",
    district: c.district ?? "",
    state: c.state ?? "",
    pincode: c.pincode ?? "",
    dob: c.dob ? String(c.dob).slice(0, 10) : "",
    gender: c.gender ?? "",
    notes: c.notes ?? "",
  };
}

// What gets sent to the API. Agents never send `notes`.
export function customerFormToPayload(v: CustomerFormValue, opts: { includeNotes: boolean }) {
  const payload: Record<string, any> = {
    fullName: v.fullName.trim(),
    mobile: v.mobile.trim(),
    mobileIsWhatsapp: v.mobileIsWhatsapp,
    altMobile: v.altMobile.trim(),
    altMobileIsWhatsapp: v.altMobile.trim() ? v.altMobileIsWhatsapp : false,
    email: v.email.trim(),
    address: v.address.trim(),
    village: v.village.trim(),
    tehsil: v.tehsil.trim(),
    district: v.district.trim(),
    state: v.state.trim(),
    pincode: v.pincode.trim(),
    dob: v.dob,
    gender: v.gender,
  };
  if (opts.includeNotes) payload.notes = v.notes.trim();
  return payload;
}

export default function CustomerFormFields({
  value,
  onChange,
  lockMobile = false,
  showNotes = true,
}: {
  value: CustomerFormValue;
  onChange: (next: CustomerFormValue) => void;
  lockMobile?: boolean;
  showNotes?: boolean;
}) {
  const set = (patch: Partial<CustomerFormValue>) => onChange({ ...value, ...patch });
  const input = "w-full border rounded px-3 py-2 text-sm";

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm mb-1">
          Mobile Number <span className="text-red-500">*</span>
        </label>
        <input
          className={`${input} ${lockMobile ? "bg-slate-100" : ""}`}
          value={value.mobile}
          disabled={lockMobile}
          onChange={(e) => set({ mobile: e.target.value })}
        />
        <label className="flex items-center gap-2 text-xs mt-1 text-slate-600">
          <input type="checkbox" checked={value.mobileIsWhatsapp} onChange={(e) => set({ mobileIsWhatsapp: e.target.checked })} />
          This is a WhatsApp number
        </label>
      </div>

      <div>
        <label className="block text-sm mb-1">Alternate Mobile</label>
        <input className={input} value={value.altMobile} onChange={(e) => set({ altMobile: e.target.value })} />
        {value.altMobile && (
          <label className="flex items-center gap-2 text-xs mt-1 text-slate-600">
            <input
              type="checkbox"
              checked={value.altMobileIsWhatsapp}
              onChange={(e) => set({ altMobileIsWhatsapp: e.target.checked })}
            />
            This is a WhatsApp number
          </label>
        )}
      </div>

      <div>
        <label className="block text-sm mb-1">
          Full Name <span className="text-red-500">*</span>
        </label>
        <input className={input} required value={value.fullName} onChange={(e) => set({ fullName: e.target.value })} />
      </div>

      <div>
        <label className="block text-sm mb-1">Email</label>
        <input className={input} type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
      </div>

      <div className="col-span-2">
        <label className="block text-sm mb-1">Address</label>
        <input className={input} value={value.address} onChange={(e) => set({ address: e.target.value })} />
      </div>

      <div>
        <label className="block text-sm mb-1">Village</label>
        <input className={input} value={value.village} onChange={(e) => set({ village: e.target.value })} />
      </div>

      <div>
        <label className="block text-sm mb-1">PIN Code</label>
        <input
          className={input}
          inputMode="numeric"
          maxLength={6}
          value={value.pincode}
          onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "") })}
        />
      </div>

      <div className="col-span-2">
        <LocationSelect
          state={value.state}
          district={value.district}
          taluka={value.tehsil}
          onChange={(l) => set({ state: l.state, district: l.district, tehsil: l.taluka })}
          talukaLabel="Taluka / Tehsil"
        />
      </div>

      <div>
        <label className="block text-sm mb-1">Date of Birth</label>
        <input className={input} type="date" value={value.dob} onChange={(e) => set({ dob: e.target.value })} />
      </div>

      <div>
        <label className="block text-sm mb-1">Gender</label>
        <select className={input} value={value.gender} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">Select...</option>
          {["Male", "Female", "Other"].map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          {value.gender && !["Male", "Female", "Other"].includes(value.gender) && (
            <option value={value.gender}>{value.gender}</option>
          )}
        </select>
      </div>

      {showNotes && (
        <div className="col-span-2">
          <label className="block text-sm mb-1">Notes</label>
          <input className={input} value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      )}
    </div>
  );
}
