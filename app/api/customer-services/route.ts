import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canAssignWork, canManagePayments } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextWorkCode } from "@/lib/codes";
import { logActivity } from "@/lib/activityLog";
import { removeUploadedFiles } from "@/lib/uploads";
import { collectUploads, saveUploads } from "@/lib/applicationFiles";
import { sendWhatsAppMessage, resolveCustomerWhatsAppNumber } from "@/lib/whatsapp/service";

// POST /api/customer-services
// "Customer applied for a service" — the core action, used by
// Admin/Manager/Employee applying on behalf of a walk-in/direct
// customer (the Agent's own equivalent is
// /api/agent-portal/applications — same Service model, same dynamic
// field/document configuration, just a separate route so it sits
// inside the AGENT middleware allowlist).
//
// Multipart form fields (mirrors the agent-portal endpoint exactly,
// so both apply forms behave identically from the Service's point of
// view — no service-specific branching anywhere):
//   customerId, serviceId       — required
//   agentId, assignedEmployeeId — optional
//   amount                      — optional manual override (admin/manager only)
//   notes, expectedDate         — optional
//   fieldValues                 — JSON string { [serviceFieldId]: value }
//   requirement_<id>            — File, one per ServiceDocumentRequirement satisfied
//   common_<name>                — File, optional common document
//   customDocName / customDocFile — repeated, one custom document each
//
// No commission math: the price is either the service's fixed
// customer price or its fixed agent price, chosen automatically
// based on whether an agent is linked.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;

  const form = await req.formData();
  const customerId = form.get("customerId") as string | null;
  const serviceId = form.get("serviceId") as string | null;
  const agentId = (form.get("agentId") as string | null) || undefined;
  const assignedEmployeeIdRaw = (form.get("assignedEmployeeId") as string | null) || undefined;
  const amountRaw = form.get("amount") as string | null;
  const amount = amountRaw ? Number(amountRaw) : undefined;
  const notes = (form.get("notes") as string | null) || undefined;
  const expectedDate = (form.get("expectedDate") as string | null) || undefined;
  const fieldValuesRaw = form.get("fieldValues") as string | null;

  if (!customerId || !serviceId) {
    return NextResponse.json({ error: "customerId and serviceId are required" }, { status: 400 });
  }

  // Server-side permission enforcement (never trust the frontend hiding a
  // field — someone could still call this API directly):
  // - Anyone who can apply a service can record which agent brought the
  //   work — this is just data entry now, no financial figure to set,
  //   since the price comes automatically from the service's fixed rates.
  // - Only admin/manager may assign the work to someone OTHER than
  //   themselves. Anyone is allowed to leave it unassigned, which then
  //   defaults to themselves (if they're an employee) below.
  // - Only admin/manager may override the auto-calculated price.
  if (assignedEmployeeIdRaw && assignedEmployeeIdRaw !== userId && !canAssignWork(role)) {
    return NextResponse.json({ error: "Forbidden: cannot assign to another employee" }, { status: 403 });
  }
  if (amount !== undefined && !canManagePayments(role)) {
    return NextResponse.json({ error: "Forbidden: cannot override price" }, { status: 403 });
  }

  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  }
  if (agentId) {
    const agentRow = await prisma.agent.findUnique({ where: { id: agentId }, select: { deletedAt: true } });
    if (!agentRow || agentRow.deletedAt) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
  }
  if (assignedEmployeeIdRaw) {
    const emp = await prisma.user.findUnique({ where: { id: assignedEmployeeIdRaw }, select: { isActive: true, role: true } });
    if (!emp || !emp.isActive || emp.role === "AGENT") {
      return NextResponse.json({ error: "Assigned employee not found" }, { status: 404 });
    }
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

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

  // Validate required fields/documents exactly like the agent flow —
  // same Service configuration, same rules, regardless of who's
  // applying. Fields not visible to this role are skipped: if an
  // Employee can't see a field, they can't be required to fill it in.
  const roleVisibilityKey = role === "EMPLOYEE" ? "visibleToEmployee" : "visibleToAdmin";
  let fieldValues: Record<string, string> = {};
  if (fieldValuesRaw) {
    try {
      fieldValues = JSON.parse(fieldValuesRaw);
    } catch {
      return NextResponse.json({ error: "fieldValues must be valid JSON" }, { status: 400 });
    }
  }
  const missingFields = service.fields
    .filter((f) => f.requiredAtSubmission && (f as any)[roleVisibilityKey])
    .filter((f) => !fieldValues[f.id] || String(fieldValues[f.id]).trim() === "")
    .map((f) => f.label);
  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missingFields.join(", ")}` },
      { status: 400 }
    );
  }
  const missingDocs = service.documentRequirements
    .filter((d) => d.required)
    .filter((d) => !(form.get(`requirement_${d.id}`) instanceof File))
    .map((d) => d.name);
  if (missingDocs.length > 0) {
    return NextResponse.json(
      { error: `Missing required document(s): ${missingDocs.join(", ")}` },
      { status: 400 }
    );
  }

  // Auto-pick the fixed price: agent price if this work came through an
  // agent, otherwise the normal customer price. Admin/Manager can still
  // pass an explicit `amount` to override (e.g. a one-off discount).
  const autoAmount = agentId ? service.agentPrice : service.customerPrice;
  const finalAmount = amount !== undefined ? amount : autoAmount;

  // Store (and validate) every file BEFORE any database row is written,
  // so a bad required file can't leave a half-built application behind.
  const uploads = await saveUploads(collectUploads(form, service.documentRequirements));
  if (!uploads.ok) {
    return NextResponse.json({ error: uploads.error }, { status: 400 });
  }

  const workCode = await nextWorkCode();

  // If nobody explicitly assigned this work, default it to whoever is
  // intaking it (if they're an employee) so it shows up on their own
  // dashboard as work they need to follow up on. Admin/Manager intake
  // stays unassigned by default — it sits in the shared queue until
  // deliberately assigned.
  const assignedEmployeeId = assignedEmployeeIdRaw || (role === "EMPLOYEE" ? userId : null);

  let record;
  try {
    record = await prisma.$transaction(
      async (tx) => {
        const created = await tx.customerService.create({
          data: {
            workCode,
            customerId,
            serviceId,
            agentId: agentId || null,
            assignedEmployeeId,
            status: assignedEmployeeId ? "ASSIGNED" : "NEW",
            // Staff-created applications start balance-eligible immediately
            // (they never go through PENDING_REVIEW), so acceptedAt is now
            // — see lib/agentContext.ts for how this drives "days pending".
            acceptedAt: new Date(),
            amount: finalAmount,
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            notes: notes || null,
            createdById: userId,
          },
          include: { service: true, agent: true },
        });

        // Same ApplicationFieldValue model the agent flow uses, so a later
        // view/edit shows everything from one place regardless of who
        // originally applied. Only fields this role can see are accepted.
        const valueRows = service.fields
          .filter((f) => (f as any)[roleVisibilityKey])
          .map((f) => ({ f, v: fieldValues[f.id] }))
          .filter(({ v }) => v !== undefined && v !== null && String(v) !== "")
          .map(({ f, v }) => ({
            customerServiceId: created.id,
            serviceFieldId: f.id,
            value: String(v),
            updatedById: userId,
          }));
        if (valueRows.length > 0) await tx.applicationFieldValue.createMany({ data: valueRows });

        if (uploads.saved.length > 0) {
          await tx.applicationDocument.createMany({
            data: uploads.saved.map((u) => ({
              customerServiceId: created.id,
              requirementId: u.requirementId,
              documentName: u.documentName,
              fileUrl: u.fileUrl,
              uploadedById: userId,
            })),
          });
        }
        return created;
      },
      { timeout: 20000 }
    );
  } catch (e: any) {
    await removeUploadedFiles(uploads.saved.map((u) => u.fileUrl));
    console.error("[customer-services] create failed:", e?.message);
    return NextResponse.json({ error: "Could not create the application. Please try again." }, { status: 500 });
  }

  if (record.agentId) {
    await logActivity({
      userId,
      action: "SERVICE_LINKED_TO_AGENT",
      entityType: "CustomerService",
      entityId: record.id,
      newValue: { agentId: record.agentId, agentName: record.agent?.name, agentPrice: finalAmount },
    });
  }
  if (record.assignedEmployeeId) {
    await logActivity({
      userId,
      action: "SERVICE_ASSIGNED",
      entityType: "CustomerService",
      entityId: record.id,
      newValue: { assignedEmployeeId: record.assignedEmployeeId },
    });
  }

  await logActivity({
    userId,
    action: "SERVICE_APPLIED",
    entityType: "CustomerService",
    entityId: record.id,
    newValue: { workCode: record.workCode, service: record.service.name, status: record.status, amount: finalAmount },
  });

  // Fire-and-forget — see lib/whatsapp/service.ts: never throws,
  // never blocks this response.
  const waNumber = resolveCustomerWhatsAppNumber(customer);
  if (waNumber) {
    console.log(`[WhatsApp] Service applied notification triggered for ${record.workCode}`);
    sendWhatsAppMessage({
      templateType: "SERVICE_APPLIED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: customer.id,
      customerServiceId: record.id,
      dedupeKey: `service-applied:${record.id}`,
      variables: {
        CUSTOMER_NAME: customer.fullName,
        CUSTOMER_ID: customer.customerCode,
        SERVICE_NAME: record.service.name,
        SERVICE_ID: record.workCode,
      },
    }).catch((e) => console.error("[WhatsApp] Unexpected error sending service-applied notification:", e?.message));
  } else {
    console.log(`[WhatsApp] Skipping service applied notification for ${record.workCode} — no number marked as WhatsApp`);
  }

  return NextResponse.json({ customerService: record }, { status: 201 });
}
