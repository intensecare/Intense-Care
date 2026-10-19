/**
 * Photo upload queue.
 *
 * A photo is sent straight away. If the network is down (or the server says "try again later") it is kept
 * in IndexedDB on this phone — original quality, nothing is deleted — and sent again when the app is back
 * online or opened. Rules:
 *  - "Uploaded" is only ever reported after the server confirmed it (HTTP 2xx with a saved photo).
 *  - Every photo carries a clientUploadId, so a retry after a timeout can't create a second copy.
 *  - A rejected photo (wrong job, not allowed, bad image) is NOT retried forever: it is marked FAILED with
 *    the reason and stays visible in Device Storage until the user retries or removes it.
 *  - Sign-out never deletes the queue.
 */
export type QueueStatus = "PENDING" | "UPLOADING" | "FAILED";

export interface QueuedPhoto {
  id: string; // = clientUploadId
  jobId: string;
  area: string;
  photoType: "before" | "after" | "qc" | "rework";
  caption?: string;
  image: Blob;
  bytes: number;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  userId?: string;
}

const DB = "ic-uploads";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no_idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export const newUploadId = () => "up" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export const listQueue = async (): Promise<QueuedPhoto[]> => ((await tx("readonly", (s) => s.getAll())) as QueuedPhoto[]).sort((a, b) => a.createdAt - b.createdAt);
export const putQueued = (p: QueuedPhoto) => tx("readwrite", (s) => s.put(p));
export const removeQueued = (id: string) => tx("readwrite", (s) => s.delete(id));

export async function queueCounts() {
  try {
    const all = await listQueue();
    return { pending: all.filter((p) => p.status !== "FAILED").length, failed: all.filter((p) => p.status === "FAILED").length, bytes: all.reduce((a, p) => a + p.bytes, 0) };
  } catch {
    return { pending: 0, failed: 0, bytes: 0 };
  }
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ic:uploads"));
}

export type SendResult = { ok: true; photo: unknown; replayed: boolean } | { ok: false; retry: boolean; error: string; status: number };

/** One POST with progress and cancel. 0 = no network. */
export function sendPhoto(p: Pick<QueuedPhoto, "id" | "jobId" | "area" | "photoType" | "caption">, dataUrl: string, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<SendResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/photos");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json: { success?: boolean; data?: unknown; replayed?: boolean; error?: string } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && json?.success && json.data) return resolve({ ok: true, photo: json.data, replayed: !!json.replayed });
      // 4xx (except timeouts / rate limits) will never succeed by trying again.
      const retry = xhr.status === 408 || xhr.status === 429 || xhr.status >= 500;
      resolve({ ok: false, retry, status: xhr.status, error: json?.error || (xhr.status === 401 ? "Sign in again to upload." : "The photo wasn't saved.") });
    };
    xhr.onerror = () => resolve({ ok: false, retry: true, status: 0, error: "No connection." });
    xhr.ontimeout = () => resolve({ ok: false, retry: true, status: 0, error: "The connection timed out." });
    xhr.onabort = () => resolve({ ok: false, retry: false, status: -1, error: "Cancelled." });
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(JSON.stringify({ jobId: p.jobId, area: p.area, photoType: p.photoType, image: dataUrl, caption: p.caption, clientUploadId: p.id }));
  });
}

/** Saves a photo for later (network was down). Returns the queue entry. */
export async function enqueuePhoto(input: Omit<QueuedPhoto, "status" | "attempts" | "createdAt" | "bytes" | "id"> & { id?: string }): Promise<QueuedPhoto> {
  const entry: QueuedPhoto = { ...input, id: input.id ?? newUploadId(), bytes: input.image.size, status: "PENDING", attempts: 0, createdAt: Date.now() };
  await putQueued(entry);
  notify();
  return entry;
}

let draining: Promise<{ sent: number; failed: number; left: number }> | null = null;

/** Sends everything waiting, oldest first, one at a time. Safe to call from several places at once. */
export function drainQueue(onUploaded?: (photo: unknown) => void): Promise<{ sent: number; failed: number; left: number }> {
  if (draining) return draining;
  draining = (async () => {
    let sent = 0,
      failed = 0;
    try {
      for (const p of (await listQueue()).filter((x) => x.status !== "FAILED")) {
        await putQueued({ ...p, status: "UPLOADING", attempts: p.attempts + 1 });
        notify();
        const r = await sendPhoto(p, await blobToDataUrl(p.image));
        if (r.ok) {
          await removeQueued(p.id);
          sent++;
          onUploaded?.(r.photo);
        } else if (r.retry) {
          await putQueued({ ...p, status: "PENDING", attempts: p.attempts + 1, lastError: r.error });
          if (r.status === 0) break; // still offline: stop, try later
        } else {
          await putQueued({ ...p, status: "FAILED", attempts: p.attempts + 1, lastError: r.error });
          failed++;
        }
        notify();
      }
    } catch {
      /* IndexedDB unavailable — nothing to drain */
    }
    const left = (await queueCounts()).pending;
    notify();
    return { sent, failed, left };
  })().finally(() => {
    draining = null;
  });
  return draining;
}

export async function retryFailedUploads() {
  for (const p of (await listQueue()).filter((x) => x.status === "FAILED")) await putQueued({ ...p, status: "PENDING", lastError: undefined });
  notify();
  return drainQueue();
}
