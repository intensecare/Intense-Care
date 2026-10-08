"use client";

import React, { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { SkeletonList } from "@/components/ui/states";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { formatDate, formatTimeSlot } from "@/lib/utils";
import {
  Search,
  Plus,
  Briefcase,
  X,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { JobQrButton } from "@/components/common/JobQr";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";

function JobsPageInner() {
  const {
    jobs,
    customers,
    properties,
    services,
    users,
    loading,
  } = useApp();
  const { can } = useAuth();
  const canQr = can("links.manage");

  const fieldWorkers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active);

  const searchParams = useSearchParams();

  const allJobs = jobs;

  // Deep-link support: /jobs?q=... (navbar global search) and /jobs/new
  // ("New Booking" shortcut) now actually drive the page state.
  const initialSearch = searchParams.get("q") || "";
  const router = useRouter();
  // Old "/jobs/new" links open the New job page.
  useEffect(() => {
    if (searchParams.get("create") === "true") router.replace("/jobs/new");
  }, [searchParams, router]);

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("status") || "ALL");
  const [paymentFilter, setPaymentFilter] = useState<string>("ALL");
  const [workerFilter, setWorkerFilter] = useState<string>("ALL");

  // Status filter options with dynamic count
  // Plain-language stages; each stage groups the statuses it covers.
  const statusOptions = useMemo(() => [
    { value: "ALL", label: `All jobs (${allJobs.length})` },
    { value: "SCHEDULED", label: "Booked / Scheduled" },
    { value: "ASSIGNED", label: "Field Manager Assigned" },
    { value: "IN_PROGRESS", label: "Active (on site)" },
    { value: "WORK_COMPLETED", label: "QC Pending" },
    { value: "REWORK_REQUIRED", label: "Rework" },
    { value: "CUSTOMER_APPROVAL", label: "Customer Approval" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ], [allJobs.length]);

  // Worker filter options
  const workerOptions = useMemo(() => [
    { value: "ALL", label: "All Workers" },
    { value: "UNASSIGNED", label: "Unassigned" },
    ...fieldWorkers.map((w) => ({ value: w.id, label: w.name })),
  ], [fieldWorkers]);

  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      const customer = customers.find((c) => c.id === job.customerId);
      const property = properties.find((p) => p.id === job.propertyId);
      const service = services.find((s) => s.id === job.serviceId);

      const matchesSearch =
        job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (job.jobNumber ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.phone.includes(searchQuery) ||
        property?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        service?.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "ALL" || (STATUS_GROUPS[statusFilter] ?? [statusFilter]).includes(job.status);
      const matchesPayment =
        paymentFilter === "ALL" ||
        (can("finance.view") && job.paymentStatus === paymentFilter);
      const matchesWorker =
        workerFilter === "ALL" ||
        (workerFilter === "UNASSIGNED"
          ? (job.assignedStaffIds?.length || 0) === 0
          : job.assignedStaffIds?.includes(workerFilter));

      return matchesSearch && matchesStatus && matchesPayment && matchesWorker;
    });
  }, [allJobs, can, customers, properties, services, searchQuery, statusFilter, paymentFilter, workerFilter]);

  const managerName = (job: (typeof filteredJobs)[number]) =>
    (job.assignedStaffNames ?? (job.assignedStaffIds || []).map((id) => users.find((u) => u.id === id)?.name).filter(Boolean))[0] ??
    users.find((u) => u.id === job.assignedManagerId)?.name;
  const filtersOn = searchQuery || statusFilter !== "ALL" || paymentFilter !== "ALL" || workerFilter !== "ALL";

  return (
    <AdminLayout>
      <PageHeader
        title="Jobs"
        description={`${allJobs.length} job${allJobs.length === 1 ? "" : "s"} · every job keeps one Job ID from booking to feedback`}
        actions={
          can("jobs.create") ? (
            <Link href="/jobs/new" className="h-11 px-4 rounded-xl bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2 hover:bg-rose-600">
              <Plus className="h-5 w-5" aria-hidden /> New Job
            </Link>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_14rem_auto] gap-3">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input type="search" placeholder="Search job ID, customer, phone" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" aria-label="Search jobs" />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <SearchableSelect value={statusFilter} onChange={setStatusFilter} options={statusOptions} placeholder="All statuses" className="h-11" />
          <SearchableSelect value={workerFilter} onChange={setWorkerFilter} options={workerOptions} placeholder="All Field Managers" className="h-11" />
          {can("finance.view") && (
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} aria-label="Payment" className="h-11 rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-800">
              <option value="ALL">All payments</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIAL">Part paid</option>
              <option value="PAID">Paid</option>
            </select>
          )}
        </div>
        {filtersOn && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-zinc-500">{filteredJobs.length} of {allJobs.length} jobs</span>
            <button onClick={() => { setSearchQuery(""); setStatusFilter("ALL"); setPaymentFilter("ALL"); setWorkerFilter("ALL"); }} className="font-semibold text-rose-600">Clear filters</button>
          </div>
        )}
      </div>

      {loading && allJobs.length === 0 ? (
        <SkeletonList rows={4} />
      ) : allJobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Create the first job to start the workflow." actionLabel={can("jobs.create") ? "Create job" : undefined} onAction={() => router.push("/jobs/new")} />
      ) : filteredJobs.length === 0 ? (
        <EmptyState icon={Search} title="No matching jobs" description="Try a different search or clear the filters." />
      ) : (
        <>
          {/* Desktop: clean data table */}
          <div className="hidden xl:block rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th scope="col" className="py-3 px-5 font-semibold">Job</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Customer</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Service</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Manager</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Date</th>
                  <th scope="col" className="py-3 px-4 font-semibold">Status</th>
                  <th scope="col" className="py-3 px-5 font-semibold text-right"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredJobs.map((job) => {
                  const customer = customers.find((c) => c.id === job.customerId);
                  const service = services.find((s) => s.id === job.serviceId);
                  const manager = managerName(job);
                  return (
                    <tr key={job.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="py-3.5 px-5 font-semibold text-zinc-950 font-mono text-xs break-all max-w-[11rem]">{job.jobNumber ?? job.id.slice(-6)}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-zinc-950">{customer?.name ?? "Customer"}</div>
                        <div className="text-xs text-zinc-500">{customer?.phone}</div>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-800">{service?.name}</td>
                      <td className="py-3.5 px-4">{manager ? <span className="text-zinc-800">{manager}</span> : <span className="text-amber-700 font-medium">Not assigned</span>}</td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-zinc-900">{formatDate(job.scheduledDate)}</div>
                        <div className="text-xs text-zinc-500">{formatTimeSlot(job.scheduledTimeSlot).split(" - ")[0]}</div>
                      </td>
                      <td className="py-3.5 px-4"><StatusBadge status={job.status} size="sm" /></td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center gap-2">
                          {canQr && job.status !== "CANCELLED" && <JobQrButton compact jobId={job.id} jobNumber={job.jobNumber} customerName={customer?.name} />}
                          <Link href={`/jobs/${job.id}`} className="inline-flex h-10 items-center gap-1 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
                            Open <ChevronRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones / tablets: one card per job */}
          <ul className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredJobs.map((job) => {
              const customer = customers.find((c) => c.id === job.customerId);
              const service = services.find((s) => s.id === job.serviceId);
              const manager = managerName(job);
              return (
                <li key={job.id} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                  <Link href={`/jobs/${job.id}`} className="block p-4 active:bg-zinc-50">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-500 font-mono break-all min-w-0">{job.jobNumber ?? job.id.slice(-6)}</span>
                      <StatusBadge status={job.status} size="sm" />
                    </div>
                    <div className="mt-2 text-base font-semibold text-zinc-950">{service?.name ?? "Service"}</div>
                    <div className="text-base text-zinc-800">{customer?.name ?? "Customer"}</div>
                    <div className="text-sm text-zinc-500 mt-0.5">{job.scheduledDate === new Date().toISOString().slice(0, 10) ? "Today" : formatDate(job.scheduledDate)} · {formatTimeSlot(job.scheduledTimeSlot).split(" - ")[0]}</div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3">
                      <span className="text-sm">
                        <span className="text-zinc-500">Manager: </span>
                        {manager ? <span className="font-medium text-zinc-900">{manager}</span> : <span className="font-medium text-amber-700">Not assigned</span>}
                      </span>
                      <span className="text-sm font-semibold text-rose-600 inline-flex items-center gap-0.5">Open <ChevronRight className="h-4 w-4" aria-hidden /></span>
                    </div>
                  </Link>
                  {canQr && job.status !== "CANCELLED" && (
                    <div className="px-4 pb-4 -mt-1">
                      <JobQrButton jobId={job.id} jobNumber={job.jobNumber} customerName={customer?.name} size="sm" className="w-full" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

    </AdminLayout>
  );
}

/**
 * useSearchParams() requires a Suspense boundary during static prerendering,
 * so the page body is wrapped before being exported as the route entry.
 */
const STATUS_GROUPS: Record<string, string[]> = {
  SCHEDULED: ["DRAFT", "SCHEDULED"],
  ASSIGNED: ["ASSIGNED"],
  IN_PROGRESS: ["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"],
  WORK_COMPLETED: ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"],
  REWORK_REQUIRED: ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"],
  CUSTOMER_APPROVAL: ["PASS", "CUSTOMER_APPROVAL"],
  COMPLETED: ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"],
  CANCELLED: ["CANCELLED"],
};

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <JobsPageInner />
    </Suspense>
  );
}
