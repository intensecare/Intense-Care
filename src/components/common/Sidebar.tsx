"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Building2,
  Sparkles,
  DollarSign,
  BarChart3,
  Settings,
  CalendarClock,
  ClipboardCheck,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import type { NavItem } from "@/lib/rbac";

const ICONS: Record<string, React.ElementType> = {
  "/": LayoutDashboard,
  "/jobs": Briefcase,
  "/schedule": CalendarClock,
  "/quality-queue": ClipboardCheck,
  "/customers": Users,
  "/properties": Building2,
  "/services": Sparkles,
  "/finance": DollarSign,
  "/reports": BarChart3,
  "/users": UserCog,
  "/settings": Settings,
};

/**
 * Sidebar — rendered from the role's workspace definition. Items appear
 * only when the matrix grants their permission; badges count exactly what
 * the target page shows for this role's scope.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { currentUser, workspace, roleLabel, can } = useAuth();
  const { jobs, invoices, reworkTasks, complaints } = useApp();

  const badgeJobs = jobs;
  const today = new Date().toISOString().slice(0, 10);

  const badgeValue = (key: NavItem["badge"]): number | undefined => {
    switch (key) {
      case "jobs_open":
        return badgeJobs.filter((j) => j.scheduledDate === today && !["COMPLETED", "CLOSED", "CANCELLED", "FEEDBACK_REQUESTED"].includes(j.status)).length;
      case "qc_pending":
        return badgeJobs.filter((j) => ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(j.status)).length;
      case "rework":
        return reworkTasks.filter((t) => t.status !== "completed").length + complaints.filter((c) => c.status !== "closed" && c.status !== "resolved").length;
      case "approvals":
        return badgeJobs.filter((j) => j.status === "CUSTOMER_APPROVAL").length;
      case "overdue":
        return can("finance.view") ? invoices.filter((i) => i.balanceDue > 0 && i.dueDate < today).length : undefined;
      default:
        return undefined;
    }
  };

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 text-slate-900 flex flex-col h-screen sticky top-0 overflow-y-auto z-20">
      <div className="h-1 w-full bg-rose-500 shrink-0" />
      <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
        <Link href={workspace.home} className="flex items-center gap-3 group">
          <div className="h-9 w-9 rounded-lg bg-white p-1.5 flex items-center justify-center border border-slate-200 overflow-hidden shrink-0 shadow-xs group-hover:border-rose-300 transition-colors">
            <img src="/logo.png" alt="Intense Care Logo" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-xs font-semibold tracking-tight text-slate-900 leading-none uppercase group-hover:text-rose-600 transition-colors">
              Intense Care
            </div>
            <div className="text-[10px] text-slate-500 tracking-wider mt-1 flex items-center gap-1 font-sans font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="text-rose-600 font-semibold uppercase">{workspace.title}</span>
            </div>
          </div>
        </Link>
      </div>

      <div className="flex-1 py-4 px-3 space-y-1">
        {workspace.nav.map((item) => {
          const Icon = ICONS[item.href] ?? Briefcase;
          const isActive = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
          const badge = badgeValue(item.badge);
          const alert = item.badge === "rework" || item.badge === "overdue";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border",
                isActive
                  ? "bg-white text-slate-900 font-semibold border-slate-200 shadow-xs"
                  : "text-slate-500 border-transparent hover:text-slate-900 hover:bg-white/70"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={cn("h-4 w-4", isActive ? "text-rose-500" : "text-slate-400")} />
                <span>{item.label}</span>
              </div>
              {badge !== undefined && badge > 0 && (
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-sans font-medium border",
                    isActive
                      ? "bg-rose-500 text-white border-rose-500 font-semibold"
                      : alert
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  )}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="p-3.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 font-sans">
        <div className="font-semibold text-slate-700 truncate">{currentUser?.name}</div>
        <div className="text-[10px] text-slate-400">{roleLabel}</div>
      </div>
    </aside>
  );
}
