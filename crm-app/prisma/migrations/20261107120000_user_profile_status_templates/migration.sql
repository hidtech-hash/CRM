-- AlterEnum
ALTER TYPE "WhatsAppTemplateType" ADD VALUE 'AGENT_APPLICATION_TO_EMPLOYEE';
ALTER TYPE "WhatsAppTemplateType" ADD VALUE 'APPLICATION_STATUS_CHANGED';

-- AlterEnum
ALTER TYPE "WhatsAppRecipientType" ADD VALUE 'EMPLOYEE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "tehsil" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "employeeId" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppStatusTemplate" (
    "id" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppStatusTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppStatusTemplate_status_key" ON "WhatsAppStatusTemplate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_dedupeKey_key" ON "WhatsAppMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_employeeId_idx" ON "WhatsAppMessage"("employeeId");

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppStatusTemplate" ADD CONSTRAINT "WhatsAppStatusTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
