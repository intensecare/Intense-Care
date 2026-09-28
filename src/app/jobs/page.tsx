"use client";

import React, { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { JobStatusBadge, PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, toLocalDateOffset, formatTimeSlot } from "@/lib/utils";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { JobStatus } from "@/lib/types";
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
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    partners,
    createJob,
    createCustomer,
    createProperty,
    currentRole,
    systemSettings,
  } = useApp();

  const fieldWorkers = users.filter((u) => u.role === "staff" && u.active);

  const searchParams = useSearchParams();

  // Ops Managers operate inside the dispatch visibility window (past + today
  // + tomorrow after the 8 PM cutoff). Enforced here for display consistency;
  // the API enforces it authoritatively.
  const isOps = currentRole === "ops_manager";
  const opsVisibility = getOpsDateVisibility(new Date(), {
    nextDayDispatchTime: systemSettings.nextDayDispatchTime || "20:00",
  });
  const allJobs = isOps ? filterJobsForOpsManager(jobs, opsVisibility) : jobs;

  // Deep-link support: /jobs?q=... (navbar global search) and /jobs?create=true
  // ("New Booking" shortcut) now actually drive the page state.
  const initialSearch = searchParams.get("q") || "";
  const createParam = searchParams.get("create");

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [paymentFilter, setPaymentFilter] = useState<string>("ALL");
  const [workerFilter, setWorkerFilter] = useState<string>("ALL");
  const [isCreateOpen, setIsCreateOpen] = useState(createParam === "true");
  const [formError, setFormError] = useState<string | null>(null);

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
  const [referralPartnerId, setReferralPartnerId] = useState("");
  const [jobNotes, setJobNotes] = useState("");

  // Customer properties filter
  const customerProperties = useMemo(() => {
    return properties.filter((p) => p.customerId === selectedCustomerId);
  }, [properties, selectedCustomerId]);

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      const customer = customers.find((c) => c.id === job.customerId);
      const property = properties.find((p) => p.id === job.propertyId);
      const service = services.find((s) => s.id === job.serviceId);

      const matchesSearch =
        job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer?.phone.includes(searchQuery) ||
        property?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        service?.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "ALL" || job.status === statusFilter;
      const matchesPayment =
        paymentFilter === "ALL" ||
        (currentRole === "super_admin" && job.paymentStatus === paymentFilter);
      const matchesWorker =
        workerFilter === "ALL" ||
        (workerFilter === "UNASSIGNED"
          ? (job.assignedStaffIds?.length || 0) === 0
          : job.assignedStaffIds?.includes(workerFilter));

      return matchesSearch && matchesStatus && matchesPayment && matchesWorker;
    });
  }, [allJobs, currentRole, customers, properties, services, searchQuery, statusFilter, paymentFilter, workerFilter]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let targetCustId = selectedCustomerId;
    let targetPropId = selectedPropertyId;

    try {
      if (isInlineCustomer || customers.length === 0) {
        if (!inlineName || !inlinePhone || !inlineAddress) {
          setFormError("Please enter customer name, phone number, and property address.");
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
          return;
        }
        targetPropId = propResult.property.id;
      } else {
        if (!targetCustId || !targetPropId) {
          setFormError("Please select a customer and property location.");
          return;
        }
      }

      const targetService = selectedServiceId || services[0]?.id;
      if (!targetService) {
        setFormError("No service package available. Create one on the Services page first.");
        return;
      }

      if (!timeFrom || !timeTo) {
        setFormError("Please set both the start and end time of the service window.");
        return;
      }
      if (timeFrom >= timeTo) {
        setFormError("The end time must be after the start time.");
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
        referralPartnerId: referralPartnerId || undefined,
      });

      if (!result.success) {
        setFormError(result.message);
        return;
      }

      setIsCreateOpen(false);
      setFormError(null);
      setJobNotes("");
      setInlineName("");
      setInlinePhone("");
      setInlineAddress("");
      setAssignedStaffIds([]);
    } catch {
      setFormError("Something went wrong while saving the booking. Please retry.");
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Jobs Operational Register"
        description="Comprehensive dispatch table for deep cleaning appointments, lifecycle tracking, field-worker dispatch, and status execution."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Jobs Register" },
        ]}
        actions={
          currentRole === "super_admin" ? (
            <Button
              onClick={() => {
                setFormError(null);
                setIsInlineCustomer(customers.length === 0);
                setIsCreateOpen(true);
              }}
              size="sm"
              className="h-9 gap-1.5 bg-black hover:bg-zinc-800 text-white font-medium"
            >
              <Plus className="h-4 w-4" />
              Book New Cleaning Job
            </Button>
          ) : undefined
        }
      />

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200/90 rounded-lg p-3.5 mb-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search by Job ID, customer name, phone, address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9 bg-slate-50 border-slate-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="ALL">All Statuses ({allJobs.length})</option>
            <option value="DRAFT">Draft</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="ASSIGNED">Workers Assigned</option>
            <option value="ARRIVED">Arrived (OTP Pending)</option>
            <option value="CUSTOMER_VERIFIED">OTP Verified</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="WORK_COMPLETED">Work Completed (QC Ready)</option>
            <option value="QUALITY_CHECK">Quality Check</option>
            <option value="REWORK_REQUIRED">Rework Required</option>
            <option value="CUSTOMER_APPROVAL">Customer Approval</option>
            <option value="COMPLETED">Completed</option>
            <option value="FEEDBACK_REQUESTED">Feedback Collected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Payment Filter (super_admin only — money data is redacted for other roles) */}
          {currentRole === "super_admin" && (
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <option value="ALL">All Payments</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIAL">Partially Paid</option>
              <option value="PAID">Fully Paid</option>
            </select>
          )}

          {/* Worker Filter */}
          <select
            value={workerFilter}
            onChange={(e) => setWorkerFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="ALL">All Workers</option>
            <option value="UNASSIGNED">Unassigned</option>
            {fieldWorkers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Operational Table or Empty State */}
      {allJobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No cleaning jobs scheduled yet"
          description="Your dispatch queue is completely clean (zero dummy records). Click below to create your first customer booking and begin the operational lifecycle."
          actionLabel="Book New Cleaning Job"
          onAction={() => {
            setIsInlineCustomer(true);
            setIsCreateOpen(true);
          }}
        />
      ) : filteredJobs.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-xs text-slate-500">
          No cleaning jobs match your current search and filter criteria.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Job ID</th>
                  <th className="py-3 px-4">Customer & Contact</th>
                  <th className="py-3 px-4">Property</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Assigned Workers</th>
                  <th className="py-3 px-4">Scheduled Slot</th>
                  <th className="py-3 px-4">Workflow Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredJobs.map((job) => {
                  const customer = customers.find((c) => c.id === job.customerId);
                  const property = properties.find((p) => p.id === job.propertyId);
                  const service = services.find((s) => s.id === job.serviceId);
                  const assignedWorkers = (job.assignedStaffIds || [])
                    .map((id) => users.find((u) => u.id === id)?.name)
                    .filter(Boolean) as string[];
                  const leadWorkerName = assignedWorkers[0];

                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      {/* Job ID */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {job.id}
                        </Link>
                      </td>

                      {/* Customer */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">
                          {customer?.name || "Unknown"}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {customer?.phone}
                        </div>
                      </td>

                      {/* Property */}
                      <td className="py-3 px-4 max-w-[200px]">
                        <div className="font-medium text-slate-900 truncate">
                          {property?.title || "Property"}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {property?.city} • {property?.propertyType}
                        </div>
                      </td>

                      {/* Service */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {service?.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {service && `~${service.estimatedDurationHours} hrs`}
                        </div>
                      </td>

                      {/* Assigned Workers */}
                      <td className="py-3 px-4">
                        {assignedWorkers.length > 0 ? (
                          <div>
                            <div className="font-medium text-slate-900">
                              {assignedWorkers.join(", ")}
                            </div>
                            {leadWorkerName && (
                              <div className="text-[11px] text-slate-400">
                                Lead: {leadWorkerName}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-amber-600 font-medium">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Scheduled */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {formatDate(job.scheduledDate)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatTimeSlot(job.scheduledTimeSlot)}
                        </div>
                      </td>

                      {/* Workflow Status */}
                      <td className="py-3 px-4">
                        <JobStatusBadge status={job.status} size="sm" />
                        {job.status === "ARRIVED" && (
                          <div className="text-[10px] text-amber-700 font-bold mt-1">
                            Awaiting OTP
                          </div>
                        )}
                      </td>

                      {/* Payment (super_admin only — the API redacts money for other roles) */}
                      <td className="py-3 px-4">
                        {currentRole === "super_admin" ? (
                          <>
                            <div className="font-semibold text-slate-900">
                              {formatCurrency(job.amount ?? 0)}
                            </div>
                            <PaymentStatusBadge status={job.paymentStatus ?? "UNPAID"} />
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">Restricted</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <Link href={`/jobs/${job.id}`}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2.5 font-medium"
                          >
                            Details
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Booking Wizard Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule New Deep Cleaning Job</DialogTitle>
            <DialogDescription>
              Create a new digital booking record with automatic service checklist generation and customer notification.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateJob} className="space-y-4 py-2">
            {formError && (
              <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                {formError}
              </div>
            )}
            {/* Customer Mode Selection */}
            {customers.length > 0 && (
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-700">Client Profile</span>
                <button
                  type="button"
                  onClick={() => setIsInlineCustomer(!isInlineCustomer)}
                  className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
                >
                  {isInlineCustomer ? "Choose Existing Customer" : "+ Register New Customer"}
                </button>
              </div>
            )}

            {isInlineCustomer || customers.length === 0 ? (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-3">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5 text-blue-600" />
                  New Customer & Property Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Customer Name *</label>
                    <Input
                      value={inlineName}
                      onChange={(e) => setInlineName(e.target.value)}
                      placeholder="E.g., Dr. Ananya Sen"
                      required
                      className="text-xs bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Phone (for OTP) *</label>
                    <Input
                      value={inlinePhone}
                      onChange={(e) => setInlinePhone(e.target.value)}
                      placeholder="+91 98860 12345"
                      required
                      className="text-xs bg-white font-mono"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="font-semibold text-slate-700">Property Address *</label>
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
                  <label className="text-xs font-semibold text-slate-700">
                    Select Customer *
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      setSelectedCustomerId(e.target.value);
                      const matchProp = properties.find((p) => p.customerId === e.target.value);
                      if (matchProp) setSelectedPropertyId(matchProp.id);
                    }}
                    className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Property Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Service Property *
                  </label>
                  <select
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                    required
                  >
                    {customerProperties.length > 0 ? (
                      customerProperties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} - {p.address}
                        </option>
                      ))
                    ) : (
                      <option value="">No properties registered</option>
                    )}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Service Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Cleaning Service Package *
                </label>
                <select
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  required
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({formatCurrency(s.basePrice)} • ~{s.estimatedDurationHours} hrs)
                    </option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Scheduled Date *
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
                <label className="text-xs font-semibold text-slate-700">
                  Time Window * (from → to, set any times)
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
                <p className="text-[11px] text-slate-400">
                  Service window: <strong className="text-slate-600">{composedTimeSlot}</strong>
                </p>
              </div>

              {/* Direct Field-Worker Assignment (multi-select) */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700">
                  Assign Field Workers (Optional — select one or more; the first selection is the lead worker)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {fieldWorkers.map((w) => {
                    const isSelected = assignedStaffIds.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() =>
                          setAssignedStaffIds((prev) =>
                            prev.includes(w.id)
                              ? prev.filter((id) => id !== w.id)
                              : [...prev, w.id]
                          )
                        }
                        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                          isSelected
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {w.name}
                        {isSelected && assignedStaffIds[0] === w.id && " • Lead"}
                      </button>
                    );
                  })}
                </div>
                {assignedStaffIds.length === 0 && (
                  <p className="text-[11px] text-slate-400">
                    Leave unassigned to keep the job in the dispatcher pool. Workers see only jobs assigned to them; the first-assigned worker receives the customer OTP.
                  </p>
                )}
              </div>

              {/* Referral Partner */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Referral Partner Attribution
                </label>
                <select
                  value={referralPartnerId}
                  onChange={(e) => setReferralPartnerId(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  <option value="">Direct Booking (No Referral)</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Job Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Special Instructions / Work Notes
              </label>
              <Input
                value={jobNotes}
                onChange={(e) => setJobNotes(e.target.value)}
                placeholder="E.g. Focus on kitchen grease exhaust and master bath limescale..."
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-slate-900 text-white"
              >
                Schedule & Dispatch Job
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
export default function JobsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <JobsPageInner />
    </Suspense>
  );
}
