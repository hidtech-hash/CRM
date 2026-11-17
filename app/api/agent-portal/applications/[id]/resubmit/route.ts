import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAgentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAgentForUser } from "@/lib/agentContext";
import { removeUploadedFiles } from "@/lib/uploads";
import { collectUploads, saveUploads } from "@/lib/applicationFiles";
import { notifyCustomerOfStatusChange } from "@/lib/whatsapp/notifications";
import { logActivity } from "@/lib/activityLog";

// PUT /api/agent-portal/applications/:id/resubmit
// Corrects and resubmits a REJECTED application — same record, same
// workCode, full history preserved (no new application is created,
// per the spec). Accepts the same shape as the original submission:
// fieldValues (JSON) to update/add values, and requirement_<id> /
// common_<name> / customDocName+customDocFile to add or replace
// documents. Only fields/documents actually sent are touched —
// anything already on the application that isn't resent stays as is.
// On success: status -> PENDING_REVIEW, rejectionReason cleared, and
// it becomes visible to staff again. Still excluded from the agent's
// balance (PENDING_REVIEW), per the payment-timing rule.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAgentRole(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const agent = await getAgentForUser(userId);
  if (!agent) return NextResponse.json({ error: "No agent profile is linked to this login" }, { status: 404 });

  const application = await prisma.customerService.findFirst({
    where: { id: params.id, agentId: agent.id, deletedAt: null },
    include: { service: { include: { fields: true, documentRequirements: { where: { isActive: true } } } } },
  });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (application.status !== "REJECTED") {
    return NextResponse.json({ error: "Only a rejected application can be resubmitted" }, { status: 409 });
  }

  const form = await req.formData();
  const fieldValuesRaw = form.get("fieldValues") as string | null;

  // Only active fields the agent can see may be written.
  const agentFields = application.service.fields.filter((f) => f.isActive && f.visibleToAgent);
  const agentFieldIds = new Set(agentFields.map((f) => f.id));

  let fieldValues: Record<string, string> = {};
  if (fieldValuesRaw) {
    try {
      fieldValues = JSON.parse(fieldValuesRaw);
    } catch {
      return NextResponse.json({ error: "fieldValues must be valid JSON" }, { status: 400 });
    }
  }
  const incoming = Object.entries(fieldValues).filter(
    ([fieldId, value]) => agentFieldIds.has(fieldId) && value !== undefined && value !== null && String(value) !== ""
  );

  // Required fields must be satisfied by what's already saved or what's
  // being sent now.
  const existingValues = await prisma.applicationFieldValue.findMany({ where: { customerServiceId: application.id } });
  const have = new Set(existingValues.filter((v) => (v.value ?? "").trim() !== "").map((v) => v.serviceFieldId));
  for (const [fieldId] of incoming) have.add(fieldId);
  const missingFields = agentFields.filter((f) => f.requiredAtSubmission && !have.has(f.id)).map((f) => f.label);
  if (missingFields.length > 0) {
    return NextResponse.json({ error: `Missing required field(s): ${missingFields.join(", ")}` }, { status: 400 });
  }

  // Store new files first; validate required documents against what's
  // already on file plus what was just uploaded — all before any write.
  const uploads = await saveUploads(collectUploads(form, application.service.documentRequirements));
  if (!uploads.ok) return NextResponse.json({ error: uploads.error }, { status: 400 });

  const currentDocs = await prisma.applicationDocument.findMany({ where: { customerServiceId: application.id } });
  const satisfiedRequirementIds = new Set(currentDocs.map((d) => d.requirementId).filter(Boolean));
  for (const u of uploads.saved) if (u.requirementId) satisfiedRequirementIds.add(u.requirementId);
  const stillMissing = application.service.documentRequirements
    .filter((d) => d.required && !satisfiedRequirementIds.has(d.id))
    .map((d) => d.name);
  if (stillMissing.length > 0) {
    await removeUploadedFiles(uploads.saved.map((u) => u.fileUrl));
    return NextResponse.json({ error: `Still missing required document(s): ${stillMissing.join(", ")}` }, { status: 400 });
  }

  // One transaction: field values + documents + status flip. The status
  // change is compare-and-set (must still be REJECTED), so a double
  // submit applies once.
  let updated;
  try {
    updated = await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.customerService.updateMany({
          where: { id: application.id, status: "REJECTED" },
          data: { status: "PENDING_REVIEW", rejectionReason: null, updatedById: userId },
        });
        if (claimed.count === 0) throw new Error("ALREADY_CHANGED");

        for (const [fieldId, value] of incoming) {
          await tx.applicationFieldValue.upsert({
            where: { customerServiceId_serviceFieldId: { customerServiceId: application.id, serviceFieldId: fieldId } },
            update: { value: String(value), updatedById: userId },
            create: { customerServiceId: application.id, serviceFieldId: fieldId, value: String(value), updatedById: userId },
          });
        }
        if (uploads.saved.length > 0) {
          await tx.applicationDocument.createMany({
            data: uploads.saved.map((u) => ({
              customerServiceId: application.id,
              requirementId: u.requirementId,
              documentName: u.documentName,
              fileUrl: u.fileUrl,
              uploadedById: userId,
            })),
          });
        }
        return tx.customerService.findUniqueOrThrow({ where: { id: application.id } });
      },
      { timeout: 20000 }
    );
  } catch (e: any) {
    await removeUploadedFiles(uploads.saved.map((u) => u.fileUrl));
    if (e?.message === "ALREADY_CHANGED") {
      return NextResponse.json({ error: "This application was already resubmitted or changed." }, { status: 409 });
    }
    console.error("[resubmit] failed:", e?.message);
    return NextResponse.json({ error: "Could not resubmit. Please try again." }, { status: 500 });
  }

  await logActivity({
    userId,
    action: "AGENT_APPLICATION_RESUBMITTED",
    entityType: "CustomerService",
    entityId: application.id,
    previousValue: { status: "REJECTED" },
    newValue: { status: "PENDING_REVIEW" },
  });

  notifyCustomerOfStatusChange({
    applicationId: application.id,
    fromStatus: "REJECTED",
    toStatus: "PENDING_REVIEW",
    transitionStamp: application.updatedAt.getTime(),
  }).catch((e) => console.error("[WhatsApp] Unexpected error in status notification:", e?.message));

  return NextResponse.json({ application: updated });
}
