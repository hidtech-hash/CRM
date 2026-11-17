import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAgentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAgentForUser } from "@/lib/agentContext";
import { findCustomerByMobile } from "@/lib/customerLookup";
import { nextWorkCode, nextCustomerCode } from "@/lib/codes";
import { removeUploadedFiles } from "@/lib/uploads";
import { collectUploads, saveUploads } from "@/lib/applicationFiles";
import { agentNewCustomerSchema, customerDataForCreate } from "@/lib/validation/customer";
import { logActivity } from "@/lib/activityLog";
import { sendWhatsAppMessage, resolveCustomerWhatsAppNumber } from "@/lib/whatsapp/service";
import { notifyEmployeesOfAgentApplication } from "@/lib/whatsapp/notifications";

// POST /api/agent-portal/applications
// The Agent's "Apply for Service" submission. Entirely generic —
// which fields/documents are required comes from the Service's own
// configuration (ServiceField / ServiceDocumentRequirement), never
// from an if/else on the service name.
//
// Multipart form fields:
//   customerId       — existing customer id, OR:
//   newCustomer      — JSON string with the SAME customer fields (and the
//                       same validation) as staff "Add Customer", minus
//                       internal notes — see lib/validation/customer.ts
//   serviceId        — required
//   fieldValues      — JSON string { [serviceFieldId]: value }
//   requirement_<id> — File, one per ServiceDocumentRequirement satisfied
//   common_<name>    — File, optional common document (Aadhaar/Photo/Signature)
//   customDocName    — repeated text field, one per custom document
//   customDocFile    — repeated File field, same order as customDocName
//
// Status is ALWAYS "PENDING_REVIEW" and amount is ALWAYS the
// service's fixed agentPrice — neither is influenced by anything the
// agent sends. Per the payment-timing rule, PENDING_REVIEW is
// excluded from the agent's balance (see lib/agentContext.ts), so
// submitting never increases what the agent owes.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAgentRole(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const agent = await getAgentForUser(userId);
  if (!agent) return NextResponse.json({ error: "No agent profile is linked to this login" }, { status: 404 });

  const form = await req.formData();
  const customerId = form.get("customerId") as string | null;
  const newCustomerRaw = form.get("newCustomer") as string | null;
  const serviceId = form.get("serviceId") as string | null;
  const fieldValuesRaw = form.get("fieldValues") as string | null;

  if (!serviceId) return NextResponse.json({ error: "serviceId is required" }, { status: 400 });

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      fields: { where: { isActive: true } },
      documentRequirements: { where: { isActive: true } },
    },
  });
  if (!service || !service.isActive) {
    return NextResponse.json({ error: "Service not found or inactive" }, { status: 404 });
  }

  // ---- 1. Validate everything BEFORE writing anything ----

  // Customer: existing id, or validated new-customer details.
  let existingCustomerId: string | null = null;
  let newCustomerData: Record<string, any> | null = null;
  if (customerId) {
    const existing = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    existingCustomerId = existing.id;
  } else {
    if (!newCustomerRaw) {
      return NextResponse.json({ error: "customerId or newCustomer is required" }, { status: 400 });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(newCustomerRaw);
    } catch {
      return NextResponse.json({ error: "newCustomer must be valid JSON" }, { status: 400 });
    }
    const parsed = agentNewCustomerSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const messages = Object.values(parsed.error.flatten().fieldErrors).flat().filter(Boolean);
      return NextResponse.json({ error: messages.join(" · ") || "Invalid customer details" }, { status: 400 });
    }
    // Find-or-create by mobile so a skipped client-side "check first"
    // step can never create a duplicate.
    const existing = await findCustomerByMobile(parsed.data.mobile);
    if (existing) existingCustomerId = existing.id;
    else newCustomerData = customerDataForCreate(parsed.data);
  }

  // Field values: only fields the agent is allowed to see are accepted
  // or required — a field hidden from agents can't block (or be written
  // by) an agent submission.
  const agentFields = service.fields.filter((f) => f.visibleToAgent);
  let fieldValues: Record<string, string> = {};
  if (fieldValuesRaw) {
    try {
      fieldValues = JSON.parse(fieldValuesRaw);
    } catch {
      return NextResponse.json({ error: "fieldValues must be valid JSON" }, { status: 400 });
    }
  }
  const missingFields = agentFields
    .filter((f) => f.requiredAtSubmission)
    .filter((f) => !fieldValues[f.id] || String(fieldValues[f.id]).trim() === "")
    .map((f) => f.label);
  if (missingFields.length > 0) {
    return NextResponse.json({ error: `Missing required field(s): ${missingFields.join(", ")}` }, { status: 400 });
  }

  const missingDocs = service.documentRequirements
    .filter((d) => d.required)
    .filter((d) => !(form.get(`requirement_${d.id}`) instanceof File))
    .map((d) => d.name);
  if (missingDocs.length > 0) {
    return NextResponse.json({ error: `Missing required document(s): ${missingDocs.join(", ")}` }, { status: 400 });
  }

  // ---- 2. Store files first (validated + signature-checked). A bad
  // required file aborts here, before any database row exists. ----
  const uploads = await saveUploads(collectUploads(form, service.documentRequirements));
  if (!uploads.ok) {
    return NextResponse.json({ error: uploads.error }, { status: 400 });
  }

  // ---- 3. One transaction: customer (if new) + application + field
  // values + document rows. All or nothing. ----
  const customerCode = newCustomerData ? await nextCustomerCode() : null;
  const workCode = await nextWorkCode();
  let application;
  let resolvedCustomerId: string;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        let custId = existingCustomerId;
        if (!custId) {
          const created = await tx.customer.create({
            data: { customerCode: customerCode!, ...(newCustomerData as any), createdById: userId },
          });
          custId = created.id;
        }

        // Price is ALWAYS the fixed agent price, status ALWAYS PENDING_REVIEW.
        const app = await tx.customerService.create({
          data: {
            workCode,
            customerId: custId,
            serviceId,
            agentId: agent.id,
            status: "PENDING_REVIEW",
            amount: service.agentPrice,
            createdById: userId,
          },
        });

        const valueRows = agentFields
          .map((f) => ({ f, v: fieldValues[f.id] }))
          .filter(({ v }) => v !== undefined && v !== null && String(v) !== "")
          .map(({ f, v }) => ({
            customerServiceId: app.id,
            serviceFieldId: f.id,
            value: String(v),
            updatedById: userId,
          }));
        if (valueRows.length > 0) await tx.applicationFieldValue.createMany({ data: valueRows });

        if (uploads.saved.length > 0) {
          await tx.applicationDocument.createMany({
            data: uploads.saved.map((u) => ({
              customerServiceId: app.id,
              requirementId: u.requirementId,
              documentName: u.documentName,
              fileUrl: u.fileUrl,
              uploadedById: userId,
            })),
          });
        }
        return { app, custId };
      },
      { timeout: 20000 }
    );
    application = result.app;
    resolvedCustomerId = result.custId;
  } catch (e: any) {
    // Nothing was committed — remove the files we stored for it.
    await removeUploadedFiles(uploads.saved.map((u) => u.fileUrl));
    console.error("[agent apply] transaction failed:", e?.message);
    return NextResponse.json({ error: "Could not submit the application. Please try again." }, { status: 500 });
  }

  await logActivity({
    userId,
    action: "AGENT_APPLICATION_SUBMITTED",
    entityType: "CustomerService",
    entityId: application.id,
    newValue: { workCode: application.workCode, service: service.name },
  });

  // Fire-and-forget — see lib/whatsapp/service.ts: never throws and
  // never blocks this response.
  const notifyCustomer = await prisma.customer.findUnique({ where: { id: resolvedCustomerId } });
  if (notifyCustomer) {
    const waNumber = resolveCustomerWhatsAppNumber(notifyCustomer);
    if (waNumber) {
      sendWhatsAppMessage({
        templateType: "SERVICE_APPLIED",
        recipientType: "CUSTOMER",
        toNumberRaw: waNumber,
        customerId: notifyCustomer.id,
        customerServiceId: application.id,
        dedupeKey: `service-applied:${application.id}`,
        variables: {
          CUSTOMER_NAME: notifyCustomer.fullName,
          CUSTOMER_ID: notifyCustomer.customerCode,
          SERVICE_NAME: service.name,
          SERVICE_ID: application.workCode,
        },
      }).catch((e) => console.error("[WhatsApp] Unexpected error sending service-applied notification:", e?.message));
    } else {
      console.log(`[WhatsApp] Skipping service applied notification for ${application.workCode} — no number marked as WhatsApp`);
    }
  }

  // Tell the reviewing employee(s) an agent has applied.
  notifyEmployeesOfAgentApplication(application.id).catch((e) =>
    console.error("[WhatsApp] Unexpected error sending employee notification:", e?.message)
  );

  return NextResponse.json({ application }, { status: 201 });
}
