import { prisma } from "./prisma";

// Generates the next sequential code for a prefix, e.g. CUS-000001.
// Uses a simple count+1 approach for Phase 1. If two requests race,
// the unique constraint on customerCode/workCode will reject a
// duplicate and the caller can retry — acceptable at this volume.
// (Swap for a dedicated counters table if write volume grows.)

// Candidate code = count+1+i; skip any candidate that already exists
// (e.g. after rows were ever hard-deleted, when count+1 would collide).
// A truly simultaneous double-create can still race between this check
// and the insert — the unique constraint then rejects the loser.
async function firstFree(prefix: string, count: number, exists: (code: string) => Promise<boolean>) {
  for (let i = 0; i < 25; i++) {
    const code = `${prefix}-${String(count + 1 + i).padStart(6, "0")}`;
    if (!(await exists(code))) return code;
  }
  throw new Error(`Could not allocate a unique ${prefix} code`);
}

export async function nextCustomerCode(): Promise<string> {
  const count = await prisma.customer.count();
  return firstFree("CUS", count, async (c) => !!(await prisma.customer.findUnique({ where: { customerCode: c }, select: { id: true } })));
}

// Kept as `nextWorkCode` internally (the Prisma column is `workCode`
// — an internal identifier, deliberately not renamed, since renaming
// a column is a riskier migration than changing what gets displayed).
// The user-facing label and the prefix on newly generated values are
// "Service ID" / "SID-" — existing WRK-xxxxxx values already stored
// in the database are left exactly as they are; only the format for
// values generated from now on changes.
export async function nextWorkCode(): Promise<string> {
  const count = await prisma.customerService.count();
  return firstFree("SID", count, async (c) => !!(await prisma.customerService.findUnique({ where: { workCode: c }, select: { id: true } })));
}

export async function nextAgentCode(): Promise<string> {
  const count = await prisma.agent.count();
  return firstFree("AGT", count, async (c) => !!(await prisma.agent.findUnique({ where: { agentCode: c }, select: { id: true } })));
}
