import { isNativeApp } from "./platform";
import { patchThisDevice, registerThisDevice } from "./device";

export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

export async function pushPermission(): Promise<PushPermission> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const p = (await PushNotifications.checkPermissions()).receive;
    return p === "granted" ? "granted" : p === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Asks Android for notification permission. Only called when the user taps "Turn on notifications". */
export async function requestPushPermission(): Promise<PushPermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const r = (await PushNotifications.requestPermissions()).receive;
  return r === "granted" ? "granted" : r === "denied" ? "denied" : "prompt";
}

let wired = false;

/** Registers with Firebase and sends the token to the ERP. Re-run on every sign-in; Firebase token refreshes arrive on the same listener. */
export async function registerForPush(onRoute: (route: string) => void, onForeground: (title: string, body: string) => void): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  if ((await pushPermission()) !== "granted") return false;
  await registerThisDevice();
  if (!wired) {
    wired = true;
    await PushNotifications.addListener("registration", (t) => {
      void patchThisDevice({ pushToken: t.value });
    });
    await PushNotifications.addListener("registrationError", () => {
      /* Firebase isn't configured in this build (no google-services.json) — the app works without push. */
    });
    await PushNotifications.addListener("pushNotificationReceived", (n) => onForeground(n.title ?? "Intense Care", n.body ?? ""));
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const route = (a.notification.data as { route?: string } | undefined)?.route;
      // The route is re-checked against an allowlist here and by the server; the page itself is still permission-guarded.
      import("@/lib/push-messages").then((m) => onRoute(m.safeRoute(route)));
    });
  }
  await PushNotifications.register();
  return true;
}

export async function unregisterPush() {
  await patchThisDevice({ pushToken: null }).catch(() => {});
}
