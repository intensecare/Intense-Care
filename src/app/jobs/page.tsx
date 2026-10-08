"use client";

import React, { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { SkeletonList } from "@/components/ui/states";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { formatCurrency, formatDate, toLocalDateOffset, formatTimeSlot } from "@/lib/utils";
import { JobStatus } from "@/lib/types";
import { onDutyWorkerIds } from "@/lib/staff-availability";
import {
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  Calendar,
  Clock,
  ShieldCheck,
  Smartphone,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  UserPlus,
  Building2,
  X,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function JobsPageInner() {
  const {
    jobs,
    customers,
    properties,
    services,
    users,
    createJob,
    createCustomer,
    createProperty,
    loading,
  } = useApp();
  const { can } = useAuth();

  const fieldWorkers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active);

  const searchParams = useSearchParams();

  const allJobs = jobs;

  // Deep-link support: /jobs?q=... (navbar global search) and /jobs?create=true
  // ("New Booking" shortcut) now actually drive the page state.
  const initialSearch = searchParams.get("q") || "";
  const createParam = searchParams.get("create");

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

  // Service selection options
  const serviceOptions = useMemo(() =>
    services.map((s) => ({
      value: s.id,
      label: `${s.name} (${formatCurrency(s.basePrice)} • ~${s.estimatedDurationHours} hrs)`,
    })),
  [services]);

  // Customer selection options
  const customerOptions = useMemo(() =>
    customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` })),
  [customers]);

  const [isCreateOpen, setIsCreateOpen] = useState(createParam === "true");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Job Form State
  const [isInlineCustomer, setIsInlineCustomer] = useState(customers.length === 0);
  const [inlineName, setInlineName] = useState("");
  const [inlinePhone, setInlinePhone] = useState("");
  const [inlineEmail, setInlineEmail] = useState("");
  const [inlineAddress, setInlineAddress] = useState("");

  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || "");
  const [selectedPropertyId, setSelectedPropertyId] = useState(properties[0]?.id || "");
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id || "");
  const [scheduledDate, setScheduledDate] = useState(toLocalDateOffset(1)); // default: tomorrow
  // Free time window: the ops desk sets any start/end times (manual, not a
  // fixed preset). Both compose into the canonical scheduledTimeSlot string
  // ("HH:MM - HH:MM", 24h) stored on the job and shown everywhere.
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("13:30");
  const composedTimeSlot = `${timeFrom} - ${timeTo}`;
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([]);

  // Availability preview for the booking form: workers on ANY non-terminal job
  // right now are "on duty"; those on another job with THIS date+slot are
  // "already assigned" (the server would 409 the booking). The create call
  // re-validates server-side either way.
  const onDutyIds = useMemo(() => onDutyWorkerIds(jobs), [jobs]);
  const slotConflictIds = useMemo(() => {
    const busy = new Set<string>();
    for (const j of jobs) {
      if (j.scheduledDate !== scheduledDate) continue;
      if (j.scheduledTimeSlot !== composedTimeSlot) continue;
      if (j.status === "COMPLETED" || j.status === "CANCELLED" || j.status === "CLOSED") continue;
      for (const id of j.assignedStaffIds || []) busy.add(id);
    }
    return busy;
  }, [jobs, scheduledDate, composedTimeSlot]);
  const [jobNotes, setJobNotes] = useState("");

  // Customer properties filter
  const customerProperties = useMemo(() => {
    return properties.filter((p) => p.customerId === selectedCustomerId);
  }, [properties, selectedCustomerId]);

  // Property selection options (filtered by selected customer)
  const propertyOptions = useMemo(() =>
    customerProperties.map((p) => ({ value: p.id, label: `${p.title} - ${p.address}` })),
  [customerProperties]);

  // Filtered Jobs
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

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    let targetCustId = selectedCustomerId;
    let targetPropId = selectedPropertyId;

    try {
      if (isInlineCustomer || customers.length === 0) {
        if (!inlineName || !inlinePhone || !inlineAddress) {
          setFormError("Please enter customer name, phone number, and property address.");
          setIsSubmitting(false);
          return;
        }
        const custResult = await createCustomer({
          name: inlineName,
          phone: inlinePhone,
          email: inlineEmail,
          address: inlineAddress,
        });
        if (!custResult.success || !custResult.customer) {
          setFormError(custResult.message);
          setIsSubmitting(false);
          return;
        }
        targetCustId = custResult.customer.id;

        const propResult = await createProperty({
          customerId: targetCustId,
          title: `${inlineName}'s Residence`,
          address: inlineAddress,
        });
        if (!propResult.success || !propResult.property) {
          setFormError(propResult.message);
          setIsSubmitting(false);
          return;
        }
        targetPropId = propResult.property.id;
      } else {
        if (!targetCustId) {
          setFormError("Please select a customer.");
          setIsSubmitting(false);
          return;
        }
        if (!targetPropId) {
          setFormError("Please select a property location for the selected customer.");
          setIsSubmitting(false);
          return;
        }
      }

      const targetService = selectedServiceId || services[0]?.id;
      if (!targetService || !selectedServiceId) {
        setFormError("Please select a service package.");
        setIsSubmitting(false);
        return;
      }

      if (!timeFrom || !timeTo) {
        setFormError("Please set both the start and end time of the service window.");
        setIsSubmitting(false);
        return;
      }
      if (timeFrom >= timeTo) {
        setFormError("The end time must be after the start time.");
        setIsSubmitting(false);
        return;
      }

      const result = await createJob({
        customerId: targetCustId,
        propertyId: targetPropId,
        serviceId: targetService,
        scheduledDate,
        scheduledTimeSlot: composedTimeSlot,
        assignedStaffIds,
        notes: jobNotes,
        referralPartnerId: undefined,
      });

      if (!result.success) {
        setFormError(result.message);
        setIsSubmitting(false);
        return;
      }

      setIsCreateOpen(false);
      setFormError(null);
      setJobNotes("");
      setInlineName("");
      setInlinePhone("");
      setInlineAddress("");
      setAssignedStaffIds([]);
      setIsSubmitting(false);
    } catch {
      setFormError("Something went wrong while saving the booking. Please retry.");
      setIsSubmitting(false);
    }
  };

  const openCreate = () => {
    setFormError(null);
    setIsInlineCustomer(customers.length === 0);
    setIsCreateOpen(true);
  };
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
            <Button onClick={openCreate}>
              <Plus className="h-5 w-5" aria-hidden /> New Job
            </Button>
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
        <EmptyState icon={Briefcase} title="No jobs yet" description="Create the first job to start the workflow." actionLabel={can("jobs.create") ? "Create job" : undefined} onAction={openCreate} />
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
                      <td className="py-3.5 px-5 font-semibold text-zinc-950 whitespace-nowrap">{job.jobNumber ?? job.id.slice(-6)}</td>
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
                        <Link href={`/jobs/${job.id}`} className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
                          Open <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
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
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="block rounded-2xl border border-zinc-200 bg-white p-4 active:bg-zinc-50">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-500">{job.jobNumber ?? job.id.slice(-6)}</span>
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
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* New Booking Wizard Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
            <DialogDescription>
              Pick the customer, service and time. The checklist and the customer link are created automatically.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateJob} className="space-y-5">
            {formError && (
              <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
                {formError}
              </div>
            )}
            {/* Customer Mode Selection */}
            {customers.length > 0 && (
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-sm font-medium text-zinc-800">Customer</span>
                <button
                  type="button"
                  onClick={() => setIsInlineCustomer(!isInlineCustomer)}
                  className="h-10 px-2 text-sm text-rose-600 font-semibold flex items-center gap-1"
                >
                  {isInlineCustomer ? "Choose existing customer" : "+ New customer"}
                </button>
              </div>
            )}

            {isInlineCustomer || customers.length === 0 ? (
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 space-y-4">
                <div className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5 text-blue-600" />
                  New customer and property
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-zinc-800">Customer name *</label>
                    <Input
                      value={inlineName}
                      onChange={(e) => setInlineName(e.target.value)}
                      placeholder="E.g., Dr. Ananya Sen"
                      required
                      className="text-xs bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-zinc-800">Phone *</label>
                    <Input
                      value={inlinePhone}
                      onChange={(e) => setInlinePhone(e.target.value)}
                      placeholder="+91 98860 12345"
                      required
                      className="text-xs bg-white font-mono"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-sm font-medium text-zinc-800">Property address *</label>
                    <Input
                      value={inlineAddress}
                      onChange={(e) => setInlineAddress(e.target.value)}
                      placeholder="E.g., Flat 402, Prestige Golfshire, Bengaluru"
                      required
                      className="text-xs bg-white"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Customer Selection */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-800">
                    Customer *
                  </label>
                  <SearchableSelect
                    value={selectedCustomerId}
                    onChange={(value) => {
                      setSelectedCustomerId(value);
                      const matchProp = properties.find((p) => p.customerId === value);
                      if (matchProp) setSelectedPropertyId(matchProp.id);
                    }}
                    options={customerOptions}
                    placeholder="Search customer by name or phone..."
                    required
                    name="customerId"
                  />
                </div>

                {/* Property Selection */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-800">
                    Property *
                  </label>
                  <SearchableSelect
                    value={selectedPropertyId}
                    onChange={setSelectedPropertyId}
                    options={propertyOptions}
                    placeholder="Select a property"
                    required
                    name="propertyId"
                    emptyMessage="No properties registered for this customer"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Service Selection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-800">
                  Service *
                </label>
                <SearchableSelect
                  value={selectedServiceId}
                  onChange={setSelectedServiceId}
                  options={serviceOptions}
                  placeholder="Select a service package"
                  required
                  name="serviceId"
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-800">
                  Date *
                </label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              {/* Time Window — freely settable from/to (manual, no fixed presets) */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-800">
                  Time window *
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={timeFrom}
                    onChange={(e) => setTimeFrom(e.target.value)}
                    className="text-xs flex-1"
                    required
                  />
                  <span className="text-xs text-slate-400 font-semibold shrink-0">→</span>
                  <Input
                    type="time"
                    value={timeTo}
                    onChange={(e) => setTimeTo(e.target.value)}
                    className="text-xs flex-1"
                    required
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Service window: <strong className="text-slate-600">{composedTimeSlot}</strong>
                </p>
              </div>

              {/* Field Manager assignment (optional; first pick leads) */}
              <fieldset className="space-y-2 sm:col-span-2">
                <legend className="text-sm font-medium text-zinc-800">Field Manager <span className="font-normal text-zinc-500">(optional)</span></legend>
                {fieldWorkers.length === 0 ? (
                  <p className="text-sm text-zinc-500">No Field Managers yet — add one under Users.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {fieldWorkers.map((w) => {
                      const isSelected = assignedStaffIds.includes(w.id);
                      const slotConflict = slotConflictIds.has(w.id);
                      const onDuty = onDutyIds.has(w.id);
                      const availability = slotConflict ? "Busy at this time" : onDuty ? "On another job" : "Free";
                      return (
                        <button
                          key={w.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() =>
                            setAssignedStaffIds((prev) =>
                              prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                            )
                          }
                          className={`min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors inline-flex items-center gap-2 text-left ${
                            isSelected
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              slotConflict ? "bg-red-500" : onDuty ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                          />
                          <span>
                            {w.name}
                            {isSelected && assignedStaffIds[0] === w.id && assignedStaffIds.length > 1 && " · Lead"}
                            <span className={`block text-xs ${isSelected ? "text-zinc-300" : slotConflict ? "text-red-700" : onDuty ? "text-amber-700" : "text-zinc-500"}`}>
                              {availability}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {assignedStaffIds.length === 0 && fieldWorkers.length > 0 && (
                  <p className="text-sm text-zinc-500">You can assign someone later from the Schedule.</p>
                )}
              </fieldset>
            </div>

            <Field label="Notes for the team" htmlFor="nj-notes" hint="Access, focus areas, anything the Field Manager should know">
              <textarea
                id="nj-notes"
                value={jobNotes}
                onChange={(e) => setJobNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Focus on kitchen grease and master bath limescale"
                className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create job"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
