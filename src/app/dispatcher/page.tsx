"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { formatDate, formatTimeSlot } from "@/lib/utils";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import {
  MapPin,
  Clock,
  Phone,
  CheckCircle2,
  AlertTriangle,
  Users,
  UserCheck,
  Ban,
  CalendarDays,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Dispatch tower (ops_manager + super_admin).
 *
 * Assignment now reflects the real server state:
 *  - staff roster comes from GET /api/users/staff-directory (assignment scope),
 *  - availability = active worker AND not already booked on another job in the
 *    same local date + overlapping time slot (conflict check, DB-derived),
 *  - each job shows the count currently assigned, the lead worker (first
 *    assigned = OTP holder), and supports adding/removing individual workers,
 *  - every change writes through PATCH /api/jobs/[id] and re-syncs from the
 *    server response, so the UI can never drift from the database.
 */
export default function DispatcherPage() {
  const {
    jobs,
    customers,
    properties,
    services,
    users,
    assignStaffToJob,
    fetchStaffDirectory,
    currentRole,
    systemSettings,
  } = useApp();

  const isOps = currentRole === "ops_manager";
  const visibility = getOpsDateVisibility(new Date(), {
    nextDayDispatchTime: systemSettings.nextDayDispatchTime || "20:00",
  });
  const visibleJobs = isOps ? filterJobsForOpsManager(jobs, visibility) : jobs;

  const todayStr = visibility.today;
  const tomorrowStr = visibility.tomorrow;

  // Tomorrow's Jobs Queue: jobs scheduled for TOMORROW (or undated) still
  // needing workers — SCHEDULED/DRAFT — plus partially-assigned jobs.
  const tomorrowsJobs = visibleJobs.filter(
    (j) =>
      (j.scheduledDate === tomorrowStr || !j.scheduledDate) &&
      (j.status === "SCHEDULED" || j.status === "ASSIGNED" || j.status === "DRAFT")
  );

  // Today's Active Execution jobs
  const activeJobs = visibleJobs.filter(
    (j) =>
      j.scheduledDate === todayStr ||
      j.status === "ARRIVED" ||
      j.status === "CUSTOMER_VERIFIED" ||
      j.status === "IN_PROGRESS" ||
      j.status === "REWORK_REQUIRED" ||
      j.status === "REWORK_COMPLETED" ||
      j.status === "REINSPECTION"
  );

  // Hidden future jobs count — ops sees only the number, never the jobs.
  const hiddenFutureCount = isOps
    ? jobs.filter((j) => !visibility.isDateVisible(j.scheduledDate)).length
    : 0;

  // Roster: prefer the assignment-scoped endpoint (ops role), fall back to the
  // full directory for super_admins already hydrated by the store.
  const staffDirectory = users.filter((u) => u.role === "staff" && u.active);

  // Ops managers cannot read the full /api/users directory; hydrate the
  // assignment-scoped roster (PUT /api/users) so worker names/phones resolve
  // across the tower without clobbering already-hydrated users.
  React.useEffect(() => {
    if (staffDirectory.length === 0) void fetchStaffDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [assignmentBusy, setAssignmentBusy] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<Record<string, string | null>>({});

  /** Workers booked on any OTHER active job with the same date + slot. */
  const conflictingStaffIds = (job: (typeof jobs)[number]): Set<string> => {
    const busy = new Set<string>();
    for (const other of jobs) {
      if (other.id === job.id) continue;
      if (other.scheduledDate !== job.scheduledDate) continue;
      if (other.scheduledTimeSlot !== job.scheduledTimeSlot) continue;
      const terminal = other.status === "COMPLETED" || other.status === "CANCELLED" || other.status === "CLOSED";
      if (terminal) continue;
      for (const id of other.assignedStaffIds || []) busy.add(id);
    }
    return busy;
  };

  /** Workers on any non-terminal job right now — drives the availability dots. */
  const activeStaffIds = new Set<string>();
  jobs.forEach((j) => {
    if (j.status === "COMPLETED" || j.status === "CANCELLED" || j.status === "CLOSED") return;
    j.assignedStaffIds.forEach((id) => activeStaffIds.add(id));
  });

  const handleToggleStaff = (job: (typeof jobs)[number], staffId: string) => {
    const current = job.assignedStaffIds || [];
    const alreadyAssigned = current.includes(staffId);
    const conflict = conflictingStaffIds(job).has(staffId);

    if (!alreadyAssigned && conflict) {
      setAssignmentError((p) => ({
        ...p,
        [job.id]: "That worker is already booked on another job in this date & time slot.",
      }));
      return;
    }

    const next = alreadyAssigned ? current.filter((id) => id !== staffId) : [...current, staffId];
    // Optimistic clear of any prior error; server response is authoritative.
    setAssignmentError((p) => ({ ...p, [job.id]: null }));
    void confirmAssignment(job.id, next);
  };

  const confirmAssignment = async (jobId: string, staffIds: string[]) => {
    setAssignmentBusy(jobId);
    const res = await assignStaffToJob(jobId, staffIds);
    setAssignmentBusy(null);
    if (!res.success) {
      setAssignmentError((p) => ({ ...p, [jobId]: res.message }));
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Operations Manager Dispatch Tower"
        description={`Tomorrow's dispatch queue (${tomorrowStr}), direct field-worker assignments, and real-time execution tracking.`}
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Dispatcher Queue" },
        ]}
      />

      {/* Simple dispatch note — no cutoff mechanics, just what matters */}
      <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs mb-6 flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
          <CalendarDays className="h-4 w-4 text-blue-600" />
        </div>
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-slate-900">
            Tomorrow&apos;s queue ({tomorrowStr})
          </div>
          <p className="text-[11px] text-slate-500">
            Jobs will show here as soon as they are assigned for tomorrow. Pick a job below and assign field workers directly.
          </p>
        </div>
      </div>

      {/* Dispatch KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Tomorrow&apos;s Queue ({tomorrowStr})
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">
            {tomorrowsJobs.length} Jobs
          </div>
          <div className="text-[11px] text-slate-400">
            {hiddenFutureCount > 0 ? `${hiddenFutureCount} upcoming job(s) will appear when assigned` : "Strict tomorrow focus"}
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Jobs In Execution
          </div>
          <div className="text-2xl font-semibold text-blue-700 mt-1">
            {visibleJobs.filter((j) => j.status === "IN_PROGRESS").length}
          </div>
          <div className="text-[11px] text-slate-400">Timer actively running</div>
        </div>

        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/40 shadow-xs">
          <div className="text-xs font-semibold text-amber-800">
            Arrived • Pending OTP
          </div>
          <div className="text-2xl font-semibold text-amber-900 mt-1">
            {visibleJobs.filter((j) => j.status === "ARRIVED").length}
          </div>
          <div className="text-[11px] text-amber-700 font-medium">Worker at door, verification gate</div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            QC Audit Queue
          </div>
          <div className="text-2xl font-semibold text-purple-700 mt-1">
            {visibleJobs.filter((j) => j.status === "WORK_COMPLETED" || j.status === "QUALITY_CHECK").length}
          </div>
          <div className="text-[11px] text-slate-400">Awaiting ops QC pass</div>
        </div>
      </div>

      {/* Tomorrow's Job Assignment Queue */}
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            Tomorrow&apos;s Dispatch & Staff Assignment Queue
          </h3>
        </div>

        {tomorrowsJobs.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No upcoming jobs awaiting assignment"
            description="All scheduled jobs for tomorrow have been assigned to field workers."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tomorrowsJobs.map((job) => {
              const customer = customers.find((c) => c.id === job.customerId);
              const property = properties.find((p) => p.id === job.propertyId);
              const service = services.find((s) => s.id === job.serviceId);
              const assigned = job.assignedStaffIds || [];
              const busy = conflictingStaffIds(job);
              const err = assignmentError[job.id];

              return (
                <div
                  key={job.id}
                  className="p-5 rounded-lg border border-slate-200 bg-white shadow-xs space-y-4 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900">{job.id}</span>
                      <JobStatusBadge status={job.status} size="sm" />
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{formatDate(job.scheduledDate)} ({formatTimeSlot(job.scheduledTimeSlot)})</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400">Customer & Contact</span>
                      <div className="font-semibold text-slate-900">{customer?.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{customer?.phone}</div>
                    </div>

                    <div>
                      <span className="text-[10px] font-semibold text-slate-400">Service & Duration</span>
                      <div className="font-semibold text-slate-900">{service?.name}</div>
                      <div className="text-[11px] text-slate-500">Est. {service?.estimatedDurationHours || 4} hours</div>
                    </div>
                  </div>

                  <div className="text-xs bg-slate-50 p-2.5 rounded border border-slate-100 space-y-1">
                    <div className="font-medium text-slate-800 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-zinc-400 shrink-0" />
                      {property?.title} ({property?.propertyType})
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{property?.address}</div>
                    {property?.accessNotes && (
                      <div className="text-[11px] text-amber-800 font-medium pt-0.5">
                        Note: {property.accessNotes}
                      </div>
                    )}
                  </div>

                  {/* Staff Multi-Selection with live availability */}
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-700">
                        Assign Field Workers
                      </label>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {assigned.length} assigned
                        {assigned.length > 0 && (
                          <span className="text-slate-400">
                            {" "}
                            • Lead: {job.assignedStaffNames?.[0] ?? users.find((u) => u.id === assigned[0])?.name}
                          </span>
                        )}
                      </span>
                    </div>

                    {staffDirectory.length === 0 ? (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        No active field workers exist yet. Create staff accounts in Users &amp; Roles first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {staffDirectory.map((staff) => {
                          const isSelected = assigned.includes(staff.id);
                          const isBusy = busy.has(staff.id);
                          const disabled = assignmentBusy === job.id || (isBusy && !isSelected);
                          return (
                            <button
                              key={staff.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => handleToggleStaff(job, staff.id)}
                              title={isBusy && !isSelected ? "Booked on another job in this slot" : undefined}
                              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all flex items-center gap-1.5 border ${
                                isSelected
                                  ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                                  : isBusy
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through"
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                              }`}
                            >
                              {isSelected ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              ) : isBusy ? (
                                <Ban className="h-3 w-3" />
                              ) : null}
                              <span>{staff.name}</span>
                              {isSelected && assigned[0] === staff.id && (
                                <span className="text-[9px] font-semibold text-amber-300">Lead</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {err && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {err}
                      </p>
                    )}

                    <p className="text-[10px] text-slate-400">
                      Struck-through workers are booked on another job in the same date &amp; time slot. The first
                      assigned worker is the <strong>Lead</strong> — only they receive/verify the customer OTP.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Dispatches Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Real-time Dispatch Cards */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Live Field Execution Progress ({activeJobs.length})
            </h3>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Real-time telemetry
            </span>
          </div>

          <div className="space-y-3">
            {activeJobs.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No active field dispatches right now"
                description="All field workers are currently awaiting upcoming scheduled appointments."
              />
            ) : (
              activeJobs.map((job) => {
                const customer = customers.find((c) => c.id === job.customerId);
                const property = properties.find((p) => p.id === job.propertyId);
                const service = services.find((s) => s.id === job.serviceId);
                const leadWorkerName =
                  job.assignedStaffNames?.[0] ??
                  users.find((u) => u.id === job.assignedStaffIds?.[0])?.name;

                return (
                  <div
                    key={job.id}
                    className="p-5 rounded-lg border border-slate-200 bg-white shadow-xs space-y-3 hover:border-slate-300 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900">
                          {job.id}
                        </span>
                        <JobStatusBadge status={job.status} size="sm" />
                      </div>

                      <div className="text-xs text-slate-400 font-medium">
                        {formatDate(job.scheduledDate)} • Slot: {formatTimeSlot(job.scheduledTimeSlot)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      {/* Customer */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-semibold text-slate-400">
                          Customer & Phone
                        </span>
                        <div className="font-semibold text-slate-900">{customer?.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {customer?.phone}
                        </div>
                      </div>

                      {/* Location */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-semibold text-slate-400">
                          Site Location
                        </span>
                        <div className="font-semibold text-slate-900 flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 text-zinc-400 shrink-0" />
                          {property?.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {property?.address}
                        </div>
                      </div>

                      {/* Assigned Staff */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-semibold text-slate-400">
                          Assigned Field Workers ({job.assignedStaffIds?.length || 0})
                        </span>
                        <div className="font-semibold text-slate-900">
                          {job.assignedStaffIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(", ") || "Unassigned"}
                        </div>
                        {leadWorkerName && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1">
                            <UserCheck className="h-3 w-3 text-indigo-500" />
                            Lead (OTP holder): {leadWorkerName}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <div className="text-[11px] text-slate-500">
                        Service: <strong>{service?.name}</strong>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link href={`/jobs/${job.id}`}>
                          <Button variant="outline" size="sm" className="h-8 text-xs">
                            Open Job Console
                          </Button>
                        </Link>
                        <Link href="/field">
                          <Button size="sm" className="h-8 text-xs bg-rose-500 text-white font-medium">
                            Field View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Col: Field Staff Availability */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-semibold text-slate-500">
              Field Staff Availability
            </h3>

            <div className="space-y-3">
              {staffDirectory.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  No active field workers. Add them in Users &amp; Roles.
                </p>
              ) : (
                staffDirectory.map((staff) => {
                  const activeLoad = jobs.filter(
                    (j) =>
                      (j.assignedStaffIds || []).includes(staff.id) &&
                      j.status !== "COMPLETED" &&
                      j.status !== "CANCELLED" &&
                      j.status !== "CLOSED"
                  ).length;
                  // "Booked" = currently on any non-terminal job (date-agnostic
                  // view); per-slot conflicts are shown in each job's crew picker.
                  const todaySlotBusy = activeStaffIds.has(staff.id);

                  return (
                    <div
                      key={staff.id}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-full ${todaySlotBusy ? "bg-amber-500" : "bg-emerald-500"}`} />
                          {staff.name}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          activeLoad > 0
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {activeLoad > 0 ? `On ${activeLoad} job${activeLoad === 1 ? "" : "s"}` : "Available"}
                        </span>
                      </div>

                      <div className="space-y-1 text-[11px] text-slate-600">
                        <div className="flex justify-between">
                          <span>Phone:</span>
                          <strong className="text-slate-800 font-mono">{staff.phone}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Now:</span>
                          <span className={todaySlotBusy ? "text-amber-700 font-medium" : "text-emerald-700 font-medium"}>
                            {todaySlotBusy ? "Booked" : "Free"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
