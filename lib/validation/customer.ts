import { z } from "zod";

// ONE customer validation schema + one mapping to database fields, used
// by the staff "Add Customer" route, the customer edit route AND the
// Agent portal's "new customer" path — so Agents and Employees capture
// exactly the same customer information with exactly the same rules.
//
// Deliberately NOT part of the shared schema (system-controlled):
// customerCode, createdBy/updatedBy, timestamps. `notes` is an internal
// staff field: staff schemas include it, the agent schema does not.

const text = (max = 500) => z.string().trim().max(max).optional();

const mobile = z.string().trim().min(10, "Mobile number must be 10–15 digits").max(15, "Mobile number must be 10–15 digits");

const altMobile = z
  .string()
  .trim()
  .max(15)
  .optional()
  .refine((v) => !v || (v.length >= 10 && v.length <= 15), "Alternate mobile must be 10–15 digits");

const email = z.string().trim().email("Enter a valid email address").optional().or(z.literal(""));

const pincode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "PIN code must be 6 digits")
  .optional()
  .or(z.literal(""));

const dob = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Enter a valid date of birth");

const baseShape = {
  fullName: z.string().trim().min(2, "Full name is required"),
  mobile,
  mobileIsWhatsapp: z.boolean().optional(),
  altMobile,
  altMobileIsWhatsapp: z.boolean().optional(),
  email,
  address: text(),
  village: text(),
  tehsil: text(), // "Taluka" in the UI — column name kept (renaming a column is a riskier migration)
  district: text(),
  state: text(),
  pincode,
  dob,
  gender: text(50),
};

export const customerCreateSchema = z.object({ ...baseShape, notes: text(2000) });
export const customerUpdateSchema = customerCreateSchema.partial();
// Agents: same fields, minus the internal staff notes.
export const agentNewCustomerSchema = z.object(baseShape);

type Input = Partial<z.infer<typeof customerCreateSchema>>;

const TEXT_KEYS = ["altMobile", "email", "address", "village", "tehsil", "district", "state", "pincode", "gender", "notes"] as const;

// For CREATE: every optional field becomes null when blank.
export function customerDataForCreate(d: Input & { fullName: string; mobile: string }) {
  const out: Record<string, any> = {
    fullName: d.fullName,
    mobile: d.mobile,
    mobileIsWhatsapp: d.mobileIsWhatsapp ?? false,
    altMobileIsWhatsapp: d.altMobile ? d.altMobileIsWhatsapp ?? false : false,
    dob: d.dob ? new Date(d.dob) : null,
  };
  for (const k of TEXT_KEYS) out[k] = (d as any)[k] ? (d as any)[k] : null;
  return out;
}

// For UPDATE: only fields that were actually sent are touched, and a
// blank string now genuinely CLEARS the field (null) instead of being
// stored as "" or silently ignored.
export function customerDataForUpdate(d: Input) {
  const out: Record<string, any> = {};
  if (d.fullName !== undefined) out.fullName = d.fullName;
  if (d.mobile !== undefined) out.mobile = d.mobile;
  if (d.mobileIsWhatsapp !== undefined) out.mobileIsWhatsapp = d.mobileIsWhatsapp;
  if (d.altMobileIsWhatsapp !== undefined) out.altMobileIsWhatsapp = d.altMobileIsWhatsapp;
  for (const k of TEXT_KEYS) {
    const v = (d as any)[k];
    if (v !== undefined) out[k] = v === "" ? null : v;
  }
  if (d.dob !== undefined) out.dob = d.dob === "" ? null : new Date(d.dob);
  // No alternate number → it can't be a WhatsApp number.
  if (out.altMobile === null) out.altMobileIsWhatsapp = false;
  return out;
}
