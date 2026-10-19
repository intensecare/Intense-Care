import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./platform";

/** Native helper (android/…/DeviceStoragePlugin.java): size and clear the app's regenerable cache. */
interface DeviceStoragePlugin {
  getInfo(): Promise<{ cacheBytes: number; filesBytes: number; freeBytes: number }>;
  /** Deletes cache files only (image cache, temporary downloads, web cache). Never touches app data, the database, saved login or the upload queue. */
  clearCache(): Promise<{ freedBytes: number }>;
}
const Native = registerPlugin<DeviceStoragePlugin>("DeviceStorage");

export interface StorageInfo {
  native: boolean;
  cacheBytes: number | null;
  filesBytes: number | null;
  freeBytes: number | null;
  /** What the web layer reports (cache storage + IndexedDB). */
  webUsage: number | null;
  webQuota: number | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const out: StorageInfo = { native: isNativeApp(), cacheBytes: null, filesBytes: null, freeBytes: null, webUsage: null, webQuota: null };
  try {
    const e = await navigator.storage?.estimate?.();
    out.webUsage = e?.usage ?? null;
    out.webQuota = e?.quota ?? null;
  } catch {}
  if (out.native) {
    try {
      const i = await Native.getInfo();
      out.cacheBytes = i.cacheBytes;
      out.filesBytes = i.filesBytes;
      out.freeBytes = i.freeBytes;
    } catch {}
  }
  return out;
}

/** Clears regenerable data only. The photo upload queue (IndexedDB), cookies and settings are not touched. */
export async function clearCache(): Promise<{ freedBytes: number }> {
  let freed = 0;
  try {
    if (typeof caches !== "undefined") for (const k of await caches.keys()) await caches.delete(k);
  } catch {}
  if (isNativeApp()) {
    try {
      freed = (await Native.clearCache()).freedBytes;
    } catch {}
  }
  return { freedBytes: freed };
}
