import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, canEditServiceStatus } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveApplicationDocument } from "@/lib/uploads";
import { logActivity } from "@/lib/activityLog";

// POST /api/customer-services/:id/documents
// Lets staff add a missing document or replace an existing one on an
// application AFTER submission/acceptance — e.g. a required document
// that was missing, or a clearer re-scan of one already uploaded.
// Multipart form: `file` (required), and either `requirementId` (to
// satisfy/replace a specific configured requirement) or
// `documentName` (for a custom/additional document). Uploading
// against a requirement that already has a document does not delete
// the old one — both stay in the application's document history,
// consistent with "do not delete original documents just because the
// application was accepted."
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditServiceStatus(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const application = await prisma.customerService.findUnique({ where: { id: params.id } });
  if (!application || application.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const requirementId = (form.get("requirementId") as string | null) || null;
  const documentNameRaw = (form.get("documentName") as string | null) || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  let documentName = documentNameRaw;
  if (requirementId) {
    const requirement = await prisma.serviceDocumentRequirement.findUnique({ where: { id: requirementId } });
    if (!requirement) return NextResponse.json({ error: "Document requirement not found" }, { status: 404 });
    documentName = requirement.name;
  }
  if (!documentName) {
    return NextResponse.json({ error: "requirementId or documentName is required" }, { status: 400 });
  }

  const saved = await saveApplicationDocument(file);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });

  const document = await prisma.applicationDocument.create({
    data: {
      customerServiceId: application.id,
      requirementId,
      documentName,
      fileUrl: saved.url,
      uploadedById: userId,
    },
  });

  await logActivity({
    userId,
    action: "APPLICATION_DOCUMENT_ADDED",
    entityType: "CustomerService",
    entityId: application.id,
    newValue: { documentName },
  });

  return NextResponse.json({ document }, { status: 201 });
}
