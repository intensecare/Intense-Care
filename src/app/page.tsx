"use client";

import React from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatTile, AttentionPanel, NextActionChip } from "@/components/workspace/WorkspaceWidgets";
import { useWorkspace } from "@/lib/use-workspace";
import { formatCurrency, formatDate, formatTimeSlot } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Briefcase, CalendarDays, Activity, ClipboardCheck, RotateCcw, UserCheck, CheckCircle2, ChevronRight, MapPin } from "lucide-react";

/**
 * ADMIN home — "Operations".
 * WHERE AM I: Operations. WHAT HAPPENED: six live numbers.
 * WHAT HAPPENS NEXT: Attention Required + today's jobs, each with ONE next action.
 */
export default function OperationsDashboardPage() {
  const { data, error, loading } = useWorkspace(15000);
  const counts = data?.counts;
  const n = (v: number | undefined) => (v === undefined ? (loading ? "…" : 0) : v);
  const today = data?.today ?? "";
  const todays = (data?.queue ?? []).filter((q) => q.scheduledDate === today);
  const upcoming = (data?.queue ?? []).filter((q) => q.scheduledDate > today && q.actionable).slice(0, 5);

  return (
    <AdminLayout>
      <PageHeader
        title="Operations"
        description={today ? `Today, ${formatDate(today)}` : "Today"}
        actions={
          <Link href="/jobs?create=true">
            <Button className="h-11 px-5 gap-2 rounded-xl text-sm text-white">
              <Briefcase className="h-4 w-4" /> New Job
            </Button>
          </Link>
        }
      />

      {error && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <StatTile label="Today's Jobs" value={n(counts?.today)} href="/schedule" icon={<CalendarDays className="h-5 w-5" />} />
        <StatTile label="Active Jobs" value={n(counts?.active)} href="/jobs?status=IN_PROGRESS" tone={counts?.active ? "success" : "neutral"} icon={<Activity className="h-5 w-5" />} />
        <StatTile label="QC Pending" value={n(counts?.qcPending)} href="/quality-queue" tone={counts?.qcPending ? "warning" : "neutral"} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatTile label="Rework Pending" value={n(counts?.rework)} href="/quality-queue" tone={counts?.rework ? "alert" : "neutral"} icon={<RotateCcw className="h-5 w-5" />} />
        <StatTile label="Customer Approval Pending" value={n(counts?.approvalPending)} href="/jobs?status=CUSTOMER_APPROVAL" tone={counts?.approvalPending ? "warning" : "neutral"} icon={<UserCheck className="h-5 w-5" />} />
        <StatTile label="Completed Jobs" value={n(counts?.completed)} hint="today" href="/jobs?status=COMPLETED" tone={counts?.completed ? "success" : "neutral"} icon={<CheckCircle2 className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AttentionPanel items={data?.attention ?? []} />
          {data?.finance && (
            <Link href="/finance" className="block rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="text-sm font-medium text-zinc-500">Payments</div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <div className="text-2xl font-semibold text-zinc-950">{formatCurrency(data.finance.outstanding)}</div>
                  <div className="text-xs text-zinc-400">still to collect</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-emerald-700">{formatCurrency(data.finance.collectedMonth)}</div>
                  <div className="text-xs text-zinc-400">collected this month</div>
                </div>
              </div>
            </Link>
          )}
        </div>

        <div className="lg:col-span-3 space-y-6">
          <JobList title="Today's jobs" empty={loading ? "Loading…" : "No jobs scheduled for today."} items={todays} />
          {upcoming.length > 0 && <JobList title="Coming up — needs action" items={upcoming} showDate />}
        </div>
      </div>
    </AdminLayout>
  );
}

function JobList({
  title,
  items,
  empty,
  showDate,
}: {
  title: string;
  items: NonNullable<ReturnType<typeof useWorkspace>["data"]>["queue"];
  empty?: string;
  showDate?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        <span className="text-xs text-zinc-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-zinc-500">{empty}</div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((q) => (
            <li key={q.id}>
              <Link href={`/jobs/${q.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors">
                <div className="w-16 shrink-0">
                  <div className="text-sm font-semibold text-zinc-900">{formatTimeSlot(q.scheduledTimeSlot).split(" - ")[0]}</div>
                  {showDate && <div className="text-xs text-zinc-400">{formatDate(q.scheduledDate)}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{q.customerName ?? "Customer"}</div>
                  <div className="text-xs text-zinc-500 truncate flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" /> {q.serviceName} · {q.propertyTitle}
                  </div>
                  <div className="mt-1.5 sm:hidden">
                    <NextActionChip action={q.nextAction} />
                  </div>
                </div>
                <div className="hidden sm:block">
                  <NextActionChip action={q.nextAction} />
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-300 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
