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
