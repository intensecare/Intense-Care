"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { toLocalDateString, toLocalDateOffset, formatTimeSlot, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Plus, UserPlus, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };

/**
 * Admin — "Schedule": a day strip + scheduling board.
 *   New booking → check availability → pick date/time → assign team →
 *   confirm → calendar sync (server) → customer notification (server).
 * Rescheduling is inline and fast; assignment opens the job file's crew picker.
 */
export default function SchedulePage() {
  const { jobs, users, refreshJobs } = useApp();
  const { can } = useAuth();
  const visibleJobs = jobs as DeskJob[];

  const [day, setDay] = useState(toLocalDateString());
  const [editing, setEditing] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newSlot, setNewSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const days = useMemo(
    () =>
      [-1, 0, 1, 2, 3, 4, 5, 6].map((offset) => {
        const date = toLocalDateOffset(offset);
        const d = new Date(date + "T00:00:00");
        return {
          date,
          label: offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
          locked: false,
        };
      }),
    []
  );

  const dayJobs = visibleJobs
    .filter((j) => j.scheduledDate === day && !["CANCELLED", "CLOSED"].includes(j.status))
    .sort((a, b) => a.scheduledTimeSlot.localeCompare(b.scheduledTimeSlot));
  const unassigned = dayJobs.filter((j) => j.assignedStaffIds.length === 0 && !j.assignedManagerId);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name;

  const startReschedule = (j: DeskJob) => {
    setEditing(j.id);
    setNewDate(j.scheduledDate);
    setNewSlot(j.scheduledTimeSlot);
    setMessage(null);
  };

  const saveReschedule = async (id: string) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: newDate, scheduledTimeSlot: newSlot }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !json?.success) {
      setMessage(json?.error || "Could not reschedule.");
      return;
    }
    setEditing(null);
    setMessage("Rescheduled. Calendar and customer notification are updated by the server.");
    await refreshJobs();
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Schedule"
        description="Pick a day to see its jobs, assign a Field Manager or reschedule."
        actions={
          can("jobs.create") ? (
            <Link href="/jobs/new">
              <Button>
                <Plus className="h-5 w-5" aria-hidden /> New Job
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {days.map((d) => (
          <button
            key={d.date}
            disabled={d.locked}
            onClick={() => setDay(d.date)}
            className={cn(
              "px-4 h-11 rounded-xl text-sm font-semibold whitespace-nowrap border shrink-0",
              day === d.date ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50",
              d.locked && "opacity-40 cursor-not-allowed"
            )}
          >
            {d.label}
            <span className="ml-1.5 text-xs opacity-70">{visibleJobs.filter((j) => j.scheduledDate === d.date && !["CANCELLED", "CLOSED"].includes(j.status)).length}</span>
          </button>
        ))}
      </div>

      {message && <div role="status" className="mb-3 text-sm rounded-xl border px-3 py-2 bg-zinc-50 border-zinc-200 text-zinc-700">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-zinc-400" /> {day === toLocalDateString() ? "Today" : day}
            </h3>
            <span className="text-xs text-zinc-500">{dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}</span>
          </div>
          {dayJobs.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-zinc-500">No jobs on this day.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {dayJobs.map((j) => {
                const crew = [j.assignedManagerId, ...j.assignedStaffIds].filter((x): x is string => Boolean(x));
                const crewNames = (j.assignedStaffNames && j.assignedStaffNames.length ? j.assignedStaffNames : crew.map((id) => nameOf(id)).filter(Boolean)) as string[];
                const unassignedJob = crew.length === 0;
                return (
                  <li key={j.id} className={cn("px-4 sm:px-5 py-4", unassignedJob && "bg-amber-50/50")}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <Link href={`/jobs/${j.id}`} className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="w-16 shrink-0 text-sm font-semibold text-zinc-950 pt-0.5">{formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-zinc-950 truncate">{j.customerName ?? "Customer"}</span>
                          <span className="block text-sm text-zinc-500 truncate">{j.service?.name} · {j.jobNumber}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-2">
                            <JobStatusBadge status={j.status} size="sm" />
                            {unassignedJob ? (
                              <span className="inline-flex items-center gap-1 text-sm text-amber-800 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden /> No Field Manager</span>
                            ) : (
                              <span className="text-sm text-zinc-700">{crewNames.length ? crewNames.join(", ") : `${crew.length} assigned`}</span>
                            )}
                          </span>
                        </span>
                      </Link>
                      <div className="flex items-center gap-2 sm:shrink-0 pl-[4.75rem] sm:pl-0">
                        {can("jobs.assign") && unassignedJob && (
                          <Link href={`/jobs/${j.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-500 px-3 text-sm font-semibold text-white">
                            <UserPlus className="h-4 w-4" aria-hidden /> Assign
                          </Link>
                        )}
                        {can("jobs.reschedule") && !["IN_PROGRESS", "WORK_COMPLETED", "COMPLETED", "FEEDBACK_REQUESTED"].includes(j.status) && (
                          <Button size="sm" variant="outline" onClick={() => (editing === j.id ? setEditing(null) : startReschedule(j))}>
                            Reschedule
                          </Button>
                        )}
                      </div>
                    </div>
                    {editing === j.id && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[auto_auto_auto_auto] sm:items-end gap-3 rounded-xl bg-zinc-50 p-3">
                        <label className="block text-sm font-medium text-zinc-800">Date
                          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1.5" />
                        </label>
                        <label className="block text-sm font-medium text-zinc-800">Time window
                          <Input value={newSlot} onChange={(e) => setNewSlot(e.target.value)} placeholder="09:00 - 13:00" className="mt-1.5" />
                        </label>
                        <Button size="sm" disabled={busy} className="text-white" onClick={() => saveReschedule(j.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h3 className="text-base font-semibold text-zinc-900 mb-3">Needs a Field Manager</h3>
            {unassigned.length === 0 ? (
              <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every job on this day has a Field Manager.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {unassigned.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}`} className="flex items-center justify-between text-xs rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 hover:bg-amber-100">
                      <span className="truncate">{formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]} · {j.customerName}</span>
                      <span className="font-semibold text-amber-800">Assign</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-zinc-900 mb-2">Field Manager availability</h3>
            <ul className="space-y-1.5 text-xs">
              {users
                .filter((u) => u.role === "field_manager" && u.active)
                .map((u) => {
                  const busyNow = dayJobs.some((j) => j.assignedStaffIds.includes(u.id) || j.assignedManagerId === u.id);
                  return (
                    <li key={u.id} className="flex items-center justify-between">
                      <span className="text-zinc-800">
                        {u.name}
                      </span>
                      <span className={cn("px-1.5 py-0.5 rounded border text-xs font-semibold", busyNow ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>
                        {busyNow ? "Booked" : "Free"}
                      </span>
                    </li>
                  );
                })}
              {users.filter((u) => u.role === "field_manager").length === 0 && <li className="text-zinc-400">No Field Managers yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
