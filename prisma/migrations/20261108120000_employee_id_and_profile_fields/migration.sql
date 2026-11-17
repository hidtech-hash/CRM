-- Additive migration: new columns + one new table. Nothing is dropped or
-- rewritten. The only data it writes is the NEW employeeCode column
-- (existing Employees receive EMP-000001, EMP-000002, ... in the order
-- they were created) and the starting value of the EMPLOYEE counter.

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateOfJoining" DATE,
ADD COLUMN     "employeeCode" TEXT,
ADD COLUMN     "mobileIsWhatsapp" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

-- Backfill: give every existing Employee an ID, oldest first.
WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
    FROM "User"
    WHERE "role" = 'EMPLOYEE'
)
UPDATE "User" u
SET "employeeCode" = 'EMP-' || LPAD(numbered.n::text, 6, '0')
FROM numbered
WHERE u."id" = numbered."id";

-- Start the counter after the backfilled IDs (0 when there are no employees yet).
INSERT INTO "Counter" ("key", "value", "updatedAt")
SELECT 'EMPLOYEE', COUNT(*)::int, NOW() FROM "User" WHERE "role" = 'EMPLOYEE';
