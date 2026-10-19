import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Intense Care — Android shell (Capacitor 8).
 *
 * The ERP is a hosted Next.js app (API routes, cookie-session middleware,
 * Prisma) — it cannot be exported as a static site. So the app loads the HOSTED
 * ERP in the Capacitor WebView (`server.url`) and the native layer adds what a
 * website can't do reliably: background contact sync, camera / QR / GPS,
 * push notifications and secure storage. The session cookie is first-party to
 * the hosted origin, so login works exactly as in the browser.
 *
 * Build-time configuration (never secrets):
 *   CAP_SERVER_URL   https URL of the deployed ERP (required for release builds)
 *   CAP_APP_ID       Android applicationId (default com.intensecare.erp)
 *   CAP_ALLOW_CLEARTEXT=1  debug builds against a LAN dev server only
 *
 * `webDir` contains only the offline / "can't reach the server" page.
 */
const url = process.env.CAP_SERVER_URL?.replace(/\/$/, "");
const cleartext = process.env.CAP_ALLOW_CLEARTEXT === "1";

if (url && !/^https:\/\//.test(url) && !(cleartext && /^http:\/\//.test(url))) {
  throw new Error("CAP_SERVER_URL must be an https:// address (http:// only with CAP_ALLOW_CLEARTEXT=1 for local testing).");
}

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID || "com.intensecare.erp",
  appName: "Intense Care",
  webDir: "mobile/www",
  backgroundColor: "#fbfaf8",
  server: {
    ...(url ? { url } : {}),
    cleartext,
    // Only the ERP's own host may load in the app; every other link opens in the system browser.
    allowNavigation: url ? [new URL(url).host] : [],
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: process.env.CAP_DEBUG_WEBVIEW === "1",
    backgroundColor: "#fbfaf8",
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, launchAutoHide: false, backgroundColor: "#fbfaf8", androidScaleType: "CENTER_INSIDE", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#ffffff", overlaysWebView: false },
    Keyboard: { resize: "body", resizeOnFullScreen: true },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
