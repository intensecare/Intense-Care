"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/mobile/platform";
import { ContactSync } from "@/lib/mobile/contact-sync";
import { drainQueue } from "@/lib/mobile/upload-queue";
import { pushPermission, registerForPush } from "@/lib/mobile/push";
import { registerThisDevice } from "@/lib/mobile/device";

/**
 * Wires the web app to the Android shell: splash / status bar / keyboard, back button, app resume,
 * connectivity, push registration and "tap a notification → open the right screen".
 * Renders nothing in a normal browser (apart from draining the photo queue when the network returns).
 */
export function NativeBridge() {
  const { currentUser, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const userId = currentUser?.id ?? null;

  const drain = useCallback(() => {
    if (isAuthenticated) void drainQueue((photo) => window.dispatchEvent(new CustomEvent("ic:photo-uploaded", { detail: photo }))).catch(() => {});
  }, [isAuthenticated]);

  // Photos waiting for the network are sent when it returns, and every minute while the app is open.
  useEffect(() => {
    window.addEventListener("online", drain);
    const t = window.setInterval(drain, 60_000);
    drain();
    return () => {
      window.removeEventListener("online", drain);
      window.clearInterval(t);
    };
  }, [drain]);

  // Native-only setup, once.
  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.classList.add("native-app");
    let remove: Array<() => void> = [];
    (async () => {
      try {
        const [{ StatusBar, Style }, { SplashScreen }, { App }, { Network }] = await Promise.all([
          import("@capacitor/status-bar"),
          import("@capacitor/splash-screen"),
          import("@capacitor/app"),
          import("@capacitor/network"),
        ]);
        await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
        await StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => {});
        await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
        await SplashScreen.hide().catch(() => {});

        const back = await App.addListener("backButton", ({ canGoBack }) => {
          const p = pathRef.current;
          const atRoot = p === "/" || p === "/login" || p === "/my-jobs" || p === "/quality-queue" || p === "/leads" || p === "/jobs";
          if (canGoBack && !atRoot) window.history.back();
          else void App.minimizeApp(); // never kill the app (and its sync) from the back button
        });
        const resume = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          drain();
          // Catch-up: the contact sync runs on resume too (the native side throttles it).
          ContactSync.getStatus()
            .then((s) => (s.enabled && !s.paused && s.permission === "granted" ? ContactSync.syncNow({ trigger: "RESUME" }) : undefined))
            .catch(() => {});
        });
        const net = await Network.addListener("networkStatusChange", (s) => {
          if (s.connected) drain();
        });
        remove = [() => void back.remove(), () => void resume.remove(), () => void net.remove()];
      } catch {
        /* a missing plugin must never break the app */
      }
    })();
    return () => remove.forEach((r) => r());
  }, [drain]);

  // Signed in: tell the native side who, register the phone, and (if the user already allowed it) push.
  useEffect(() => {
    if (!isNativeApp() || !isAuthenticated || !userId) return;
    void (async () => {
      try {
        await ContactSync.signedIn({ userId });
        await registerThisDevice();
        if ((await pushPermission()) === "granted") {
          await registerForPush(
            (route) => router.push(route),
            (title, body) => setBanner({ title, body })
          );
        }
      } catch {
        /* offline — retried on the next launch */
      }
    })();
  }, [isAuthenticated, userId, router]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 8000);
    return () => window.clearTimeout(t);
  }, [banner]);

  if (!banner) return null;
  return (
    <div role="status" className="fixed top-2 inset-x-2 z-[60] rounded-2xl border border-zinc-200 bg-white shadow-lg px-4 py-3 flex items-start gap-3">
      <Bell className="h-5 w-5 mt-0.5 text-rose-600 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-zinc-900">{banner.title}</div>
        {banner.body && <div className="text-sm text-zinc-600">{banner.body}</div>}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => setBanner(null)}>
        <X className="h-4 w-4 text-zinc-400" aria-hidden />
      </button>
    </div>
  );
}
