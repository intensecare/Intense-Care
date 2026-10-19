/**
 * Is this page running inside the Android app (Capacitor WebView) or in a normal browser?
 * Every native feature checks this first and falls back to the web behaviour, so the same
 * ERP pages work in both places.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

export function isNativeApp(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export const isAndroidApp = () => isNativeApp() && capacitor()?.getPlatform?.() === "android";

/** App version string shown in Device Storage and sent with device registration. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0";
