import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canManageWhatsApp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/whatsapp/messages?status=FAILED
// The Failed Messages screen. Defaults to FAILED only; pass
// ?status=ALL for the full send log if ever needed. Retried messages
// each appear as their own row (linked via retryOfId), so the
// complete attempt history for a given send is visible, not
// collapsed into one mutated record.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWhatsApp(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = new URL(req.url).searchParams.get("status") || "FAILED";
  if (status !== "ALL" && !["QUEUED", "SENT", "FAILED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const messages = await prisma.whatsAppMessage.findMany({
    where: status === "ALL" ? {} : { status: status as any },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      customer: { select: { fullName: true } },
      agent: { select: { name: true } },
      employee: { select: { name: true } },
    },
  });

  return NextResponse.json({ messages });
}
