import { z } from "zod";

// Indian mobile numbers are stored as the plain 10-digit number (the
// same shape customers use, and what lib/whatsapp/phone.ts expects).
// Accepts "+91 98765 43210", "09876543210", "919876543210", etc.
export function normalizeMobile(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const mobile = z
  .string()
  .trim()
  .min(1, "Mobile number is required")
  .transform((v, ctx) => {
    const n = normalizeMobile(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid 10-digit Indian mobile number" });
      return z.NEVER;
    }
    return n;
  });

const loginId = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Login ID must be at least 3 characters")
  .max(60)
  .regex(/^[a-z0-9._@+-]+$/, "Login ID may only contain letters, numbers and . _ @ + -");

// bcrypt only uses the first 72 bytes, so cap there.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

const optionalText = z.string().trim().max(500).optional();

// yyyy-mm-dd, a real date, not in the future. Blank = not provided.
const dateOfJoining = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Enter a valid date of joining")
  .refine((v) => !v || Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000, "Date of joining cannot be in the future");
const contactEmail = z.string().trim().email("Enter a valid email address").optional().or(z.literal(""));

export const USER_ROLES = ["MANAGER", "EMPLOYEE"] as const;

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  role: z.enum(USER_ROLES),
  loginId,
  password,
  mobile,
  mobileIsWhatsapp: z.boolean().optional(),
  dateOfJoining,
  contactEmail,
  address: optionalText,
  state: optionalText,
  district: optionalText,
  tehsil: optionalText,
  isActive: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  loginId: loginId.optional(),
  // Present = reset the password to this value.
  password: password.optional(),
  mobile: mobile.optional(),
  mobileIsWhatsapp: z.boolean().optional(),
  dateOfJoining,
  contactEmail,
  address: optionalText,
  state: optionalText,
  district: optionalText,
  tehsil: optionalText,
  isActive: z.boolean().optional(),
});

// Never select passwordHash into a response.
export const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true, // this is the LOGIN ID
  role: true,
  isActive: true,
  mobile: true,
  mobileIsWhatsapp: true,
  employeeCode: true,
  dateOfJoining: true,
  contactEmail: true,
  address: true,
  state: true,
  district: true,
  tehsil: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function fieldErrorMessage(err: z.ZodError): string {
  return Object.values(err.flatten().fieldErrors).flat().filter(Boolean).join(" · ") || "Invalid input";
}
