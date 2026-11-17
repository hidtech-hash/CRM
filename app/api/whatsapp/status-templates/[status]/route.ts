import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SERVICE_STATUSES } from "@/lib/whatsapp/defaultTemplates";
import { z } from "zod";

const updateSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  isEnabled: z.boolean().optional(),
});

// PUT /api/whatsapp/status-templates/:status
// Edit the customer notification sent when an application moves INTO
// this status, and/or switch it on or off. One shared template per
// status — adding notifications for another status is just another row.
export async function PUT(req: NextRequest, { params }: { params: { status: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  if (!(SERVICE_STATUSES as readonly string[]).includes(params.status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // First save of a status that only had the built-in default: start
  // from that default so editing just the on/off switch keeps the text.
  const { DEFAULT_STATUS_TEMPLATES } = await import("@/lib/whatsapp/defaultTemplates");
  const def = DEFAULT_STATUS_TEMPLATES[params.status as keyof typeof DEFAULT_STATUS_TEMPLATES];
  const existing = await prisma.whatsAppStatusTemplate.findUnique({ where: { status: params.status as any } });

  const template = await prisma.whatsAppStatusTemplate.upsert({
    where: { status: params.status as any },
    update: {
      body: parsed.data.body ?? undefined,
      isEnabled: parsed.data.isEnabled ?? undefined,
      updatedById: userId,
    },
    create: {
      status: params.status as any,
      body: parsed.data.body ?? existing?.body ?? def.body,
      isEnabled: parsed.data.isEnabled ?? def.enabled,
      updatedById: userId,
    },
  });

  return NextResponse.json({ template });
}
