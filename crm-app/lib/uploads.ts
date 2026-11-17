import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Files are stored under /public/uploads/<subdir> (existing layout —
// existing fileUrl values keep working). They are NOT served as public
// static files any more: middleware.ts rewrites every /uploads/* request
// to /api/files/*, which requires a session and checks that the caller
// is allowed to see that particular file. For production, swap this for
// object storage (S3/R2) behind the same authorization check.
export const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");
const PUBLIC_ROOT = "/uploads";
export const UPLOAD_SUBDIRS = ["payment-screenshots", "application-documents"] as const;

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// The browser-supplied MIME type is only a claim — confirm the file's
// actual leading bytes match it before storing anything.
function matchesSignature(type: string, b: Buffer): boolean {
  switch (type) {
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
    case "image/jpg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/webp":
      return b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return b.length > 5 && b.subarray(0, 5).toString("ascii") === "%PDF-";
    default:
      return false;
  }
}

async function saveUploadedFile(
  file: File,
  subdir: string,
  allowedTypes: string[]
): Promise<{ url: string } | { error: string }> {
  if (!allowedTypes.includes(file.type)) {
    return { error: `File type not allowed. Accepted: ${allowedTypes.join(", ")}` };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { error: "File must be under 5MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(file.type, buffer)) {
    return { error: "File content does not match its type (corrupt or renamed file)." };
  }

  const dir = path.join(UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });

  const extFromType: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  const ext = extFromType[file.type] || "bin";
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await writeFile(path.join(dir, fileName), buffer);

  return { url: `${PUBLIC_ROOT}/${subdir}/${fileName}` };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];

// Agent payment proof — images only (it's a screenshot).
export async function savePaymentScreenshot(file: File) {
  return saveUploadedFile(file, "payment-screenshots", IMAGE_TYPES);
}

// Application documents (Aadhaar copy, photo, signature, custom
// docs) — images or PDFs, since ID documents are commonly scanned
// as PDF.
export async function saveApplicationDocument(file: File) {
  return saveUploadedFile(file, "application-documents", DOCUMENT_TYPES);
}

// Best-effort cleanup of files saved earlier in a request that then
// failed (so a rejected submission leaves no orphan files behind).
export async function removeUploadedFiles(urls: string[]) {
  for (const url of urls) {
    if (!url.startsWith(`${PUBLIC_ROOT}/`)) continue;
    const abs = path.join(process.cwd(), "public", url);
    if (!abs.startsWith(UPLOAD_ROOT)) continue;
    await unlink(abs).catch(() => {});
  }
}
