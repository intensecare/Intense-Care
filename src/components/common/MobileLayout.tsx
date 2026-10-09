"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, WifiOff, Home, Briefcase, ListChecks, User, ClipboardCheck, History, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { OfflineBanner } from "@/components/ui/states";

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

type Tab = { key: string; label: string; href: string; Icon: React.ElementType };

/** Bottom tabs per role — Field Manager and QC each get their own app. */
const TABS: Record<string, Tab[]> = {
  field_manager: [
    { key: "home", label: "Home", href: "/my-jobs", Icon: Home },
    { key: "jobs", label: "Jobs", href: "/my-jobs?tab=jobs", Icon: Briefcase },
    { key: "tasks", label: "Tasks", href: "/my-jobs?tab=tasks", Icon: ListChecks },
    { key: "ai", label: "Intense AI", href: "/assistant", Icon: Sparkles },
    { key: "profile", label: "Profile", href: "/my-jobs?tab=profile", Icon: User },
  ],
  qc_inspector: [
    { key: "home", label: "Home", href: "/quality-queue", Icon: Home },
    { key: "quality", label: "Quality", href: "/quality-queue?tab=quality", Icon: ClipboardCheck },
    { key: "history", label: "History", href: "/quality-queue?tab=history", Icon: History },
    { key: "ai", label: "Intense AI", href: "/assistant", Icon: Sparkles },
    { key: "profile", label: "Profile", href: "/quality-queue?tab=profile", Icon: User },
  ],
};

/**
 * Mobile app shell for field roles. List screens show the bottom tab bar;
 * detail screens (with a back button) show the ONE sticky primary action
 * instead, so the main action is always under the thumb.
 */
export function MobileLayout({
  title,
  subtitle,
  backHref,
  gps,
  action,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  gps?: "ready" | "searching" | "unavailable" | "verified";
  /** Sticky bottom primary CTA (detail screens). */
  action?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { currentUser, can } = useAuth();
  const online = useNetworkStatus();
  const pathname = usePathname();
  const params = useSearchParams();
  // Intense AI shows only for roles allowed to use it (the API enforces the same).
  const tabs = (TABS[currentUser?.role ?? ""] ?? []).filter((t) => t.key !== "ai" || can("ai.use"));
  const currentTab = params?.get("tab") ?? "home";
  const showTabs = !backHref && tabs.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center">
      <header className="w-full bg-white/95 backdrop-blur border-b border-zinc-200 sticky top-0 z-30">
        <div className="max-w-md mx-auto h-16 px-4 flex items-center gap-2">
          {backHref && (
            <Link href={backHref} className="h-11 w-11 -ml-2 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-zinc-100" aria-label="Back">
              <ChevronLeft className="h-6 w-6" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {subtitle && <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide truncate">{subtitle}</div>}
            <h1 className="text-lg font-semibold text-zinc-950 truncate leading-tight">{title}</h1>
          </div>
          {!online && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-white">
              <WifiOff className="h-3.5 w-3.5" aria-hidden /> Offline
            </span>
          )}
          {gps && (
            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", gps === "verified" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : gps === "searching" ? "bg-amber-50 text-amber-800 border-amber-200" : gps === "unavailable" ? "bg-zinc-100 text-zinc-600 border-zinc-200" : "bg-white text-zinc-600 border-zinc-200")}>
              {gps === "verified" ? "GPS verified ✓" : gps === "searching" ? "Finding GPS…" : gps === "unavailable" ? "No GPS" : "GPS ready"}
            </span>
          )}
          {headerRight}
        </div>
      </header>

      <main className={cn("w-full max-w-md px-4 py-4 space-y-4", action ? "pb-32" : showTabs ? "pb-28" : "pb-8")}>
        <OfflineBanner />
        {children}
      </main>

      {action && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-md mx-auto">{action}</div>
        </div>
      )}

      {showTabs && !action && (
        <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
          <div className={cn("max-w-md mx-auto grid", tabs.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
            {tabs.map(({ key, label, href, Icon }) => {
              const active = key === "ai" ? pathname === "/assistant" : pathname === href.split("?")[0] && currentTab === key;
              return (
                <Link key={key} href={href} aria-current={active ? "page" : undefined} className={cn("h-16 px-0.5 flex flex-col items-center justify-center gap-1 text-xs font-semibold leading-tight text-center transition-colors", active ? "text-rose-600" : "text-zinc-500")}>
                  <Icon className="h-6 w-6" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Shared Profile tab for field roles: who am I, text size, sign out. */
export function ProfilePanel() {
  const { currentUser, roleLabel, logout } = useAuth();
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 flex items-center gap-4">
        <span className="h-14 w-14 rounded-full bg-rose-500 text-white flex items-center justify-center text-xl font-semibold">{currentUser?.name?.charAt(0)}</span>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-zinc-950 truncate">{currentUser?.name}</div>
          <div className="text-sm text-zinc-500">{roleLabel}</div>
        </div>
      </section>
      <section className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Email</div>
          <div className="text-base text-zinc-900 break-all">{currentUser?.email}</div>
        </div>
        {currentUser?.phone && (
          <div className="px-5 py-4">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Phone</div>
            <div className="text-base text-zinc-900">{currentUser.phone}</div>
          </div>
        )}
      </section>
      <button onClick={logout} className="w-full h-12 rounded-xl border border-zinc-300 bg-white text-base font-semibold text-zinc-800">
        Sign out
      </button>
    </div>
  );
}
