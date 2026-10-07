"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, toLocalDateString, toLocalDateOffset, format24hTo12h, formatTimeSlot } from "@/lib/utils";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Users,
  Plus,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function CalendarPage() {
  const { jobs, customers, properties, services, users, currentRole, systemSettings } = useApp();
  const { can } = useAuth();

  const isOps = currentRole === "ops_manager";
  const visibility = getOpsDateVisibility(new Date(), {
    nextDayDispatchTime: systemSettings.nextDayDispatchTime || "20:00",
  });
  const visibleJobs = isOps ? filterJobsForOpsManager(jobs, visibility) : jobs;

  // Clamp the selected day into the permitted window (e.g. after the window
  // shrinks back at midnight, a previously-selected future date falls back to
  // the latest permitted day).
  const [rawSelectedDay, setSelectedDay] = useState(toLocalDateString());
  const selectedDay = isOps && rawSelectedDay > visibility.maxVisibleDate
    ? visibility.maxVisibleDate
    : rawSelectedDay;

  // Dynamic rolling 7-day window: 2 days back through 4 days ahead, always
  // centered on today regardless of when the app is running. For Ops Managers,
  // dates outside the dispatch visibility window are simply not shown at all
  // (no locked chips, no messaging) — the strip just ends at the window edge.
  const DATES = [-2, -1, 0, 1, 2, 3, 4]
    .map((offset) => {
      const dateStr = toLocalDateOffset(offset);
      const labelDate = new Date(dateStr + "T00:00:00");
      const weekday = labelDate.toLocaleDateString("en-US", { weekday: "short" });
      const monthDay = labelDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        date: dateStr,
        label: offset === 0 ? `Today, ${monthDay}` : `${weekday}, ${monthDay}`,
        permitted: !isOps || visibility.isDateVisible(dateStr),
      };
    })
    .filter((d) => d.permitted);

  const TIME_SLOTS = [
    "07:00 AM - 01:00 PM",
    "08:00 AM - 01:30 PM",
    "09:00 AM - 03:30 PM",
    "10:30 AM - 03:00 PM",
    "02:00 PM - 05:30 PM",
  ];

  const dayJobs = visibleJobs.filter((j) => j.scheduledDate === selectedDay);

  return (
    <AdminLayout>
      <PageHeader
        title="Operations Schedule & Field Dispatch Board"
        description="Daily booking slots, assigned field workers, property handover commitments, and capacity planning."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Calendar Dispatch" },
        ]}
        actions={
          !isOps ? (
            <Link href="/jobs?create=true">
              <Button size="sm" className="h-9 gap-1.5 bg-rose-500 text-white font-medium">
                <Plus className="h-4 w-4" />
                Schedule Appointment
              </Button>
            </Link>
          ) : undefined
        }
      />

      {/* Week Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 mb-6 shadow-xs flex items-center justify-between gap-2 overflow-x-auto">
        {DATES.map((d) => {
          const count = visibleJobs.filter((j) => j.scheduledDate === d.date).length;
          const isSelected = selectedDay === d.date;

          return (
            <button
              key={d.date}
              onClick={() => setSelectedDay(d.date)}
              className={`flex-1 min-w-[120px] p-2.5 rounded-md text-center transition-all ${
                isSelected
                  ? "bg-slate-900 text-white shadow-xs font-semibold"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-700"
              }`}
            >
              <div className="text-xs">{d.label}</div>
              <div className={`text-[10px] mt-0.5 ${isSelected ? "text-slate-300" : "text-slate-400"}`}>
                {count} {count === 1 ? "Job" : "Jobs"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Daily Schedule Slots */}
      <div className="space-y-4">
        {dayJobs.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-400">
            <CalendarIcon className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-semibold text-slate-700">No jobs scheduled for {selectedDay}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Click 'Schedule Appointment' to dispatch field workers.</p>
          </div>
        ) : (
          dayJobs.map((job) => {
            const customer = customers.find((c) => c.id === job.customerId);
            const property = properties.find((p) => p.id === job.propertyId);
            const service = services.find((s) => s.id === job.serviceId);
            // Server-resolved names first (ops managers cannot read the user directory).
            const assignedWorkers =
              job.assignedStaffNames ??
              ((job.assignedStaffIds || [])
                .map((id) => users.find((u) => u.id === id)?.name)
                .filter(Boolean) as string[]);

            return (
              <div
                key={job.id}
                className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {job.id}
                    </span>
                    <JobStatusBadge status={job.status} size="sm" />
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeSlot(job.scheduledTimeSlot)}
                    </span>
                  </div>

                  <div className="font-semibold text-slate-900 text-sm">
                    {customer?.name} • <span className="text-slate-600 font-normal">{service?.name}</span>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    <span>{property?.title} — {property?.address}</span>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center gap-2 pt-1">
                    <span className="font-semibold text-slate-800">
                      Workers: {assignedWorkers.length > 0 ? assignedWorkers.join(", ") : "Unassigned"}
                    </span>
                    {can("finance.view") && (
                      <span>• Value: <strong>{formatCurrency(job.amount ?? 0)}</strong></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/jobs/${job.id}`}>
                    <Button variant="outline" size="sm" className="h-8 text-xs">
                      View File
                    </Button>
                  </Link>
                  <Link href="/field">
                    <Button size="sm" className="h-8 text-xs bg-rose-500 text-white">
                      Field Portal
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AdminLayout>
  );
}
