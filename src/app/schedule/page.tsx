"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { toLocalDateString, toLocalDateOffset, formatTimeSlot, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Plus, UserPlus, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };

/**
 * SCHEDULER home — "Schedule" (§7): a day strip + scheduling board.
 *   New booking → check availability → pick date/time → assign team →
 *   confirm → calendar sync (server) → customer notification (server).
 * Rescheduling is inline and fast; assignment opens the job file's crew picker.
 */
export default function SchedulePage() {
  const { jobs, users, currentRole, systemSettings, refreshJobs } = useApp();
  const { can } = useAuth();
  const visibility = getOpsDateVisibility(new Date(), { nextDayDispatchTime: systemSettings.nextDayDispatchTime || "20:00" });
  const visibleJobs = (currentRole === "ops_manager" ? filterJobsForOpsManager(jobs, visibility) : jobs) as DeskJob[];

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
          locked: currentRole === "ops_manager" && !visibility.isDateVisible(date),
        };
      }),
    [currentRole, visibility]
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
        description="Calendar + scheduling board. One row per job: time — team — job. Reschedule inline; assign from the job file."
        actions={
          can("jobs.create") ? (
            <Link href="/jobs?create=true">
              <Button size="sm" className="h-9 gap-1.5 text-xs text-white">
                <Plus className="h-3.5 w-3.5" /> New Booking
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
              "px-3 h-9 rounded-lg text-xs font-semibold whitespace-nowrap border",
              day === d.date ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50",
              d.locked && "opacity-40 cursor-not-allowed"
            )}
          >
            {d.label}
            <span className="ml-1.5 text-[10px] opacity-70">{visibleJobs.filter((j) => j.scheduledDate === d.date && !["CANCELLED", "CLOSED"].includes(j.status)).length}</span>
          </button>
        ))}
      </div>

      {message && <div className="mb-3 text-xs rounded-lg border px-3 py-2 bg-zinc-50 border-zinc-200 text-zinc-700">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-zinc-400" /> {day === toLocalDateString() ? "Today" : day}
            </h3>
            <span className="text-xs text-zinc-500">{dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}</span>
          </div>
          {dayJobs.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-zinc-500">No jobs on this day.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {dayJobs.map((j) => {
                const crew = [j.assignedManagerId, ...j.assignedStaffIds].filter((x): x is string => Boolean(x));
                const crewNames = (j.assignedStaffNames && j.assignedStaffNames.length ? j.assignedStaffNames : crew.map((id) => nameOf(id)).filter(Boolean)) as string[];
                const unassignedJob = crew.length === 0;
                return (
                  <li key={j.id} className={cn("px-4 py-3", unassignedJob && "bg-amber-50/40")}>
                    <div className="flex items-center gap-4">
                      <div className="w-20 shrink-0">
                        <div className="text-sm font-semibold text-zinc-900 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-zinc-400" /> {formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]}
                        </div>
                      </div>
                      <div className="w-40 shrink-0 text-xs">
                        {unassignedJob ? (
                          <span className="inline-flex items-center gap-1 text-amber-800 font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5" /> No team
                          </span>
                        ) : (
                          <span className="text-zinc-700 font-medium">{crewNames.length ? crewNames.join(", ") : `${crew.length} assigned`}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-zinc-900 hover:underline">
                          {j.id}
                        </Link>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {j.customerName} · {j.service?.name} · {j.propertyTitle}
                        </div>
                      </div>
                      <JobStatusBadge status={j.status} size="sm" />
                      <div className="flex items-center gap-1.5 shrink-0">
                        {can("jobs.assign") && unassignedJob && (
                          <Link href={`/jobs/${j.id}`}>
                            <Button size="sm" className="h-8 text-xs text-white gap-1">
                              <UserPlus className="h-3.5 w-3.5" /> Assign
                            </Button>
                          </Link>
                        )}
                        {can("jobs.reschedule") && !["IN_PROGRESS", "WORK_COMPLETED", "COMPLETED"].includes(j.status) && (
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => (editing === j.id ? setEditing(null) : startReschedule(j))}>
                            Reschedule
                          </Button>
                        )}
                      </div>
                    </div>
                    {editing === j.id && (
                      <div className="mt-3 flex flex-wrap items-end gap-2 text-xs">
                        <div>
                          <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Date</label>
                          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-9 w-40 text-xs" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Time window (HH:MM - HH:MM)</label>
                          <Input value={newSlot} onChange={(e) => setNewSlot(e.target.value)} placeholder="09:00 - 13:00" className="h-9 w-44 text-xs" />
                        </div>
                        <Button size="sm" disabled={busy} className="h-9 text-xs text-white" onClick={() => saveReschedule(j.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setEditing(null)}>
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
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-zinc-900 mb-2">Needs a team</h3>
            {unassigned.length === 0 ? (
              <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every job on this day has a crew.
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
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-zinc-900 mb-2">Crew availability</h3>
            <ul className="space-y-1.5 text-xs">
              {users
                .filter((u) => (u.role === "field_manager" || u.role === "field_staff") && u.active)
                .map((u) => {
                  const busyNow = dayJobs.some((j) => j.assignedStaffIds.includes(u.id) || j.assignedManagerId === u.id);
                  return (
                    <li key={u.id} className="flex items-center justify-between">
                      <span className="text-zinc-800">
                        {u.name} <span className="text-zinc-400">· {u.role === "field_manager" ? "Lead" : "Staff"}</span>
                      </span>
                      <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-semibold", busyNow ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>
                        {busyNow ? "Booked" : "Free"}
                      </span>
                    </li>
                  );
                })}
              {users.filter((u) => u.role === "field_manager" || u.role === "field_staff").length === 0 && <li className="text-zinc-400">No field accounts yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
