"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Phone,
  Mail,
  CalendarDays,
  Briefcase,
  Camera,
  RotateCcw,
  Search,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Crown,
  UserCheck,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { formatDate, formatTimeSlot, formatDateTime } from "@/lib/utils";
import type { StaffDirectoryEntry } from "@/lib/types";

/**
 * Field Staff Directory — the operations desk's roster view.
 *
 * Data comes entirely from GET /api/users/staff-directory (server-computed
 * stats, assignments, rework and photo counts). Clicking a worker's name
 * opens their full file: contact details, work statistics, open QC rework
 * with instructions, and the complete job history with links to each record.
 */
export function useStaffDirectory() {
  const [entries, setEntries] = useState<StaffDirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users/staff-directory");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || `Could not load the staff directory (${res.status}).`);
        setEntries((prev) => prev); // keep last good data on a failed refresh
      } else {
        setEntries(json.data as StaffDirectoryEntry[]);
        setError(null);
      }
    } catch {
      setError("Could not load the staff directory. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}

function StatTile({ icon: Icon, label, value, tint }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
        <Icon className={`h-3.5 w-3.5 ${tint}`} />
        {label}
      </div>
      <div className="text-xl font-semibold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

/** Full worker file — opened from the directory list (or the admin table). */
export function StaffDetailDialog({
  entry,
  onClose,
}: {
  entry: StaffDirectoryEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const s = entry.stats;

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm shrink-0">
              {entry.name.substring(0, 2).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-semibold text-slate-900 truncate">{entry.name}</span>
              <span className="block text-[11px] font-normal text-slate-500">
                Field Staff — {entry.active ? "Active account" : "Disabled account"}
              </span>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                entry.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
              }`}
            >
              {entry.active ? "Active" : "Disabled"}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          {/* Contact — every field straight from the accounts table */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href={`tel:${entry.phone}`}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <Phone className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-mono font-semibold text-slate-800 truncate">{entry.phone || "No phone on file"}</span>
            </a>
            <a
              href={`mailto:${entry.email}`}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <Mail className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="font-semibold text-slate-800 truncate">{entry.email}</span>
            </a>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            Field staff since <strong className="text-slate-700">{formatDate(entry.createdAt.slice(0, 10))}</strong>
            <span className="text-slate-300">•</span>
            Account created {formatDateTime(entry.createdAt)}
          </div>

          {/* Server-computed work statistics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile icon={Briefcase} label="Total Jobs" value={s.totalJobs} tint="text-slate-500" />
            <StatTile icon={ShieldCheck} label="Active Now" value={s.activeJobs} tint="text-blue-500" />
            <StatTile icon={UserCheck} label="Completed" value={s.completedJobs} tint="text-emerald-600" />
            <StatTile icon={CalendarDays} label="Upcoming" value={s.upcomingJobs} tint="text-amber-500" />
            <StatTile icon={Crown} label="As Lead" value={s.leadJobs} tint="text-indigo-500" />
            <StatTile icon={Camera} label="Photos" value={s.photosUploaded} tint="text-sky-500" />
            <StatTile icon={RotateCcw} label="Open Rework" value={s.openReworkTasks} tint="text-red-600" />
          </div>

          {/* Open QC rework with the exact instructions */}
          {entry.openRework.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 space-y-2">
              <div className="font-semibold text-red-800 flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Open Rework Assigned by QC ({entry.openRework.length})
              </div>
              {entry.openRework.map((r) => (
                <div key={r.id} className="p-2 rounded bg-white border border-red-200 text-[11px] space-y-1">
                  <Link href={`/jobs/${r.jobId}`} className="font-mono font-semibold text-slate-900 hover:underline">
                    {r.jobId}
                  </Link>
                  <p className="text-slate-700">{r.instructions}</p>
                  <p className="text-[10px] text-slate-400">Assigned {formatDateTime(r.createdAt)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Job history */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-500">
                Job History ({entry.jobs.length}{entry.stats.totalJobs > entry.jobs.length ? ` of ${entry.stats.totalJobs}` : ""})
              </span>
            </div>
            {entry.jobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No jobs assigned to this worker yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {entry.jobs.map((j) => (
                  <Link
                    key={j.id}
                    href={`/jobs/${j.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900 text-[11px] truncate">{j.id}</span>
                        {j.isLead && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                            Lead
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate">
                        {j.customerName || "Customer"}
                        {j.propertyTitle ? ` • ${j.propertyTitle}` : ""}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {j.serviceName || "Service"} • {formatDate(j.scheduledDate)} • {formatTimeSlot(j.scheduledTimeSlot)}
                        {j.crewSize > 1 ? ` • crew of ${j.crewSize}` : ""}
                      </div>
                    </div>
                    <JobStatusBadge status={j.status} size="sm" />
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StaffDirectory({
  entries,
  loading,
  error,
  onRetry,
}: {
  entries: StaffDirectoryEntry[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.phone.includes(q)
    );
  }, [entries, query]);

  const selected = entries?.find((e) => e.id === selectedId) || null;

  // Roster summary — derived entirely from the loaded data.
  const summary = useMemo(() => {
    if (!entries) return null;
    return {
      total: entries.length,
      active: entries.filter((e) => e.active).length,
      onJob: entries.filter((e) => e.stats.activeJobs > 0).length,
      rework: entries.reduce((sum, e) => sum + e.stats.openReworkTasks, 0),
    };
  }, [entries]);

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile icon={Briefcase} label="Field Workers" value={summary.total} tint="text-slate-500" />
          <StatTile icon={UserCheck} label="Active Accounts" value={summary.active} tint="text-emerald-600" />
          <StatTile icon={ShieldCheck} label="Currently on a Job" value={summary.onJob} tint="text-blue-600" />
          <StatTile icon={RotateCcw} label="Open Rework Tasks" value={summary.rework} tint="text-red-600" />
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-semibold text-slate-900">
              Field Staff Roster ({filtered.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click a worker&apos;s name to open their full file — contact, workload, QC rework and job history.
            </p>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, email…"
              className="h-8 pl-8 pr-3 rounded-md border border-slate-200 text-xs bg-white w-56 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
        </div>

        {error && (
          <div className="m-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-7 text-[11px]">
              Retry
            </Button>
          </div>
        )}

        {loading && !entries ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-300" />
            Loading field staff directory…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            {entries?.length === 0
              ? "No field staff accounts exist yet — create them under Users & Roles."
              : "No workers match your search."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((e) => (
              <div
                key={e.id}
                className="p-3.5 flex items-center gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div
                  className={`h-9 w-9 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${
                    e.active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {e.name.substring(0, 2).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className="font-semibold text-slate-900 text-sm hover:text-indigo-700 hover:underline focus:outline-none focus:underline"
                  >
                    {e.name}
                  </button>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{e.phone || "—"}</span>
                    <span className="text-slate-300">•</span>
                    <span className="truncate">{e.email}</span>
                  </div>
                </div>

                <div className="hidden sm:flex items-center gap-4 text-[11px] text-slate-500 shrink-0">
                  <span className="text-center">
                    <span className="block font-semibold text-slate-800 text-xs">{e.stats.activeJobs}</span>
                    active
                  </span>
                  <span className="text-center">
                    <span className="block font-semibold text-slate-800 text-xs">{e.stats.completedJobs}</span>
                    done
                  </span>
                  <span className="text-center">
                    <span className={`block font-semibold text-xs ${e.stats.openReworkTasks > 0 ? "text-red-600" : "text-slate-800"}`}>
                      {e.stats.openReworkTasks}
                    </span>
                    rework
                  </span>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                    e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {e.active ? "Active" : "Disabled"}
                </span>

                <button
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  title="Open full details"
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <StaffDetailDialog entry={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
