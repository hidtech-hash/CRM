import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SHARED_TEMPLATE_TYPES } from "@/lib/whatsapp/defaultTemplates";
import { z } from "zod";

const updateSchema = z.object({ body: z.string().min(1).max(4000) });

// PUT /api/whatsapp/templates/:type
// Edits the ONE shared template for this notification type — there
// is no per-agent or per-customer variant to edit; this is the only
// template of this type that exists anywhere.
export async function PUT(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  if (!(SHARED_TEMPLATE_TYPES as string[]).includes(params.type)) {
    return NextResponse.json({ error: "Unknown template type" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const template = await prisma.whatsAppTemplate.upsert({
    where: { type: params.type as any },
    update: { body: parsed.data.body, updatedById: userId },
    create: { type: params.type as any, body: parsed.data.body, updatedById: userId },
  });

  return NextResponse.json({ template });
}
