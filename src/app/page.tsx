"use client";

import React from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, timeAgo, toLocalDateString } from "@/lib/utils";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import {
  Briefcase,
  Clock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Share2,
  Calendar,
  Smartphone,
  ChevronRight,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Operations dashboard. Two hard rules enforced top to bottom:
 *
 *  1. Dispatch window — ops sees jobs from the past through the dispatch
 *     window (today, plus tomorrow after the cutoff). The same visibility
 *     helper the API enforces server-side filters every list here.
 *  2. No financial data — amounts, payment status, invoices, commissions are
 *     super_admin-only. The server redacts them from every job payload; this
 *     page simply never renders money.
 */
export default function DashboardPage() {
  const {
    jobs,
    customers,
    properties,
    services,
    users,
    qualityChecks,
    complaints,
    smsGatewayLogs,
    fetchSmsGatewayLog,
    currentRole,
    systemSettings,
  } = useApp();

  const isOps = currentRole === "ops_manager";

  // Same server-enforced visibility window, applied client-side for display.
  const visibility = getOpsDateVisibility(new Date(), {
    nextDayDispatchTime: systemSettings?.nextDayDispatchTime || "20:00",
  });
  const visibleJobs = isOps ? filterJobsForOpsManager(jobs, visibility) : jobs;

  // Load the server SMS gateway trail once for the activity feed.
  React.useEffect(() => {
    if (currentRole === "staff") return;
    void fetchSmsGatewayLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldStaff = users.filter((u) => u.role === "staff");
  const staffWorkload = new Map<string, number>();
  visibleJobs
    .filter((j) => j.status !== "COMPLETED" && j.status !== "CANCELLED" && j.status !== "CLOSED")
    .forEach((j) => {
      (j.assignedStaffIds || []).forEach((id) => {
        staffWorkload.set(id, (staffWorkload.get(id) || 0) + 1);
      });
    });

  // Calculations for Operations KPIs (local-date aware)
  const todayDate = toLocalDateString();
  const todayJobs = visibleJobs.filter((j) => j.scheduledDate === todayDate);

  const inProgressCount = visibleJobs.filter((j) => j.status === "IN_PROGRESS" || j.status === "ARRIVED" || j.status === "CUSTOMER_VERIFIED").length;
  const qcPendingCount = visibleJobs.filter((j) => j.status === "WORK_COMPLETED" || j.status === "QUALITY_CHECK").length;
  const reworkCount = visibleJobs.filter((j) => j.status === "REWORK_REQUIRED").length;
  const approvalCount = visibleJobs.filter((j) => j.status === "CUSTOMER_APPROVAL").length;
  const completedCount = visibleJobs.filter((j) => j.status === "COMPLETED" || j.status === "FEEDBACK_REQUESTED").length;

  // Quality score average — computed from actual QC data
  const completedQcScores = qualityChecks.filter((qc) => qc.score > 0).map((qc) => qc.score);
  const avgQcScore = completedQcScores.length > 0
    ? Math.round(completedQcScores.reduce((a, b) => a + b, 0) / completedQcScores.length)
    : 0;

  // Historical pass rate — derived from real QC records
  const passedQcCount = qualityChecks.filter((qc) => qc.status === "PASS").length;
  const auditedQcCount = qualityChecks.filter((qc) => qc.status === "PASS" || qc.status === "REWORK_REQUIRED").length;
  const qcPassRate = auditedQcCount > 0 ? Math.round((passedQcCount / auditedQcCount) * 100) : 100;

  return (
    <AdminLayout>
      <PageHeader
        title="Operations Dispatch & Overview"
        description="Real-time control tower for on-site field workers, customer OTP verification, and independent QC audits."
        actions={
          <>
            <Link href="/field">
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs border-zinc-200 text-zinc-700 hover:bg-zinc-100">
                <Smartphone className="h-3.5 w-3.5 text-rose-500" />
                Open Field Staff View
              </Button>
            </Link>
            {currentRole === "super_admin" && (
              <Link href="/jobs?create=true">
                <Button size="sm" className="h-9 gap-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-800 font-medium shadow-xs">
                  <Briefcase className="h-3.5 w-3.5 text-rose-400" />
                  Schedule New Job
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* Row 1: Operations KPIs (no financial data — ops role) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Today's Active Field Workers"
          value={`${inProgressCount} Active`}
          subtitle={`${todayJobs.length} jobs dispatched today`}
          icon={Clock}
          change="On schedule"
          changeType="positive"
        />
        <StatCard
          title="Quality Control Queue"
          value={`${qcPendingCount} Pending`}
          subtitle={reworkCount > 0 ? `${reworkCount} requiring rework` : "0 rework required"}
          icon={ShieldCheck}
          change={reworkCount > 0 ? `${reworkCount} Alert` : "Clean"}
          changeType={reworkCount > 0 ? "negative" : "positive"}
        />
        <StatCard
          title="Customer Approvals"
          value={`${approvalCount} Ready`}
          subtitle="Awaiting digital sign-off"
          icon={Sparkles}
          change={auditedQcCount > 0 ? `${qcPassRate}% QC pass rate` : "No audits yet"}
          changeType={auditedQcCount > 0 ? "positive" : "neutral"}
        />
        <StatCard
          title="Completed Handover"
          value={completedCount}
          subtitle="Closed digital records"
          icon={CheckCircle2}
          change={avgQcScore > 0 ? `Avg QC: ${avgQcScore}%` : "0% Avg QC"}
          changeType={avgQcScore > 0 ? "positive" : "neutral"}
        />
      </div>

      {/* Row 2: Field status KPIs (financial row is super_admin-only) */}
      {currentRole === "super_admin" ? (
        <SuperAdminFinanceRow />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Assigned & Ready"
            value={visibleJobs.filter((j) => j.status === "ASSIGNED" || j.status === "SCHEDULED").length}
            subtitle="Jobs awaiting field execution"
            icon={Calendar}
            change="Dispatch queue"
            changeType="neutral"
          />
          <StatCard
            title="Open Complaints"
            value={complaints.filter((c) => c.status !== "closed" && c.status !== "resolved").length}
            subtitle="Customer attention requests"
            icon={AlertTriangle}
            change={complaints.some((c) => c.status !== "closed" && c.status !== "resolved") ? "In review" : "All clear"}
            changeType={complaints.some((c) => c.status !== "closed" && c.status !== "resolved") ? "negative" : "positive"}
          />
          <StatCard
            title="Window Cutoff"
            value={visibility.cutoffTime}
            subtitle={`Tomorrow visible after ${visibility.cutoffTime}`}
            icon={Clock}
            change={visibility.isAfterCutoff ? "Queue unlocked" : "Cutoff lock active"}
            changeType={visibility.isAfterCutoff ? "positive" : "neutral"}
          />
          <StatCard
            title="Field Workers"
            value={fieldStaff.length}
            subtitle={`${fieldStaff.filter((w) => (staffWorkload.get(w.id) || 0) > 0).length} currently on job`}
            icon={Smartphone}
            change="Active roster"
            changeType="neutral"
          />
        </div>
      )}

      {/* Main Grid: Live Operations Board & Field Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Job Dispatch Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Live Operations Queue
                </h3>
                <p className="text-xs text-slate-500">
                  Real-time status of current deep cleaning bookings
                </p>
              </div>
              <Link
                href="/jobs"
                className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1"
              >
                View all ({visibleJobs.length}) <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            {visibleJobs.length === 0 ? (
              <div className="p-8 text-center bg-slate-50/50">
                <div className="h-10 w-10 rounded-full bg-white border border-slate-200 text-slate-500 flex items-center justify-center mx-auto mb-2">
                  <Briefcase className="h-5 w-5" />
                </div>
                <h4 className="text-xs font-semibold text-slate-800">Operational Queue Clear</h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1 mb-3">
                  No cleaning jobs are inside your dispatch window
                  {isOps ? ` (past through ${visibility.maxVisibleDate})` : ""}. New bookings appear here once they enter the window.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleJobs.slice(0, 6).map((job) => {
                  const customer = customers.find((c) => c.id === job.customerId);
                  const property = properties.find((p) => p.id === job.propertyId);
                  const service = services.find((s) => s.id === job.serviceId);
                  const assignedWorkers = (job.assignedStaffIds || [])
                    .map((id) => users.find((u) => u.id === id)?.name)
                    .filter(Boolean) as string[];

                  return (
                    <div
                      key={job.id}
                      className="p-4 hover:bg-slate-50/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/jobs/${job.id}`}
                            className="font-mono text-xs font-bold text-slate-900 hover:underline"
                          >
                            {job.id}
                          </Link>
                          <JobStatusBadge status={job.status} size="sm" />
                          {job.status === "ARRIVED" && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded animate-pulse">
                              Customer OTP Pending
                            </span>
                          )}
                        </div>

                        <div className="text-xs font-medium text-slate-900 truncate">
                          {customer?.name} • <span className="text-slate-500 font-normal">{property?.title}</span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span>{service?.name}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(job.scheduledDate)} • {job.scheduledTimeSlot}
                          </span>
                          {assignedWorkers.length > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-slate-600 font-medium">
                                {assignedWorkers.join(", ")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link href={`/jobs/${job.id}`}>
                          <Button variant="outline" size="sm" className="h-8 text-xs px-2.5">
                            Manage
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Workflow Navigation Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/field"
              className="p-4 rounded-xl border border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-xs transition-all flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-zinc-900 text-white shrink-0 group-hover:bg-rose-600 transition-colors">
                <Smartphone className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-zinc-900 flex items-center gap-1 group-hover:text-rose-600 transition-colors">
                  Field Staff Portal
                  <ArrowUpRight className="h-3 w-3 text-zinc-400 group-hover:text-rose-500" />
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                  Mobile view for Arrive, OTP verify, and checklists
                </p>
              </div>
            </Link>

            <Link
              href="/quality"
              className="p-4 rounded-xl border border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-xs transition-all flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-zinc-900 text-white shrink-0 group-hover:bg-rose-600 transition-colors">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-zinc-900 flex items-center gap-1 group-hover:text-rose-600 transition-colors">
                  Quality Inspector
                  <ArrowUpRight className="h-3 w-3 text-zinc-400 group-hover:text-rose-500" />
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                  Rubric grading, defect flags & rework dispatch
                </p>
              </div>
            </Link>

            <Link
              href="/dispatcher"
              className="p-4 rounded-xl border border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-xs transition-all flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-zinc-900 text-white shrink-0 group-hover:bg-rose-600 transition-colors">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-zinc-900 flex items-center gap-1 group-hover:text-rose-600 transition-colors">
                  Dispatch Tower
                  <ArrowUpRight className="h-3 w-3 text-zinc-400 group-hover:text-rose-500" />
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                  Tomorrow&apos;s queue and field-worker assignments
                </p>
              </div>
            </Link>
          </div>
        </div>

        {/* Right Col: Field Worker Workload & SMS Feed */}
        <div className="space-y-6">
          {/* Field Worker Workload */}
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 font-sans">
              Field Worker Workload
            </h3>
            <div className="space-y-3">
              {fieldStaff.map((w) => {
                const load = staffWorkload.get(w.id) || 0;
                return (
                  <div
                    key={w.id}
                    className="p-2.5 rounded-md border border-slate-100 bg-slate-50/60 text-xs flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            load > 0 ? "bg-emerald-500 animate-pulse" : "bg-blue-400"
                          }`}
                        />
                        {w.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {load > 0 ? `${load} active job${load === 1 ? "" : "s"} assigned` : "No active assignments"}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        load > 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {load > 0 ? "On Job" : "Ready"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gateway Dispatch Feed */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                SMS Gateway Activity
              </h3>
              <span className="text-[10px] text-slate-400">Server Audit Trail</span>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {smsGatewayLogs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No OTP dispatches recorded yet.
                </p>
              ) : (
                smsGatewayLogs.slice(0, 7).map((log) => (
                  <div key={log.id} className="text-xs space-y-1 pb-2.5 border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-slate-500 font-semibold">
                        {log.jobId || "—"}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {timeAgo(log.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-700 text-[11px] leading-tight">
                      Arrival OTP to {log.recipientMasked}
                    </p>
                    <div className="text-[10px] font-medium">
                      <span
                        className={
                          log.status === "SENT"
                            ? "text-emerald-700"
                            : log.status === "FAILED"
                            ? "text-rose-700"
                            : "text-amber-700"
                        }
                      >
                        {log.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

/**
 * Financial KPI row — super_admin only. Rendered via a child component so the
 * ops/staff render path never even evaluates invoice/commission figures.
 */
function SuperAdminFinanceRow() {
  const { invoices, commissionEntries, complaints } = useApp();

  const totalRevenue = invoices.reduce((acc, inv) => acc + inv.amountPaid, 0);
  const totalReceivables = invoices.reduce((acc, inv) => acc + inv.balanceDue, 0);
  const pendingCommissions = commissionEntries
    .filter((c) => c.status === "COMMISSION_PENDING" || c.status === "APPROVED")
    .reduce((acc, c) => acc + c.commissionAmount, 0);
  const unpaidInvoiceCount = invoices.filter((inv) => inv.balanceDue > 0).length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <StatCard
        title="Collected Revenue"
        value={formatCurrency(totalRevenue)}
        subtitle="All-time collections"
        icon={DollarSign}
        change={invoices.length > 0 ? `${invoices.length} invoices` : "No invoices"}
        changeType="neutral"
      />
      <StatCard
        title="Pending Receivables"
        value={formatCurrency(totalReceivables)}
        subtitle="Invoiced pending balance"
        icon={TrendingUp}
        change={`${unpaidInvoiceCount} unpaid invoice${unpaidInvoiceCount === 1 ? "" : "s"}`}
        changeType={unpaidInvoiceCount > 0 ? "negative" : "neutral"}
      />
      <StatCard
        title="Pending Partner Payouts"
        value={formatCurrency(pendingCommissions)}
        subtitle="Approved commission ledger"
        icon={Share2}
        change="Ready to disburse"
        changeType="neutral"
      />
      <StatCard
        title="Active Complaints"
        value={complaints.filter((c) => c.status !== "closed" && c.status !== "resolved").length}
        subtitle="Customer attention requests"
        icon={AlertTriangle}
        change={complaints.some((c) => c.status !== "closed" && c.status !== "resolved") ? "In review" : "All clear"}
        changeType={complaints.some((c) => c.status !== "closed" && c.status !== "resolved") ? "negative" : "positive"}
      />
    </div>
  );
}
