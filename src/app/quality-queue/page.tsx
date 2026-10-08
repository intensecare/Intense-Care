"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { QualityShell } from "@/components/quality/QualityShell";
import { useApp } from "@/lib/app-context";
import { formatTimeSlot, timeAgo, cn } from "@/lib/utils";
import { ChevronRight, CheckCircle2, MapPin, RotateCcw, Camera } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };

const WAITING = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];
const IN_REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];

/**
 * QUALITY CHECK — home of the QC role (Admin opens it too).
 * Jobs waiting for inspection, oldest first, each with ONE action: [INSPECT].
 */
export default function QualityQueuePage() {
  const { jobs, photos, refreshJobs, refreshQuality, loading } = useApp();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshJobs, refreshQuality]);

  const queue = (jobs as DeskJob[])
    .filter((j) => WAITING.includes(j.status))
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));
  const inRework = (jobs as DeskJob[]).filter((j) => IN_REWORK.includes(j.status));

  return (
    <QualityShell title="Quality Check" subtitle={`${queue.length} waiting`}>
      {loading && queue.length === 0 && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && queue.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-2 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <div className="text-lg font-semibold text-slate-900">All checked</div>
          <p className="text-sm text-slate-500">Jobs appear here as soon as a Field Manager completes the work.</p>
        </div>
      )}

      {queue.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Waiting for inspection</h2>
          {queue.map((j) => {
            const reinspect = ["REWORK_COMPLETED", "REINSPECTION"].includes(j.status);
            const photoCount = photos.filter((p) => p.jobId === j.id && (p.photoType === "before" || p.photoType === "after")).length;
            return (
              <div key={j.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-900">{j.customerName ?? "Customer"}</div>
                    <div className="text-sm text-slate-600">{j.service?.name ?? "Service"}</div>
                  </div>
                  <span className={cn("shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border", reinspect ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200")}>
                    {reinspect ? "Reinspection" : "New"}
                  </span>
                </div>
                <div className="text-sm text-slate-500 flex items-start gap-1.5">
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0" /> <span className="line-clamp-2">{j.propertyTitle ?? "Property"}</span>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-3">
                  <span>Completed {timeAgo(j.completedAt ?? j.updatedAt)}</span>
                  <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> {photoCount}</span>
                  <span className="font-mono">{j.jobNumber ?? j.id}</span>
                </div>
                <Link href={`/quality-queue/${j.id}`} className="h-12 w-full rounded-xl bg-rose-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-rose-600 active:scale-[0.99] transition">
                  {reinspect ? "REINSPECT" : "INSPECT"} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })}
        </section>
      )}

      {inRework.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Being fixed by the Field Manager</h2>
          <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 shadow-sm overflow-hidden">
            {inRework.map((j) => (
              <li key={j.id} className="px-5 py-3 flex items-center gap-3">
                <RotateCcw className="h-4 w-4 text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{j.customerName}</div>
                  <div className="text-xs text-slate-500">{j.service?.name} · {formatTimeSlot(j.scheduledTimeSlot)}</div>
                </div>
                <span className="text-xs text-slate-400">Rework</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </QualityShell>
  );
}
