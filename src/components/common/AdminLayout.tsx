"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Building2,
  Sparkles,
  Wallet,
  BarChart3,
  Settings,
  CalendarClock,
  ClipboardCheck,
  UserCog,
  MoreHorizontal,
  LogOut,
  Search,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import type { NavItem } from "@/lib/rbac";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OfflineBanner } from "@/components/ui/states";

const ICONS: Record<string, React.ElementType> = {
  "/": LayoutDashboard,
  "/jobs": Briefcase,
  "/schedule": CalendarClock,
  "/quality-queue": ClipboardCheck,
  "/customers": Users,
  "/properties": Building2,
  "/services": Sparkles,
  "/finance": Wallet,
  "/reports": BarChart3,
  "/users": UserCog,
  "/settings": Settings,
};

/**
 * ADMIN shell — "operations control center".
 * Desktop: clean left sidebar (icon + label, clear active state).
 * Phones/tablets: compact top bar + one-handed bottom nav (Home · Jobs · More).
 */
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, workspace, roleLabel, can, logout } = useAuth();
  const { jobs, invoices, fontSize, setFontSize } = useApp();
  const SIZES = ["md", "lg", "xl"] as const;
  const nextSize = () => setFontSize(SIZES[(SIZES.indexOf(fontSize as (typeof SIZES)[number]) + 1) % SIZES.length]);
  const textSize = (
    <button onClick={nextSize} className="h-10 px-3 rounded-xl inline-flex items-center justify-center text-zinc-600 hover:bg-zinc-100 text-sm font-semibold" aria-label={`Text size: ${fontSize === "md" ? "normal" : fontSize === "lg" ? "large" : "extra large"}. Change text size`}>
      A<span className="text-base">A</span>
    </button>
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const badge = (key: NavItem["badge"]): number => {
    switch (key) {
      case "jobs_open":
        return jobs.filter((j) => j.scheduledDate === today && !["COMPLETED", "CLOSED", "CANCELLED", "FEEDBACK_REQUESTED"].includes(j.status)).length;
      case "qc_pending":
        return jobs.filter((j) => ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(j.status)).length;
      case "overdue":
        return can("finance.view") ? invoices.filter((i) => i.balanceDue > 0 && i.dueDate < today).length : 0;
      default:
        return 0;
    }
  };
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const nav = workspace.nav;
  const more = nav.filter((n) => n.href !== "/" && n.href !== "/jobs");

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearchOpen(false);
    router.push(`/jobs?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-white focus:px-3 focus:py-2 focus:rounded-lg">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white h-screen sticky top-0">
        <Link href="/" className="flex items-center gap-3 px-5 h-16 border-b border-zinc-100">
          <span className="h-9 w-9 rounded-xl bg-white border border-zinc-200 p-1.5 flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="" className="h-full w-full object-contain" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-zinc-950">Intense Care</span>
            <span className="block text-xs text-zinc-500">Operations</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {nav.map((item) => {
            const Icon = ICONS[item.href] ?? Briefcase;
            const active = isActive(item.href);
            const count = badge(item.badge);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors",
                  active ? "bg-rose-50 text-rose-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", active ? "text-rose-600" : "text-zinc-400")} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {count > 0 && (
                  <span className={cn("min-w-[1.5rem] h-6 px-1.5 rounded-full text-xs font-semibold inline-flex items-center justify-center", item.badge === "overdue" ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-700")}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-zinc-100 flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-rose-500 text-white flex items-center justify-center text-sm font-semibold shrink-0">{currentUser?.name?.charAt(0) ?? "A"}</span>
          <span className="flex-1 min-w-0 leading-tight">
            <span className="block text-sm font-semibold text-zinc-900 truncate">{currentUser?.name}</span>
            <span className="block text-xs text-zinc-500">{roleLabel}</span>
          </span>
          <button onClick={logout} className="h-10 w-10 rounded-xl inline-flex items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur border-b border-zinc-200 px-4 sm:px-6 flex items-center gap-3">
          <Link href="/" className="lg:hidden flex items-center gap-2 shrink-0" aria-label="Dashboard">
            <span className="h-9 w-9 rounded-xl bg-white border border-zinc-200 p-1.5 flex items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="" className="h-full w-full object-contain" />
            </span>
          </Link>
          <form onSubmit={search} className="hidden sm:block relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search jobs, customers, phone"
              aria-label="Search jobs"
              className="h-10 w-full rounded-xl bg-zinc-100 border border-transparent pl-10 pr-3 text-sm placeholder:text-zinc-400 focus:bg-white focus:border-zinc-300"
            />
          </form>
          <div className="flex-1 sm:hidden" />
          <button onClick={() => setSearchOpen(true)} className="sm:hidden h-10 w-10 rounded-xl inline-flex items-center justify-center text-zinc-600 hover:bg-zinc-100" aria-label="Search">
            <Search className="h-5 w-5" />
          </button>
          <span className="hidden sm:inline-flex">{textSize}</span>
          {can("jobs.create") && (
            <Link href="/jobs?create=true" className="h-10 px-3 sm:px-4 rounded-xl bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-rose-600 shrink-0">
              <Plus className="h-5 w-5" aria-hidden /> <span className="hidden sm:inline">New Job</span><span className="sr-only sm:hidden">New Job</span>
            </Link>
          )}
          <span className="lg:hidden h-9 w-9 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm font-semibold shrink-0" aria-hidden>
            {currentUser?.name?.charAt(0) ?? "A"}
          </span>
        </header>

        <main id="main" className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-28 lg:pb-10">
          <OfflineBanner />
          {children}
        </main>
      </div>

      {/* Phone/tablet bottom nav */}
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3 max-w-md mx-auto">
          {[{ href: "/", label: "Home", Icon: LayoutDashboard }, { href: "/jobs", label: "Jobs", Icon: Briefcase }].map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("h-16 flex flex-col items-center justify-center gap-1 text-xs font-semibold", active ? "text-rose-600" : "text-zinc-500")}>
                <Icon className="h-6 w-6" aria-hidden />
                {label}
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className={cn("h-16 flex flex-col items-center justify-center gap-1 text-xs font-semibold", more.some((m) => isActive(m.href)) ? "text-rose-600" : "text-zinc-500")}>
            <MoreHorizontal className="h-6 w-6" aria-hidden />
            More
          </button>
        </div>
      </nav>

      {/* More — everything else, one tap away */}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>More</DialogTitle>
          <div className="grid grid-cols-3 gap-2">
            {more.map((item) => {
              const Icon = ICONS[item.href] ?? Briefcase;
              const count = badge(item.badge);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn("relative rounded-2xl border p-3 h-24 flex flex-col items-center justify-center gap-2 text-center text-sm font-medium", isActive(item.href) ? "border-rose-300 bg-rose-50 text-rose-700" : "border-zinc-200 text-zinc-700")}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                  {item.label}
                  {count > 0 && <span className="absolute top-2 right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-semibold inline-flex items-center justify-center">{count}</span>}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-3">
            <span className="h-10 w-10 rounded-full bg-rose-500 text-white flex items-center justify-center font-semibold">{currentUser?.name?.charAt(0)}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-zinc-900 truncate">{currentUser?.name}</span>
              <span className="block text-xs text-zinc-500">{roleLabel}</span>
            </span>
            {textSize}
            <button onClick={logout} className="h-10 px-3 rounded-xl border border-zinc-200 bg-white text-sm font-semibold inline-flex items-center gap-1.5">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phone search */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Search</DialogTitle>
          <form onSubmit={search} className="flex gap-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job ID, customer or phone" aria-label="Search jobs" className="h-12 flex-1 min-w-0 rounded-xl border border-zinc-300 px-3.5" />
            <button type="submit" className="h-12 w-12 rounded-xl bg-rose-500 text-white inline-flex items-center justify-center shrink-0" aria-label="Search">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <button type="button" onClick={() => setSearchOpen(false)} className="sr-only">
            <X /> Close
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
