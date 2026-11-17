// Central template rendering — the only place {PLACEHOLDERS} are
// substituted. Guarantees customers/employees never see "undefined",
// "null" or a raw "{PLACEHOLDER}":
//   * a variable with a real value is substituted;
//   * a missing/empty/unknown variable is removed;
//   * a line whose placeholders were ALL empty is dropped entirely
//     (so "Reference Number: {REFERENCE_NUMBER}" disappears when there is
//     no reference number yet);
//   * leftovers like "()" or double spaces are tidied.

export type TemplateVars = Record<string, string | number | null | undefined>;

const TIMEZONE = process.env.WHATSAPP_TIMEZONE || "Asia/Kolkata";

export function nowDateTimeVars(date = new Date()): { DATE: string; TIME: string } {
  const DATE = new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const TIME = new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return { DATE, TIME };
}

function clean(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (s === "" || s === "undefined" || s === "null" || s === "NaN") return "";
  return s;
}

export function renderTemplate(body: string, variables: TemplateVars): string {
  const vars: TemplateVars = { ...nowDateTimeVars(), ...variables };
  const out: string[] = [];

  for (const line of body.split("\n")) {
    const placeholders = line.match(/\{[A-Z_]+\}/g) ?? [];
    let anyValue = false;
    let rendered = line.replace(/\{([A-Z_]+)\}/g, (_m, key: string) => {
      const v = clean(vars[key]);
      if (v) anyValue = true;
      return v;
    });
    if (placeholders.length > 0 && !anyValue) continue; // every placeholder on this line was empty

    rendered = rendered
      .replace(/\(\s*\)/g, "") // "()" left by an empty bracketed variable
      .replace(/\[\s*\]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/[ \t]+$/g, "");
    out.push(rendered);
  }

  // Collapse runs of blank lines produced by dropped lines.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
