"use client";

import React, { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QualityShell } from "@/components/quality/QualityShell";
import { ProfilePanel } from "@/components/common/MobileLayout";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { SkeletonList } from "@/components/ui/states";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, timeAgo, cn } from "@/lib/utils";
import { ChevronRight, CheckCircle2, MapPin, RotateCcw, Camera, ClipboardCheck, History } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };

const WAITING = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];
const IN_REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * QUALITY — the QC app: Home · Quality · History · Profile.
 * Admin opens the same page inside the Operations desk.
 */
function QualityQueue() {
  const tab = useSearchParams()?.get("tab") ?? "home";
  const { jobs, photos, qualityChecks, refreshJobs, refreshQuality, loading } = useApp();
  const { currentUser } = useAuth();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshJobs, refreshQuality]);

  const all = jobs as DeskJob[];
  const queue = all.filter((j) => WAITING.includes(j.status)).sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));
  const inRework = all.filter((j) => IN_REWORK.includes(j.status));
  const reinspections = queue.filter((j) => ["REWORK_COMPLETED", "REINSPECTION"].includes(j.status));
  const today = new Date().toISOString().slice(0, 10);
  const history = [...qualityChecks].sort((a, b) => (b.inspectedAt ?? "").localeCompare(a.inspectedAt ?? ""));
  const passedToday = history.filter((q) => q.status === "PASS" && (q.inspectedAt ?? "").startsWith(today)).length;
  const isQc = currentUser?.role === "qc_inspector";

  const card = (j: DeskJob) => {
    const reinspect = ["REWORK_COMPLETED", "REINSPECTION"].includes(j.status);
    const count = photos.filter((p) => p.jobId === j.id && (p.photoType === "before" || p.photoType === "after")).length;
    return (
      <article key={j.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-zinc-950">{j.customerName ?? "Customer"}</div>
            <div className="text-sm text-zinc-600">{j.service?.name ?? "Service"}</div>
          </div>
          <span className={cn("shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border", reinspect ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-info-50 text-info-700 border-info-200")}>
            {reinspect ? "Reinspection" : "New"}
          </span>
        </div>
        <div className="text-sm text-zinc-500 flex items-start gap-1.5">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> <span className="line-clamp-2">{j.propertyTitle ?? "Property"}</span>
        </div>
        <div className="text-sm text-zinc-500 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{j.jobNumber ?? j.id}</span>
          <span>Done {timeAgo(j.completedAt ?? j.updatedAt)}</span>
          <span className="inline-flex items-center gap-1"><Camera className="h-4 w-4" aria-hidden /> {count} photos</span>
        </div>
        <Link href={`/quality-queue/${j.id}`} className="h-12 w-full rounded-xl bg-rose-500 text-white text-base font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-rose-600 active:scale-[0.99] transition">
          {reinspect ? "REINSPECT" : "INSPECT"} <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      </article>
    );
  };

  const titles: Record<string, string> = { home: "Home", quality: "Quality", history: "History", profile: "Profile" };

  return (
    <QualityShell title={isQc ? titles[tab] ?? "Home" : "Quality"} subtitle={isQc ? "Quality Check" : `${queue.length} waiting for inspection`}>
      {tab === "profile" && <ProfilePanel />}

      {tab === "home" && (
        <>
          {isQc && (
            <div>
              <p className="text-base text-zinc-500">{greeting()},</p>
              <p className="text-2xl font-semibold text-zinc-950">{currentUser?.name.split(" ")[0]}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "To inspect", value: queue.length - reinspections.length, tone: "text-zinc-950" },
              { label: "Reinspections", value: reinspections.length, tone: "text-amber-700" },
              { label: "Being fixed", value: inRework.length, tone: "text-red-700" },
              { label: "Passed today", value: passedToday, tone: "text-emerald-700" },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-sm text-zinc-500">{t.label}</div>
                <div className={cn("text-3xl font-semibold mt-1", t.tone)}>{t.value}</div>
              </div>
            ))}
          </div>
          <h2 className="text-lg font-semibold text-zinc-950 pt-1">Waiting for inspection</h2>
          {loading && queue.length === 0 ? (
            <SkeletonList rows={2} />
          ) : queue.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All checked" description="Jobs appear here as soon as a Field Manager completes the work." />
          ) : (
            <div className="space-y-3">{queue.map(card)}</div>
          )}
          {!isQc && inRework.length > 0 && <BeingFixed list={inRework} />}
        </>
      )}

      {tab === "quality" && (
        <>
          {queue.length === 0 ? <EmptyState icon={ClipboardCheck} title="Nothing to inspect" description="Completed jobs appear here for inspection." /> : <div className="space-y-3">{queue.map(card)}</div>}
          {inRework.length > 0 && <BeingFixed list={inRework} />}
        </>
      )}

      {tab === "history" && (
        history.length === 0 ? (
          <EmptyState icon={History} title="No inspections yet" description="Every inspection you complete is kept here." />
        ) : (
          <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
            {history.slice(0, 50).map((q) => {
              const j = all.find((x) => x.id === q.jobId);
              const passed = q.status === "PASS";
              return (
                <li key={q.id}>
                  <Link href={`/quality-queue/${q.jobId}`} className="flex items-center gap-3 px-4 py-4 active:bg-zinc-50">
                    <span className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                      {passed ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <RotateCcw className="h-5 w-5" aria-hidden />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-semibold text-zinc-950 truncate">{j?.customerName ?? j?.jobNumber ?? "Job"}</span>
                      <span className="block text-sm text-zinc-500">{passed ? "Passed" : "Rework required"} · {q.inspectedAt ? formatDateTime(q.inspectedAt) : ""}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 text-zinc-300" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )
      )}
    </QualityShell>
  );
}

function BeingFixed({ list }: { list: DeskJob[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide px-1">Being fixed by the Field Manager</h2>
      <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
        {list.map((j) => (
          <li key={j.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-zinc-950 truncate">{j.customerName}</div>
              <div className="text-sm text-zinc-500">{j.service?.name} · {formatDate(j.scheduledDate)}</div>
            </div>
            <StatusBadge status={j.status} size="sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function QualityQueuePage() {
  return (
    <Suspense>
      <QualityQueue />
    </Suspense>
  );
}
