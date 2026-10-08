"use client";

import React from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useWorkspace, type WorkspaceAttentionItem } from "@/lib/use-workspace";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, formatTimeSlot, cn } from "@/lib/utils";
import { CalendarDays, Activity, ClipboardCheck, RotateCcw, UserCheck, CheckCircle2, ChevronRight, AlertTriangle, Plus, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * ADMIN — "Today's Operations".
 * Five numbers, then only what needs action, then today's jobs.
 */
export default function OperationsDashboardPage() {
  const { data, error, loading, refresh } = useWorkspace(15000);
  const { currentUser } = useAuth();
  const router = useRouter();
  const counts = data?.counts;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const todays = (data?.queue ?? []).filter((q) => q.scheduledDate === today);

  const metrics = [
    { label: "Today's Jobs", value: counts?.today, href: "/schedule", Icon: CalendarDays, tone: "neutral" as const },
    { label: "Active", value: counts?.active, href: "/jobs?status=IN_PROGRESS", Icon: Activity, tone: "info" as const },
    { label: "QC Pending", value: counts?.qcPending, href: "/quality-queue", Icon: ClipboardCheck, tone: "warning" as const },
    { label: "Rework", value: counts?.rework, href: "/jobs?status=REWORK_REQUIRED", Icon: RotateCcw, tone: "error" as const },
    { label: "Approval Pending", value: counts?.approvalPending, href: "/jobs?status=CUSTOMER_APPROVAL", Icon: UserCheck, tone: "warning" as const },
  ];

  return (
    <AdminLayout>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-base text-zinc-500">{greeting()}, {currentUser?.name?.split(" ")[0]}</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950">Today&apos;s Operations</h1>
          <p className="text-sm text-zinc-500 mt-1">{formatDate(today)}</p>
        </div>
      </div>

      {error && <ErrorState className="mb-6" message="Something went wrong while loading today's operations." onRetry={() => void refresh()} />}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6 sm:mb-8">
        {metrics.map(({ label, value, href, Icon, tone }) => {
          const hot = (value ?? 0) > 0 && tone !== "neutral";
          return (
            <Link key={label} href={href} className={cn("rounded-2xl border bg-white p-4 sm:p-5 transition-shadow hover:shadow-md flex flex-col justify-between min-h-[108px]", hot ? (tone === "error" ? "border-red-200" : tone === "warning" ? "border-amber-200" : "border-info-200") : "border-zinc-200")}>
              <span className="flex items-start justify-between gap-2 text-sm font-medium text-zinc-600">
                {label}
                <Icon className={cn("h-5 w-5 shrink-0", hot ? (tone === "error" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-info-600") : "text-zinc-400")} aria-hidden />
              </span>
              {loading && value === undefined ? (
                <Skeleton className="h-9 w-12 mt-2" />
              ) : (
                <span className={cn("text-3xl sm:text-4xl font-semibold tracking-tight mt-2", hot ? (tone === "error" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-info-700") : "text-zinc-950")}>{value ?? 0}</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Attention required */}
        <section className="lg:col-span-2 space-y-6" aria-labelledby="attention-title">
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h2 id="attention-title" className="text-base font-semibold text-zinc-950 flex items-center gap-2">
                <AlertTriangle className={cn("h-5 w-5", data?.attention.length ? "text-amber-500" : "text-zinc-300")} aria-hidden /> Attention required
              </h2>
              {(data?.attention.length ?? 0) > 0 && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">{data?.attention.length}</span>}
            </div>
            {loading && !data ? (
              <div className="p-5 space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : (data?.attention.length ?? 0) === 0 ? (
              <div className="px-5 py-10 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500 mx-auto" aria-hidden />
                <p className="mt-2 text-base font-semibold text-zinc-900">All clear</p>
                <p className="text-sm text-zinc-500">Nothing needs your attention right now.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {data!.attention.map((it: WorkspaceAttentionItem) => (
                  <li key={it.key}>
                    <Link href={it.href} className="flex items-center gap-3 px-5 py-4 hover:bg-zinc-50 transition-colors">
                      <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", it.tone === "alert" ? "bg-red-500" : "bg-amber-500")} aria-hidden />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-zinc-950 truncate">{it.title}</span>
                        <span className={cn("block text-sm", it.tone === "alert" ? "text-red-700" : "text-amber-800")}>{it.reason}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-zinc-300 shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data?.finance && (
            <Link href="/invoices" className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 hover:shadow-md transition-shadow">
              <span className="h-11 w-11 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0"><Wallet className="h-5 w-5" aria-hidden /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-zinc-500">Still to collect</span>
                <span className="block text-xl font-semibold text-zinc-950">{formatCurrency(data.finance.outstanding)}</span>
              </span>
              <span className="text-right">
                <span className="block text-sm text-zinc-500">This month</span>
                <span className="block text-base font-semibold text-emerald-700">{formatCurrency(data.finance.collectedMonth)}</span>
              </span>
            </Link>
          )}
        </section>

        {/* Today's jobs */}
        <section className="lg:col-span-3 rounded-2xl border border-zinc-200 bg-white overflow-hidden" aria-labelledby="today-title">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3">
            <h2 id="today-title" className="text-base font-semibold text-zinc-950">Today&apos;s jobs</h2>
            <span className="text-sm text-zinc-500">{counts?.completed ?? 0} completed</span>
          </div>
          {loading && !data ? (
            <div className="p-5 space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : todays.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={CalendarDays} title="No jobs today" description="No jobs are scheduled for today." actionLabel="Create job" onAction={() => router.push("/jobs/new")} className="border-0 py-8" />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {todays.map((q) => (
                <li key={q.id}>
                  <Link href={`/jobs/${q.id}`} className="grid grid-cols-[4.5rem_1fr_auto] sm:grid-cols-[5rem_1fr_auto_auto] items-center gap-3 px-5 py-4 hover:bg-zinc-50 transition-colors">
                    <span className="text-sm font-semibold text-zinc-950">{formatTimeSlot(q.scheduledTimeSlot).split(" - ")[0]}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-950 truncate">{q.customerName ?? "Customer"}</span>
                      <span className="block text-sm text-zinc-500 truncate">{q.serviceName}{q.city ? ` · ${q.city}` : ""}</span>
                      <span className="sm:hidden mt-1.5 block"><StatusBadge status={q.status} size="sm" /></span>
                    </span>
                    <span className="hidden sm:block"><StatusBadge status={q.status} size="sm" /></span>
                    <ChevronRight className="h-5 w-5 text-zinc-300" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="px-5 py-3 border-t border-zinc-100 flex items-center justify-between">
            <Link href="/jobs" className="text-sm font-semibold text-rose-600 inline-flex items-center gap-1">All jobs <ChevronRight className="h-4 w-4" aria-hidden /></Link>
            <Link href="/jobs/new" className="text-sm font-semibold text-zinc-700 inline-flex items-center gap-1"><Plus className="h-4 w-4" aria-hidden /> New job</Link>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
