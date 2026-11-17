import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TEMPLATES, SHARED_TEMPLATE_TYPES, TEMPLATE_VARIABLES, STATUS_TEMPLATE_VARIABLES } from "@/lib/whatsapp/defaultTemplates";
import { listStatusTemplates } from "@/lib/whatsapp/notifications";

// GET /api/whatsapp/templates
// The shared, global template set — ONE row per notification type,
// never per-agent or per-customer — plus the per-status customer
// notification templates. A template that has never been saved shows
// its built-in default (isDefault: true), so new template types appear
// in the UI immediately without re-running the seed.
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.whatsAppTemplate.findMany();
  const templates = SHARED_TEMPLATE_TYPES.map((type) => {
    const row = rows.find((r) => r.type === type);
    return {
      type,
      body: row?.body ?? DEFAULT_TEMPLATES[type],
      isDefault: !row,
      variables: TEMPLATE_VARIABLES[type],
    };
  });

  const statusTemplates = await listStatusTemplates();
  return NextResponse.json({ templates, statusTemplates, statusVariables: STATUS_TEMPLATE_VARIABLES });
}
