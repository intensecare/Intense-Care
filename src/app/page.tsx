"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useWorkspace, type WorkspaceAttentionItem } from "@/lib/use-workspace";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, formatTimeSlot, cn } from "@/lib/utils";
import { CalendarDays, Activity, ClipboardCheck, RotateCcw, CheckCircle2, ChevronRight, AlertTriangle, Plus, IndianRupee, Receipt, Star } from "lucide-react";

const KINDS: [string, string][] = [["all", "All"], ["qc", "QC pending"], ["payment", "Payment pending"], ["rework", "Rework pending"], ["unassigned", "Unassigned"], ["upcoming", "Upcoming"], ["issue", "Customer issues"], ["other", "Other"]];
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
  const [kind, setKind] = useState<string>("all");
  const counts = data?.counts;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const todays = (data?.queue ?? []).filter((q) => q.scheduledDate === today);

  const fb = data?.feedback;
  const metrics: { label: string; value: React.ReactNode; raw?: number; href: string; Icon: typeof CalendarDays; tone: "neutral" | "info" | "warning" | "error" | "success"; sub?: string }[] = [
    { label: "Today's Jobs", value: counts?.today, raw: counts?.today, href: "/schedule", Icon: CalendarDays, tone: "neutral" },
    { label: "Active", value: counts?.active, raw: counts?.active, href: "/jobs?status=IN_PROGRESS", Icon: Activity, tone: "info" },
    { label: "Completed", value: counts?.completed, raw: counts?.completed, href: "/jobs?status=COMPLETED", Icon: CheckCircle2, tone: "success", sub: "today" },
    { label: "Pending QC", value: counts?.qcPending, raw: counts?.qcPending, href: "/quality-queue", Icon: ClipboardCheck, tone: "warning" },
    { label: "Rework", value: counts?.rework, raw: counts?.rework, href: "/jobs?status=REWORK_REQUIRED", Icon: RotateCcw, tone: "error" },
    ...(data?.finance
      ? [
          { label: "Revenue", value: formatCurrency(data.finance.revenueMonth), href: "/reports", Icon: IndianRupee, tone: "neutral" as const, sub: `this month · ${formatCurrency(data.finance.collectedMonth)} collected` },
          { label: "Pending Invoices", value: data.finance.pendingInvoices, raw: data.finance.pendingInvoices, href: "/invoices", Icon: Receipt, tone: "warning" as const, sub: `${formatCurrency(data.finance.outstanding)} to collect` },
        ]
      : []),
    ...(fb
      ? [{ label: "Customer Feedback", value: fb.average !== null ? `${fb.average}★` : "—", href: "/reviews", Icon: Star, tone: "neutral" as const, sub: `${fb.count} rating${fb.count === 1 ? "" : "s"} · 30 days${fb.low ? ` · ${fb.low} low` : ""}` }]
      : []),
  ];
  const attention = (data?.attention ?? []).filter((a) => kind === "all" || (a.kind ?? "other") === kind);
  const kindCount = (k: string) => (data?.attention ?? []).filter((a) => (a.kind ?? "other") === k).length;

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
        {metrics.map(({ label, value, raw, href, Icon, tone, sub }) => {
          const hot = (raw ?? 0) > 0 && tone !== "neutral" && tone !== "success";
          return (
            <Link key={label} href={href} className={cn("rounded-2xl border bg-white p-4 sm:p-5 transition-shadow hover:shadow-md flex flex-col justify-between min-h-[108px] min-w-0", hot ? (tone === "error" ? "border-red-200" : tone === "warning" ? "border-amber-200" : "border-info-200") : "border-zinc-200")}>
              <span className="flex items-start justify-between gap-2 text-sm font-medium text-zinc-600">
                {label}
                <Icon className={cn("h-5 w-5 shrink-0", hot ? (tone === "error" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-info-600") : tone === "success" ? "text-emerald-600" : "text-zinc-400")} aria-hidden />
              </span>
              {loading && value === undefined ? (
                <Skeleton className="h-9 w-12 mt-2" />
              ) : (
                <span className={cn("font-semibold tracking-tight mt-2 break-words", typeof value === "string" && value.length > 6 ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl", hot ? (tone === "error" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-info-700") : "text-zinc-950")}>{value ?? 0}</span>
              )}
              {sub && <span className="mt-1 text-xs text-zinc-500 break-words">{sub}</span>}
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
            {(data?.attention.length ?? 0) > 0 && (
              <div className="flex gap-2 overflow-x-auto px-5 pt-3 pb-1" role="tablist" aria-label="Filter attention items">
                {KINDS.filter(([k]) => k === "all" || kindCount(k) > 0).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn("shrink-0 min-h-9 px-3 rounded-full border text-xs font-semibold", kind === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>
                    {l} {k === "all" ? data?.attention.length : kindCount(k)}
                  </button>
                ))}
              </div>
            )}
            {loading && !data ? (
              <div className="p-5 space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : attention.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500 mx-auto" aria-hidden />
                <p className="mt-2 text-base font-semibold text-zinc-900">All clear</p>
                <p className="text-sm text-zinc-500">Nothing needs your attention right now.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 max-h-[32rem] overflow-y-auto">
                {attention.map((it: WorkspaceAttentionItem) => (
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
