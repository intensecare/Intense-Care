"use client";

import React from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatTile, AttentionPanel, NextActionChip } from "@/components/workspace/WorkspaceWidgets";
import { RevenueTrendChart } from "@/components/common/RevenueTrendChart";
import { useWorkspace } from "@/lib/use-workspace";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, formatTimeSlot } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Briefcase, Receipt, ChevronRight } from "lucide-react";

/**
 * SUPER ADMIN home — "Business Overview" (§5).
 * Answers "what needs my attention?" in one screen: today's numbers,
 * the attention list (deep-linked), revenue, and the live queue. The admin
 * never has to open every module to find out what is going on.
 */
export default function BusinessOverviewPage() {
  const { data, error, loading } = useWorkspace();
  const { invoices, payments } = useApp();
  const { can } = useAuth();
  const counts = data?.counts;
  const fin = data?.finance;
  const queue = (data?.queue ?? []).filter((q) => q.actionable).slice(0, 8);

  return (
    <AdminLayout>
      <PageHeader
        title="Business Overview"
        description="What needs your attention today — every number links to the place to act."
        actions={
          <>
            {can("quotes.manage") && (
              <Link href="/quotations?raise=true">
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                  <Receipt className="h-3.5 w-3.5 text-zinc-400" /> New Quotation
                </Button>
              </Link>
            )}
            {can("jobs.create") && (
              <Link href="/jobs?create=true">
                <Button size="sm" className="h-9 gap-1.5 text-xs text-white">
                  <Briefcase className="h-3.5 w-3.5" /> New Booking
                </Button>
              </Link>
            )}
          </>
        }
      />

      {error && <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatTile label="Today's Jobs" value={counts?.today ?? (loading ? "…" : 0)} href="/operations" />
        <StatTile label="Jobs In Progress" value={counts?.inProgress ?? 0} href="/operations" tone={counts?.inProgress ? "success" : "neutral"} />
        <StatTile label="QC Pending" value={counts?.qcPending ?? 0} href="/quality-queue" tone={counts?.qcPending ? "warning" : "neutral"} />
        <StatTile label="Rework Pending" value={counts?.rework ?? 0} href="/quality" tone={counts?.rework ? "alert" : "neutral"} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatTile label="Customer Issues" value={data?.attention.find((a) => a.key === "complaints")?.count ?? 0} href="/quality" tone={data?.attention.some((a) => a.key === "complaints") ? "alert" : "neutral"} />
        <StatTile label="Payments Pending" value={fin ? formatCurrency(fin.pending) : "—"} href="/finance" hint={fin ? `${fin.pendingCount} invoice${fin.pendingCount === 1 ? "" : "s"} · ${fin.overdueCount} overdue` : undefined} tone={fin?.overdueCount ? "warning" : "neutral"} />
        <StatTile label="AMC Visits Due" value={data?.attention.find((a) => a.key === "amc")?.count ?? 0} href="/amc" hint="next 7 days" />
        <StatTile label="Revenue (this month)" value={fin ? formatCurrency(fin.revenueMonth) : "—"} href="/reports" tone="success" hint={fin ? `${formatCurrency(fin.collected)} collected all-time` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AttentionPanel items={data?.attention ?? []} />

          <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Live queue — jobs waiting on someone</h3>
              <Link href="/operations" className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1">
                View operations <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {queue.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-500">Nothing is waiting on the desk right now.</div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {queue.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 truncate">
                          {j.customerName ?? "Customer"} · <span className="font-normal text-zinc-500">{j.serviceName}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          {formatDate(j.scheduledDate)} · {formatTimeSlot(j.scheduledTimeSlot)} · {j.propertyTitle}
                        </div>
                      </div>
                      <NextActionChip action={j.nextAction} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {can("finance.view") && <RevenueTrendChart invoices={invoices} payments={payments} />}
          <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
            {[
              { href: "/operations", title: "Operations", desc: "Today's jobs, exceptions and crews" },
              { href: "/schedule", title: "Schedule", desc: "Calendar + scheduling board" },
              { href: "/quality-queue", title: "Quality Queue", desc: "Inspect, pass or raise rework" },
              { href: "/finance", title: "Finance", desc: "Outstanding, payments, refunds" },
              { href: "/users", title: "Users & Roles", desc: "Accounts across the nine roles" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 group">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-800">{l.title}</div>
                  <p className="text-[11px] text-zinc-400 truncate">{l.desc}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
