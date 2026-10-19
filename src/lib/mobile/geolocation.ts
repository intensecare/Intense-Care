import { isNativeApp } from "./platform";

export type GeoFix = { lat: number; lng: number; accuracy: number };
export type GeoResult = { fix: GeoFix } | { problem: string; denied?: boolean };

/**
 * One high-accuracy position fix. In the Android app it uses the native location plugin (which asks
 * for the Android location permission itself); in a browser it uses navigator.geolocation. Used by
 * the job start checks, so the DIRECT / GPS / GPS_QR modes behave the same in both.
 */
export async function currentFix(): Promise<GeoResult> {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted") {
        const asked = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (asked.location !== "granted") return { problem: "Location permission is off. Open Android Settings → Apps → Intense Care → Permissions → Location, allow it, then try again.", denied: true };
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      return { fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } };
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
      if (msg.includes("denied")) return { problem: "Location permission is off. Allow location for Intense Care in Android Settings, then try again.", denied: true };
      if (msg.includes("timeout") || msg.includes("timed out")) return { problem: "Getting your location took too long. Step outside or near a window and try again." };
      return { problem: "Your phone couldn't find its location. Turn on GPS / Location and try again." };
    }
  }
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && !window.isSecureContext) return resolve({ problem: "Location only works on the secure (https) address of the app. Ask the office for the correct link." });
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ problem: "This browser can't share your location. Open the app in Chrome or Safari with location turned on." });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }),
      (err) =>
        resolve({
          problem:
            err.code === 1
              ? "Location permission is off. Allow location for this site in your browser settings (tap the lock icon by the address), then try again."
              : err.code === 3
              ? "Getting your location took too long. Step outside or near a window and try again."
              : "Your phone couldn't find its location. Turn on GPS / Location and try again.",
          denied: err.code === 1,
        }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}
