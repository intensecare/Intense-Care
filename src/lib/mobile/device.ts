import { callApi } from "@/components/biz/Bits";
import { APP_VERSION, isNativeApp } from "./platform";
import { ContactSync } from "./contact-sync";

/** A stable id for this install: the native one (survives sign-out) or a random one in a browser. */
export async function deviceId(): Promise<string> {
  if (isNativeApp()) {
    try {
      return (await ContactSync.getStatus()).deviceId;
    } catch {
      /* fall through */
    }
  }
  try {
    let id = localStorage.getItem("ic_device_id");
    if (!id) {
      id = "web" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("ic_device_id", id);
    }
    return id;
  } catch {
    return "web" + Math.random().toString(36).slice(2).padEnd(20, "0");
  }
}

/** Registers (or refreshes) this phone for the signed-in user. With `syncToken` also returns a new contact-sync token. */
export async function registerThisDevice(opts: { syncToken?: boolean; label?: string } = {}) {
  const id = await deviceId();
  return callApi<{ id: string; deviceId: string; syncPaused: boolean; notificationsEnabled: boolean; hasPushToken: boolean; syncToken?: string }>("/api/mobile/devices", {
    method: "POST",
    json: { deviceId: id, appVersion: APP_VERSION, label: opts.label ?? (isNativeApp() ? "Android app" : "Web browser"), syncToken: opts.syncToken || undefined },
  });
}

export async function patchThisDevice(patch: { syncPaused?: boolean; notificationsEnabled?: boolean; pushToken?: string | null }) {
  return callApi("/api/mobile/devices", { method: "PATCH", json: { deviceId: await deviceId(), ...patch } });
}
