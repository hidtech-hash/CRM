import type { Prisma } from "@prisma/client";

export function formatEmployeeCode(n: number): string {
  return `EMP-${String(n).padStart(6, "0")}`;
}

// Allocates the next Employee ID. Must be called with the transaction
// client of the SAME transaction that creates (or re-roles) the user:
//   - concurrency-safe: one INSERT ... ON CONFLICT DO UPDATE ... RETURNING
//     statement; PostgreSQL row-locks the counter, so two simultaneous
//     requests always get different numbers (never count()+1);
//   - gap-free on failure: if the surrounding transaction rolls back, the
//     increment rolls back with it.
export async function allocateEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt")
    VALUES ('EMPLOYEE', 1, NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = "Counter"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"`;
  return formatEmployeeCode(Number(rows[0].value));
}
