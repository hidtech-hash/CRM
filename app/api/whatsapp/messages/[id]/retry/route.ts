import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { retryWhatsAppMessage } from "@/lib/whatsapp/service";
import { z } from "zod";

const retrySchema = z.object({ toNumber: z.string().optional() });

// POST /api/whatsapp/messages/:id/retry
// Resends a failed message — optionally to a corrected number (e.g.
// the original was mistyped or not on WhatsApp). Creates a new
// WhatsAppMessage row rather than mutating the original; a customer
// never has to be re-created just to fix their WhatsApp number.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = retrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await retryWhatsAppMessage(params.id, parsed.data.toNumber);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not retry message" }, { status: 400 });
  }
}
