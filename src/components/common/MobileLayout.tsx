"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, LogOut, Wifi, WifiOff, MapPin } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * Mobile-first shell for the field roles (§21): large touch targets, a
 * sticky header with GPS + network status, and a sticky bottom slot for the
 * ONE primary action. No sidebar, no dense tables, no admin chrome.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function MobileLayout({
  title,
  subtitle,
  backHref,
  gps,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  gps?: "ready" | "searching" | "unavailable" | "verified";
  /** Sticky bottom primary CTA. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { currentUser, roleLabel, logout, workspace } = useAuth();
  const online = useNetworkStatus();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center pb-32">
      <header className="w-full max-w-md bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {backHref ? (
              <Link href={backHref} className="h-11 w-11 -ml-2 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 active:bg-slate-200">
                <ChevronLeft className="h-6 w-6" />
              </Link>
            ) : null}
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide truncate">
                {subtitle ?? workspace.title}
              </div>
              <div className="text-base font-semibold text-slate-900 truncate">{title}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border",
                online ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
              )}
              title={online ? "Online" : "Offline — actions will retry"}
            >
              {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {online ? "Online" : "Offline"}
            </span>
            {gps && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border",
                  gps === "verified" || gps === "ready"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : gps === "searching"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-100 text-slate-500 border-slate-200"
                )}
              >
                <MapPin className="h-3 w-3" />
                {gps === "verified" ? "GPS ✓" : gps === "ready" ? "GPS" : gps === "searching" ? "GPS…" : "No GPS"}
              </span>
            )}
            <button
              onClick={logout}
              title={`Sign out ${currentUser?.name ?? ""} (${roleLabel})`}
              className="h-11 w-11 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md p-4 space-y-4">{children}</main>

      {action && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-md mx-auto">{action}</div>
        </div>
      )}
    </div>
  );
}
