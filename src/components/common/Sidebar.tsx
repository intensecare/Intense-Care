"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  Radio,
  Calendar,
  Users,
  Building2,
  Sparkles,
  ShieldCheck,
  Share2,
  DollarSign,
  BarChart3,
  Bell,
  Settings,
  Smartphone,
  CheckCircle2,
  Receipt,
  QrCode as QrCodeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { useAuth, ROLE_ROUTE_PERMISSIONS } from "@/lib/auth-context";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";

export function Sidebar() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const userRole = currentUser?.role || "super_admin";
  const allowedPaths = ROLE_ROUTE_PERMISSIONS[userRole] || [];
  const { jobs, quotes, qualityIssues, complaints, commissionEntries, systemSettings } = useApp();

  // Quotations live in the pre-sale pipeline — badge counts every quote that
  // has not yet become a booking (draft/sent/accepted/declined/legacy).
  const openQuoteCount = quotes.filter((q) => q.status !== "converted_to_job").length;

  // Ops Managers live inside the dispatch visibility window — badges must
  // count exactly what the target pages actually display, never the raw list.
  const isOps = userRole === "ops_manager";
  const opsVisibility = getOpsDateVisibility(new Date(), {
    nextDayDispatchTime: systemSettings?.nextDayDispatchTime || "20:00",
  });
  const badgeJobs = isOps ? filterJobsForOpsManager(jobs, opsVisibility) : jobs;

  // "Tomorrow's Dispatch Queue" badge mirrors the dispatcher page's queue
  // filter one-to-one: tomorrow's (or undated) SCHEDULED/ASSIGNED/DRAFT jobs
  // within the visibility window. An empty page can never show a badge > 0.
  const dispatchQueueCount = badgeJobs.filter(
    (j) =>
      (j.scheduledDate === opsVisibility.tomorrow || !j.scheduledDate) &&
      (j.status === "SCHEDULED" || j.status === "ASSIGNED" || j.status === "DRAFT")
  ).length;

  // Dynamic notification counts (computed over the role-visible job set)
  const pendingQC = badgeJobs.filter((j) => j.status === "WORK_COMPLETED" || j.status === "QUALITY_CHECK").length;
  const activeRework = badgeJobs.filter((j) => j.status === "REWORK_REQUIRED").length;
  const pendingApprovals = badgeJobs.filter((j) => j.status === "CUSTOMER_APPROVAL").length;

  let NAV_ITEMS: {
    group: string;
    items: {
      label: string;
      href: string;
      icon: any;
      badge?: number;
      badgeVariant?: string;
    }[];
  }[] = [];

  if (userRole === "super_admin") {
    NAV_ITEMS = [
      {
        group: "Overview",
        items: [
          { label: "Dashboard", href: "/", icon: LayoutDashboard },
        ],
      },
      {
        group: "Operations",
        items: [
          {
            label: "Quotations",
            href: "/quotations",
            icon: Receipt,
            badge: openQuoteCount,
          },
          {
            label: "Jobs",
            href: "/jobs",
            icon: Briefcase,
            badge: badgeJobs.filter((j) => j.status !== "COMPLETED" && j.status !== "CLOSED" && j.status !== "CANCELLED").length,
          },
          { label: "Calendar", href: "/calendar", icon: Calendar },
          { label: "AMC Contracts", href: "/amc", icon: ShieldCheck },
          { label: "QR & Secure Links", href: "/qr-links", icon: QrCodeIcon },
          { label: "Customers", href: "/customers", icon: Users },
          { label: "Properties", href: "/properties", icon: Building2 },
          { label: "Services & Rubrics", href: "/services", icon: Sparkles },
        ],
      },
      {
        group: "Quality",
        items: [
          {
            label: "Quality Checks & Rework",
            href: "/quality",
            icon: ShieldCheck,
            badge: pendingQC + activeRework > 0 ? pendingQC + activeRework : undefined,
            badgeVariant: activeRework > 0 ? "destructive" : "warning",
          },
        ],
      },
      {
        group: "Finance & Performance",
        items: [
          { label: "Finance & Expenses", href: "/finance", icon: DollarSign },
          { label: "Referrals & Partners", href: "/referrals", icon: Share2 },
          { label: "Analytics & Reports", href: "/reports", icon: BarChart3 },
          { label: "Notifications Log", href: "/notifications", icon: Bell },
        ],
      },
      {
        group: "Administration",
        items: [
          { label: "Users & Roles", href: "/users", icon: Users },
          { label: "Settings & Audits", href: "/settings", icon: Settings },
        ],
      },
    ];
  } else if (userRole === "ops_manager") {
    NAV_ITEMS = [
      {
        group: "Operations Overview",
        items: [
          { label: "Dashboard", href: "/", icon: LayoutDashboard },
          {
            label: "Tomorrow's Dispatch Queue",
            href: "/dispatcher",
            icon: Radio,
            badge: dispatchQueueCount,
          },
          {
            label: "Today's & All Jobs",
            href: "/jobs",
            icon: Briefcase,
          },
          { label: "Calendar", href: "/calendar", icon: Calendar },
          { label: "Staff Directory", href: "/users", icon: Users },
        ],
      },
      {
        group: "Quality Management",
        items: [
          {
            label: "Pending QC & Rework",
            href: "/quality",
            icon: ShieldCheck,
            badge: pendingQC + activeRework > 0 ? pendingQC + activeRework : undefined,
            badgeVariant: activeRework > 0 ? "destructive" : "warning",
          },
        ],
      },
    ];
  } else {
    // Staff / Field Worker
    NAV_ITEMS = [
      {
        group: "Field Execution",
        items: [
          { label: "My Assigned Jobs", href: "/field", icon: Smartphone },
        ],
      },
    ];
  }

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 text-slate-900 flex flex-col h-screen sticky top-0 overflow-y-auto z-20">
      {/* Brand Header with Company Logo — coral rule is the sidebar's single brand moment */}
      <div className="h-1 w-full bg-rose-500 shrink-0" />
      <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
        <Link href={userRole === "staff" ? "/field" : "/"} className="flex items-center gap-3 group">
          <div className="h-9 w-9 rounded-lg bg-white p-1.5 flex items-center justify-center border border-slate-200 overflow-hidden shrink-0 shadow-xs group-hover:border-rose-300 transition-colors">
            <img src="/logo.png" alt="Intense Care Logo" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-xs font-semibold tracking-tight text-slate-900 leading-none uppercase group-hover:text-rose-600 transition-colors">
              Intense Care
            </div>
            <div className="text-[10px] text-slate-500 tracking-wider mt-1 flex items-center gap-1 font-sans font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="text-rose-600 font-semibold">OPERATIONS ERP</span>
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 py-4 px-3 space-y-6">
        {NAV_ITEMS.map((group) => (
          <div key={group.group} className="space-y-1">
            <h4 className="px-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 font-sans">
              {group.group}
            </h4>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border",
                    isActive
                      ? "bg-white text-slate-900 font-semibold border-slate-200 shadow-xs"
                      : "text-slate-500 border-transparent hover:text-slate-900 hover:bg-white/70"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={cn("h-4 w-4", isActive ? "text-rose-500" : "text-slate-400")} />
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-sans font-medium border",
                        isActive
                          ? "bg-rose-500 text-white border-rose-500 font-semibold"
                          : item.badgeVariant === "destructive"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : item.badgeVariant === "warning"
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Customer Portal note — links are minted per-job after QC pass */}
        <div className="space-y-1 pt-3 border-t border-slate-200">
          <h4 className="px-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 font-mono">
            Portal
          </h4>
          <p className="px-3 text-[10px] text-slate-400 leading-relaxed">
            Customer handover links are generated on each job file after QC pass and expire automatically.
          </p>
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between font-mono">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          ERP v2.0
        </span>
        <span className="text-[10px] text-slate-400">2026</span>
      </div>
    </aside>
  );
}
