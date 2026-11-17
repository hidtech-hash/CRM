// ============================================================
// Event-level WhatsApp notifications built on the ONE centralized
// sender (service.ts). Both functions here NEVER throw and are meant to
// be called fire-and-forget after the CRM change has already been
// saved: if WhatsApp is down or a message fails, the application /
// status change still stands and the failure is logged for the existing
// Failed Messages screen.
// ============================================================

import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage, resolveCustomerWhatsAppNumber } from "./service";
import {
  DEFAULT_STATUS_TEMPLATES,
  SERVICE_STATUSES,
  STATUS_LABELS,
  ServiceStatusName,
} from "./defaultTemplates";

// ---- Status template lookup (DB row wins, built-in default otherwise) ----

export async function getStatusTemplate(status: string): Promise<{ body: string; enabled: boolean } | null> {
  if (!(SERVICE_STATUSES as readonly string[]).includes(status)) return null;
  const row = await prisma.whatsAppStatusTemplate.findUnique({ where: { status: status as any } });
  if (row) return { body: row.body, enabled: row.isEnabled };
  return DEFAULT_STATUS_TEMPLATES[status as ServiceStatusName];
}

export async function listStatusTemplates() {
  const rows = await prisma.whatsAppStatusTemplate.findMany();
  return SERVICE_STATUSES.map((status) => {
    const row = rows.find((r) => r.status === status);
    const def = DEFAULT_STATUS_TEMPLATES[status];
    return {
      status,
      label: STATUS_LABELS[status],
      body: row?.body ?? def.body,
      isEnabled: row ? row.isEnabled : def.enabled,
      isDefault: !row,
    };
  });
}

// ---- Customer: application status actually changed ----

export async function notifyCustomerOfStatusChange(params: {
  applicationId: string;
  fromStatus: string;
  toStatus: string;
  // A value that changes with every real update of the application
  // (its previous updatedAt in ms). Combined with from→to it makes the
  // idempotency key unique per genuine transition but identical for
  // duplicate deliveries of the SAME transition.
  transitionStamp: number;
}) {
  try {
    if (params.fromStatus === params.toStatus) return; // not a change

    const template = await getStatusTemplate(params.toStatus);
    if (!template || !template.enabled) return;

    const app = await prisma.customerService.findUnique({
      where: { id: params.applicationId },
      include: { customer: true, service: true, agent: true },
    });
    if (!app || app.deletedAt || !app.customer) return;

    const waNumber = resolveCustomerWhatsAppNumber(app.customer);
    if (!waNumber) {
      console.log(`[WhatsApp] Skipping status notification for ${app.workCode} — customer has no WhatsApp number`);
      return;
    }

    await sendWhatsAppMessage({
      templateType: "APPLICATION_STATUS_CHANGED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: app.customerId,
      customerServiceId: app.id,
      templateBody: template.body,
      dedupeKey: `status:${app.id}:${params.fromStatus}->${params.toStatus}:${params.transitionStamp}`,
      variables: {
        CUSTOMER_NAME: app.customer.fullName,
        CUSTOMER_ID: app.customer.customerCode,
        SERVICE_NAME: app.service.name,
        SERVICE_ID: app.workCode,
        APPLICATION_ID: app.workCode,
        REFERENCE_NUMBER: app.referenceNumber,
        STATUS: STATUS_LABELS[params.toStatus as ServiceStatusName] ?? params.toStatus,
        REJECTION_REASON: app.rejectionReason,
        AGENT_NAME: app.agent?.name,
        AGENT_ID: app.agent?.agentCode,
        ENTERPRISE_NAME: app.agent?.enterpriseName,
      },
    });
  } catch (e: any) {
    console.error("[WhatsApp] Status notification error:", e?.message);
  }
}

// ---- Employee: an agent applied for a service ----

// Recipient rule (existing assignment/workflow logic): the employee the
// application is assigned to, if any. Agent submissions normally start
// UNASSIGNED (they sit in the shared Pending Review queue that every
// staff role can accept), so otherwise the active EMPLOYEE accounts that
// have a mobile number are notified; if there are none, active
// MANAGER/ADMIN accounts with a mobile number are used so the
// notification is never silently lost.
export async function notifyEmployeesOfAgentApplication(applicationId: string) {
  try {
    const app = await prisma.customerService.findUnique({
      where: { id: applicationId },
      include: { customer: true, service: true, agent: true, assignedEmployee: true },
    });
    if (!app || !app.agent) return;

    // Only a mobile number the user has marked as a WhatsApp number is
    // used (same rule as customers' WhatsApp flags).
    type Recipient = { id: string; name: string; mobile: string | null };
    const assigned: any = app.assignedEmployee;
    let recipients: Recipient[] = [];
    if (assigned && assigned.isActive) {
      recipients = [{ id: assigned.id, name: assigned.name, mobile: assigned.mobileIsWhatsapp ? assigned.mobile : null }];
    } else {
      recipients = await prisma.user.findMany({
        where: { isActive: true, role: "EMPLOYEE", mobile: { not: null }, mobileIsWhatsapp: true },
        select: { id: true, name: true, mobile: true },
      });
      if (recipients.length === 0) {
        recipients = await prisma.user.findMany({
          where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] }, mobile: { not: null }, mobileIsWhatsapp: true },
          select: { id: true, name: true, mobile: true },
        });
      }
    }

    if (recipients.length === 0) {
      console.log(`[WhatsApp] No employee with a WhatsApp number to notify for ${app.workCode}`);
      return;
    }

    for (const r of recipients) {
      if (!r.mobile) {
        console.log(`[WhatsApp] Skipping employee ${r.id} for ${app.workCode} — no WhatsApp number on profile`);
        continue;
      }
      await sendWhatsAppMessage({
        templateType: "AGENT_APPLICATION_TO_EMPLOYEE",
        recipientType: "EMPLOYEE",
        toNumberRaw: r.mobile,
        employeeId: r.id,
        agentId: app.agent.id,
        customerId: app.customerId,
        customerServiceId: app.id,
        dedupeKey: `agent-app:${app.id}:${r.id}`,
        variables: {
          AGENT_NAME: app.agent.name,
          AGENT_ID: app.agent.agentCode,
          ENTERPRISE_NAME: app.agent.enterpriseName,
          CUSTOMER_NAME: app.customer.fullName,
          CUSTOMER_ID: app.customer.customerCode,
          SERVICE_NAME: app.service.name,
          SERVICE_ID: app.workCode,
          APPLICATION_ID: app.workCode,
        },
      });
    }
  } catch (e: any) {
    console.error("[WhatsApp] Employee notification error:", e?.message);
  }
}
