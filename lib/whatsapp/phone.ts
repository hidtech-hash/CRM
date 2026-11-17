// Phone number normalization, used everywhere a WhatsApp JID needs
// to be built — one utility, not reimplemented per call site.
//
// Assumes Indian numbers by default (matching the rest of this CRM's
// data — customer/agent mobile fields are plain 10-digit Indian
// numbers with no country code stored). Extend `DEFAULT_COUNTRY_CODE`
// if the business also serves other countries.
const DEFAULT_COUNTRY_CODE = "91";

// Returns a normalized number with country code, digits only, or
// null if the input clearly isn't a usable phone number — callers
// treat null as "invalid number, don't attempt to send."
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Already has a country code (e.g. "919876543210" or "+919876543210" -> digits "919876543210")
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return digits;
  }
  // Bare 10-digit Indian mobile number — the common case for this CRM.
  if (digits.length === 10) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  // Already looks like some other valid international number with a
  // country code (11-15 digits) — pass it through as-is rather than
  // guessing wrong.
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null; // too short/long to be a real number — invalid
}

// Builds the Baileys/WhatsApp JID for a 1:1 chat from a normalized
// number. Never build this string inline elsewhere — if the JID
// format ever needs to change (e.g. for business accounts), this is
// the one place to change it.
export function toWhatsAppJid(normalizedNumber: string): string {
  return `${normalizedNumber}@s.whatsapp.net`;
}
