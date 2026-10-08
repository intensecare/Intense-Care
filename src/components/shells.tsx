"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  UserCog,
  Tags,
  Wallet,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  Sun,
  PackageCheck,
  Truck,
  User,
  ShieldCheck,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/format";
import { apiCall } from "@/lib/client/api";

type NavItem = { href: string; label: string; icon: React.ElementType; exact?: boolean };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

export function useSignOut() {
  const router = useRouter();
  return async () => {
    await apiCall("/api/auth/logout");
    router.replace("/login");
    router.refresh();
  };
}

/* -------------------------------------------------------------------------- */
/* Admin: simple sidebar (desktop) / drawer (mobile)                          */
/* -------------------------------------------------------------------------- */

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/users", label: "Users", icon: UserCog },
  { href: "/admin/services", label: "Services", icon: Tags },
  { href: "/admin/payments", label: "Payments", icon: Wallet },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({ businessName, userName, children }: { businessName: string; userName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {ADMIN_NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium",
              active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <Icon className={cn("h-5 w-5", active ? "text-brand-700" : "text-slate-400")} />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-slate-100 pt-3">
        <div className="px-3 pb-2 text-sm text-slate-500 truncate">{userName}</div>
        <button onClick={signOut} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-slate-600 hover:bg-slate-50">
          <LogOut className="h-5 w-5 text-slate-400" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-white md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 md:flex">
        <div className="flex h-16 items-center px-5 text-lg font-bold text-brand-800 truncate">{businessName}</div>
        {nav}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <span className="text-base font-bold text-brand-800 truncate">{businessName}</span>
        <button onClick={() => setOpen(true)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl text-slate-700" aria-label="Open menu">
          <Menu className="h-6 w-6" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white">
            <div className="flex h-14 items-center justify-between px-5">
              <span className="text-base font-bold text-brand-800 truncate">{businessName}</span>
              <button onClick={() => setOpen(false)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl" aria-label="Close menu">
                <X className="h-6 w-6" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field manager & QC: mobile app with a bottom tab bar                       */
/* -------------------------------------------------------------------------- */

const FIELD_TABS: NavItem[] = [
  { href: "/field", label: "Today", icon: Sun, exact: true },
  { href: "/field/pickups", label: "Pickups", icon: PackageCheck },
  { href: "/field/deliveries", label: "Deliveries", icon: Truck },
  { href: "/field/profile", label: "Profile", icon: User },
];

const QC_TABS: NavItem[] = [
  { href: "/qc", label: "QC Queue", icon: ShieldCheck, exact: true },
  { href: "/qc/passed", label: "Passed", icon: CheckCircle2 },
  { href: "/qc/failed", label: "Failed", icon: XCircle },
  { href: "/qc/profile", label: "Profile", icon: User },
];

export function MobileShell({ app, title, children }: { app: "field" | "qc"; title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const tabs = app === "field" ? FIELD_TABS : QC_TABS;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <span className="text-lg font-bold text-brand-800 truncate">{title}</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-28 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(pathname, t);
            return (
              <Link key={t.href} href={t.href} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active ? "text-brand-700" : "text-slate-500")}>
                <Icon className="h-6 w-6" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
