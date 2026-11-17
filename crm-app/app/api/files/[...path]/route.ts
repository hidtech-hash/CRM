import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { readFile } from "fs/promises";
import path from "path";
import { authOptions, isAgentRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAgentForUser } from "@/lib/agentContext";
import { UPLOAD_ROOT, UPLOAD_SUBDIRS } from "@/lib/uploads";

// GET /api/files/<subdir>/<filename>
// Reached through the middleware rewrite of /uploads/<subdir>/<filename>
// (so every stored fileUrl and every existing link keeps working). Only a
// signed-in user gets a file, and an AGENT only gets files that belong to
// THEIR OWN applications / payment requests. Staff roles can view any
// file, as they could before.
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const segments = params.path ?? [];
  if (segments.length !== 2) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [subdir, filename] = segments;
  if (!(UPLOAD_SUBDIRS as readonly string[]).includes(subdir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only filenames this app itself generates (blocks "..", slashes, etc.).
  const match = /^\d+-[0-9a-f]{12}\.(png|jpg|webp|pdf)$/.exec(filename);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const role = (session.user as any)?.role;
  const userId = (session.user as any)?.id as string;
  const url = `/uploads/${subdir}/${filename}`;

  if (isAgentRole(role)) {
    const agent = await getAgentForUser(userId);
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const owned =
      subdir === "application-documents"
        ? await prisma.applicationDocument.findFirst({
            where: { fileUrl: url, customerService: { agentId: agent.id, deletedAt: null } },
            select: { id: true },
          })
        : await prisma.agentPaymentRequest.findFirst({
            where: { screenshotUrl: url, agentId: agent.id },
            select: { id: true },
          });
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const abs = path.join(UPLOAD_ROOT, subdir, filename);
  if (!abs.startsWith(UPLOAD_ROOT)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let data: Buffer;
  try {
    data = await readFile(abs);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[match[1]] ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
