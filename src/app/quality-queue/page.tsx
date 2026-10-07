"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatTimeSlot, timeAgo, cn } from "@/lib/utils";
import { getNextAction } from "@/lib/rbac";
import { ClipboardCheck, RotateCcw, ChevronRight } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };

/**
 * QUALITY INSPECTOR home — "Quality Queue" (§10 / §23).
 * One list, newest submission first; one button per row: INSPECT.
 */
export default function QualityQueuePage() {
  const { jobs, photos, refreshJobs, refreshQuality, currentUser } = useApp();
  const { can } = useAuth();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshJobs, refreshQuality]);

  const queue = (jobs as DeskJob[])
    .filter((j) => ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(j.status))
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));
  const waiting = (jobs as DeskJob[]).filter((j) => ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"].includes(j.status));

  return (
    <AdminLayout>
      <PageHeader title="Quality Queue" description="Jobs submitted by the field team, waiting for an independent inspection." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-zinc-400" /> Ready for inspection
            </h3>
            <span className="text-xs text-zinc-500">{queue.length}</span>
          </div>
          {queue.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-zinc-500">Queue clear — nothing is waiting for QC.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {queue.map((j) => {
                const next = getNextAction(currentUser.role, { status: j.status });
                const reinspect = ["REWORK_COMPLETED", "REINSPECTION"].includes(j.status);
                const photoCount = photos.filter((p) => p.jobId === j.id).length;
                return (
                  <li key={j.id} className="px-4 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900">{j.id}</span>
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border", reinspect ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-violet-50 text-violet-700 border-violet-200")}>
                          {reinspect ? "Reinspection" : "First inspection"}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-700 mt-0.5">{j.service?.name} · {j.customerName}</div>
                      <div className="text-[11px] text-zinc-400">
                        Submitted {timeAgo(j.completedAt ?? j.updatedAt)} · {formatTimeSlot(j.scheduledTimeSlot)} · {photoCount} photo{photoCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    {can("qc.inspect") && (
                      <Link href={`/quality-queue/${j.id}`} className="h-10 px-4 rounded-lg bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-rose-600">
                        {next?.label ?? "Inspect"} <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-zinc-400" /> Rework in progress
            </h3>
            <span className="text-xs text-zinc-500">{waiting.length}</span>
          </div>
          {waiting.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">No rework outstanding.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {waiting.map((j) => (
                <li key={j.id} className="px-4 py-3">
                  <div className="font-mono text-xs font-semibold text-zinc-900">{j.id}</div>
                  <div className="text-[11px] text-zinc-500">{j.service?.name} · {j.customerName}</div>
                  <div className="text-[11px] text-amber-700 mt-0.5">Waiting for the team to fix the reported issues.</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
