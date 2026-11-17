// Small in-memory login throttle: after MAX_FAILURES failed sign-ins
// for the same login id (or from the same IP) inside WINDOW_MS, further
// attempts are rejected until the window passes. In-memory means it is
// per server process (fine for the single long-lived Node process this
// CRM runs as — the same assumption the WhatsApp singleton makes). If
// the app is ever scaled to several instances, move this to the DB or
// Redis.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

type Entry = { count: number; first: number };
const g = globalThis as unknown as { __loginAttempts?: Map<string, Entry> };
if (!g.__loginAttempts) g.__loginAttempts = new Map();
const attempts = g.__loginAttempts;

function fresh(key: string): Entry | undefined {
  const e = attempts.get(key);
  if (!e) return undefined;
  if (Date.now() - e.first > WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }
  return e;
}

export function isLoginBlocked(keys: string[]): boolean {
  return keys.some((k) => (fresh(k)?.count ?? 0) >= MAX_FAILURES);
}

export function recordLoginFailure(keys: string[]) {
  for (const k of keys) {
    const e = fresh(k);
    if (e) e.count += 1;
    else attempts.set(k, { count: 1, first: Date.now() });
  }
}

export function clearLoginFailures(keys: string[]) {
  for (const k of keys) attempts.delete(k);
}
