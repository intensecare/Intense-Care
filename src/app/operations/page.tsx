"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { StatTile, AttentionPanel, NextActionChip } from "@/components/workspace/WorkspaceWidgets";
import { useWorkspace } from "@/lib/use-workspace";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatTimeSlot, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Briefcase } from "lucide-react";
import type { JobStatus } from "@/lib/types";

/**
 * OPERATIONS MANAGER home — "Operations Today" (§6).
 * Exceptions first: the attention list, then today's jobs by stage, then
 * the full queue with each job's ONE next action for this role.
 */
export default function OperationsPage() {
  const { data, error, loading } = useWorkspace(10000);
  const { can } = useAuth();
  const [filter, setFilter] = useState<"all" | "today" | "actionable">("today");
  const counts = data?.counts;
  const queue = (data?.queue ?? []).filter((j) =>
    filter === "all" ? true : filter === "today" ? j.scheduledDate === data?.today : j.actionable
  );

  return (
    <AdminLayout>
      <PageHeader
        title="Operations Today"
        description="Review bookings → schedule → assign → monitor arrivals and active jobs → QC → rework → customer approval → close."
        actions={
          can("jobs.create") ? (
            <Link href="/jobs?create=true">
              <Button size="sm" className="h-9 gap-1.5 text-xs text-white">
                <Briefcase className="h-3.5 w-3.5" /> New Booking
              </Button>
            </Link>
          ) : undefined
        }
      />
      {error && <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="rounded-lg border border-zinc-200 bg-white p-4 mb-4 flex flex-wrap items-end gap-6">
        <div>
          <div className="text-xs font-medium text-zinc-500">Jobs today</div>
          <div className="text-4xl font-semibold tracking-tight text-zinc-950 leading-none mt-1">{counts?.today ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="grid grid-cols-5 gap-4 text-center">
          {[
            ["Scheduled", counts?.scheduled ?? 0, "/dispatcher"],
            ["Assigned", counts?.assigned ?? 0, "/jobs?status=ASSIGNED"],
            ["In progress", counts?.inProgress ?? 0, "/jobs?status=IN_PROGRESS"],
            ["QC pending", counts?.qcPending ?? 0, "/quality"],
            ["Rework", counts?.rework ?? 0, "/quality"],
          ].map(([label, value, href]) => (
            <Link key={String(label)} href={String(href)} className="min-w-[72px]">
              <div className="text-xl font-semibold text-zinc-900 leading-none">{value}</div>
              <div className="text-[11px] text-zinc-500 mt-1">{label}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <AttentionPanel items={data?.attention ?? []} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Waiting for customer" value={counts?.approvalPending ?? 0} href="/jobs?status=CUSTOMER_APPROVAL" />
            <StatTile label="Completed" value={counts?.completed ?? 0} href="/jobs?status=COMPLETED" tone="success" />
          </div>
        </div>

        <div className="lg:col-span-2 rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">Operations queue</h3>
            <div className="flex items-center gap-1 text-xs">
              {(["today", "actionable", "all"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn("px-2.5 py-1 rounded-md border", filter === f ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50")}
                >
                  {f === "today" ? "Today" : f === "actionable" ? "Needs action" : "All open"}
                </button>
              ))}
            </div>
          </div>
          {queue.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-500">{loading ? "Loading…" : "No jobs in this view."}</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {queue.map((j) => (
                <li key={j.id}>
                  <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] text-zinc-500">{j.id}</span>
                        <JobStatusBadge status={j.status as JobStatus} size="sm" />
                      </div>
                      <div className="text-xs font-semibold text-zinc-900 truncate mt-0.5">
                        {j.customerName ?? "Customer"} · <span className="font-normal text-zinc-500">{j.serviceName}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {j.scheduledDate === data?.today ? "Today" : formatDate(j.scheduledDate)} · {formatTimeSlot(j.scheduledTimeSlot)} · {j.propertyTitle}
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
    </AdminLayout>
  );
}
