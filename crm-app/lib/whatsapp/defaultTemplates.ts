// Built-in default message bodies — the ONE place they are defined.
// prisma/seed.ts seeds from these, and the sending code falls back to
// them when a template row hasn't been created in the database yet, so
// a new template type or status works immediately after deploy without
// anyone having to re-run the seed.

export type SharedTemplateType =
  | "CUSTOMER_CREATED"
  | "SERVICE_APPLIED"
  | "AGENT_PAYMENT_REMINDER"
  | "AGENT_APPLICATION_TO_EMPLOYEE";

export const SHARED_TEMPLATE_TYPES: SharedTemplateType[] = [
  "CUSTOMER_CREATED",
  "SERVICE_APPLIED",
  "AGENT_APPLICATION_TO_EMPLOYEE",
  "AGENT_PAYMENT_REMINDER",
];

export const DEFAULT_TEMPLATES: Record<SharedTemplateType, string> = {
  CUSTOMER_CREATED:
    "Thank you for choosing us.\n\nDear {CUSTOMER_NAME},\n\nYou are now our customer.\n\nYour Customer ID is: {CUSTOMER_ID}\n\nThank you for trusting us.",
  SERVICE_APPLIED:
    "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been successfully submitted.\n\nService ID: {SERVICE_ID}\n\nWe will keep you updated regarding your application.",
  AGENT_PAYMENT_REMINDER:
    "Dear {AGENT_NAME},\n\nThis is a reminder that your pending payment of ₹{PENDING_AMOUNT} is overdue.\n\nYour payment has been pending for {PENDING_DAYS} days.\n\nPlease clear your pending payment using the link below:\n\n{UPI_LINK}\n\nThank you.",
  AGENT_APPLICATION_TO_EMPLOYEE:
    "Agent {AGENT_NAME} ({ENTERPRISE_NAME}) has applied for {SERVICE_NAME} for customer {CUSTOMER_NAME} ({CUSTOMER_ID}). Please review the application.\n\nApplication ID: {SERVICE_ID}\nDate: {DATE} {TIME}",
};

// ---- Status-change (customer) templates ------------------------------

export const SERVICE_STATUSES = [
  "NEW",
  "PENDING_REVIEW",
  "ASSIGNED",
  "ACCEPTED",
  "PROCESSING",
  "DOCUMENT_REQUIRED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ServiceStatusName = (typeof SERVICE_STATUSES)[number];

// Customer-facing wording for the {STATUS} variable.
export const STATUS_LABELS: Record<ServiceStatusName, string> = {
  NEW: "New",
  PENDING_REVIEW: "Pending Review",
  ASSIGNED: "Assigned",
  ACCEPTED: "Approved",
  PROCESSING: "In Progress",
  DOCUMENT_REQUIRED: "Documents Required",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

// Internal-only statuses default to OFF (the customer already got the
// "service applied" message, and these are staff workflow steps); all
// customer-visible statuses default to ON. Everything is editable and
// switchable from WhatsApp → Message Templates.
export const DEFAULT_STATUS_TEMPLATES: Record<ServiceStatusName, { body: string; enabled: boolean }> = {
  NEW: {
    enabled: false,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been received.\n\nService ID: {SERVICE_ID}",
  },
  PENDING_REVIEW: {
    enabled: false,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} is pending review.\n\nService ID: {SERVICE_ID}",
  },
  ASSIGNED: {
    enabled: false,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been assigned to our team.\n\nService ID: {SERVICE_ID}",
  },
  ACCEPTED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been approved.\n\nService ID: {SERVICE_ID}",
  },
  PROCESSING: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} is now in progress.\n\nService ID: {SERVICE_ID}",
  },
  DOCUMENT_REQUIRED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} needs additional documents. Our team will contact you shortly.\n\nService ID: {SERVICE_ID}",
  },
  SUBMITTED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been submitted successfully.\n\nService ID: {SERVICE_ID}\nReference Number: {REFERENCE_NUMBER}",
  },
  COMPLETED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been completed successfully.\n\nService ID: {SERVICE_ID}\nReference Number: {REFERENCE_NUMBER}\n\nThank you for choosing us.",
  },
  REJECTED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} could not be processed.\n\nService ID: {SERVICE_ID}\nReason: {REJECTION_REASON}",
  },
  CANCELLED: {
    enabled: true,
    body: "Dear {CUSTOMER_NAME},\n\nYour application for {SERVICE_NAME} has been cancelled.\n\nService ID: {SERVICE_ID}",
  },
};

// Variables each kind of template may use (shown in the editor UI).
export const TEMPLATE_VARIABLES: Record<SharedTemplateType, string[]> = {
  CUSTOMER_CREATED: ["{CUSTOMER_NAME}", "{CUSTOMER_ID}", "{DATE}", "{TIME}"],
  SERVICE_APPLIED: ["{CUSTOMER_NAME}", "{CUSTOMER_ID}", "{SERVICE_NAME}", "{SERVICE_ID}", "{DATE}", "{TIME}"],
  AGENT_APPLICATION_TO_EMPLOYEE: [
    "{AGENT_NAME}",
    "{AGENT_ID}",
    "{ENTERPRISE_NAME}",
    "{CUSTOMER_NAME}",
    "{CUSTOMER_ID}",
    "{SERVICE_NAME}",
    "{SERVICE_ID}",
    "{APPLICATION_ID}",
    "{DATE}",
    "{TIME}",
  ],
  AGENT_PAYMENT_REMINDER: [
    "{AGENT_NAME}",
    "{AGENT_ID}",
    "{ENTERPRISE_NAME}",
    "{PENDING_AMOUNT}",
    "{PENDING_DAYS}",
    "{UPI_LINK}",
    "{DATE}",
    "{TIME}",
  ],
};

export const STATUS_TEMPLATE_VARIABLES = [
  "{CUSTOMER_NAME}",
  "{CUSTOMER_ID}",
  "{SERVICE_NAME}",
  "{SERVICE_ID}",
  "{APPLICATION_ID}",
  "{REFERENCE_NUMBER}",
  "{STATUS}",
  "{REJECTION_REASON}",
  "{DATE}",
  "{TIME}",
  "{AGENT_NAME}",
  "{AGENT_ID}",
  "{ENTERPRISE_NAME}",
];
