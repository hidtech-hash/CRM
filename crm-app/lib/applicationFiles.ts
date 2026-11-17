import { saveApplicationDocument, removeUploadedFiles } from "./uploads";

// Shared by the staff apply route and the agent apply route so both
// parse and store application documents identically, and — importantly
// — so that ALL files are validated and stored BEFORE any database row
// is written. A bad required file then fails the whole request cleanly
// instead of leaving a half-built application behind.

export type UploadItem = {
  documentName: string;
  requirementId: string | null;
  file: File;
  required: boolean; // required = a configured required requirement; failure aborts
};

export type SavedUpload = { documentName: string; requirementId: string | null; fileUrl: string };

export function collectUploads(
  form: FormData,
  requirements: { id: string; name: string; required: boolean }[]
): UploadItem[] {
  const items: UploadItem[] = [];

  for (const req of requirements) {
    const file = form.get(`requirement_${req.id}`);
    if (file instanceof File) {
      items.push({ documentName: req.name, requirementId: req.id, file, required: req.required });
    }
  }

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("common_") || !(value instanceof File)) continue;
    items.push({ documentName: key.replace("common_", ""), requirementId: null, file: value, required: false });
  }

  const customNames = form.getAll("customDocName");
  const customFiles = form.getAll("customDocFile");
  for (let i = 0; i < customNames.length; i++) {
    const name = customNames[i];
    const file = customFiles[i];
    if (typeof name !== "string" || !name.trim() || !(file instanceof File)) continue;
    items.push({ documentName: name.trim(), requirementId: null, file, required: false });
  }
  return items;
}

export async function saveUploads(
  items: UploadItem[]
): Promise<{ ok: true; saved: SavedUpload[] } | { ok: false; error: string }> {
  const saved: SavedUpload[] = [];
  for (const item of items) {
    const result = await saveApplicationDocument(item.file);
    if ("error" in result) {
      if (item.required) {
        await removeUploadedFiles(saved.map((s) => s.fileUrl));
        return { ok: false, error: `${item.documentName}: ${result.error}` };
      }
      continue; // optional/custom documents that fail validation are skipped, as before
    }
    saved.push({ documentName: item.documentName, requirementId: item.requirementId, fileUrl: result.url });
  }
  return { ok: true, saved };
}
