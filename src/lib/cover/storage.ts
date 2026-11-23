import { coverProjectSchema, type CoverProject } from "./model";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("printdh-cover-studio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Cover Studio tabs to enable saving."));
  });
}

export async function readCover(): Promise<CoverProject | null> {
  const db = await openStore();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").get("draft");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value ? coverProjectSchema.parse(value) : null;
  } finally { db.close(); }
}

export async function writeCover(project: CoverProject) {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(project, "draft");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving was interrupted."));
    });
  } finally { db.close(); }
}

export type CoverLibraryEntry = { id: string; updatedAt: number; template: boolean; thumbnail: string; project: CoverProject };
export async function listCoverLibrary(): Promise<CoverLibraryEntry[]> {
  const db = await openStore();
  try {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return values.flatMap((value) => {
      if (!value || typeof value !== "object" || !("project" in value)) return [];
      const entry = value as CoverLibraryEntry, parsed = coverProjectSchema.safeParse(entry.project);
      return parsed.success && typeof entry.id === "string" && typeof entry.updatedAt === "number" && typeof entry.thumbnail === "string"
        ? [{ ...entry, template: !!entry.template, project: parsed.data }] : [];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally { db.close(); }
}
export async function saveCoverLibraryEntry(entry: CoverLibraryEntry) {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put({ ...entry, project: coverProjectSchema.parse(entry.project) }, `library:${entry.id}`);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function deleteCoverLibraryEntry(id: string) {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").delete(`library:${id}`);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
