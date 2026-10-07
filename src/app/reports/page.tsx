"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { formatCurrency } from "@/lib/utils";
import {
  BarChart3,
  TrendingUp,
  ShieldCheck,
  Star,
  Users,
  Clock,
  Sparkles,
  Share2,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ReportsPage() {
  const { jobs, services, users, partners, complaints, qualityChecks } = useApp();

  // Customer satisfaction metrics resolved from server-recorded feedback
  // (stored on completion invites by POST /api/feedback).
  const [feedbackRows, setFeedbackRows] = React.useState<
    { jobId: string; rating: number; tags: string[]; comment: string | null; googleReviewClicked: boolean }[]
  >([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Feedback rows come back per job; gather for completed jobs only.
      const done = jobs.filter((j) => j.status === "COMPLETED" || j.status === "FEEDBACK_REQUESTED").slice(0, 50);
      const rows = await Promise.all(
        done.map(async (j) => {
          try {
            const res = await fetch(`/api/feedback?jobId=${encodeURIComponent(j.id)}`);
            const json = await res.json().catch(() => null);
            if (res.ok && json?.success && json.data) {
              return {
                jobId: j.id,
                rating: json.data.rating as number,
                tags: (json.data.tags || []) as string[],
                comment: (json.data.comment ?? null) as string | null,
                googleReviewClicked: Boolean(json.data.googleReviewClicked),
              };
            }
          } catch (e) {}
          return null;
        })
      );
      if (!cancelled) {
        setFeedbackRows(rows.filter(Boolean) as typeof feedbackRows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");

  // Quality metrics — computed from real QC audit records
  const auditedChecks = qualityChecks.filter((qc) => qc.status === "PASS" || qc.status === "REWORK_REQUIRED");
  const avgQcScore = qualityChecks.length > 0
    ? Math.round(qualityChecks.reduce((acc, qc) => acc + qc.score, 0) / qualityChecks.length)
    : 0;
  const firstPassRate = auditedChecks.length > 0
    ? Math.round((qualityChecks.filter((qc) => qc.status === "PASS").length / auditedChecks.length) * 100)
    : 100;
  const reworkRate = auditedChecks.length > 0 ? 100 - firstPassRate : 0;

  // CSAT — computed from server-recorded customer feedback
  const ratedFeedback = feedbackRows.filter((f) => typeof f.rating === "number");
  const avgCsat = ratedFeedback.length > 0
    ? Math.round((ratedFeedback.reduce((acc, f) => acc + f.rating, 0) / ratedFeedback.length) * 10) / 10
    : 0;
  const fiveStarCount = ratedFeedback.filter((f) => f.rating === 5).length;
  const fiveStarRate = ratedFeedback.length > 0
    ? Math.round((fiveStarCount / ratedFeedback.length) * 100)
    : 0;

  // Repeat client rate — customers with 2+ bookings / all customers with bookings
  const customersWithBookings = new Set(jobs.map((j) => j.customerId));
  const repeatCustomers = Array.from(customersWithBookings).filter(
    (cid) => jobs.filter((j) => j.customerId === cid).length >= 2
  ).length;
  const repeatRate = customersWithBookings.size > 0
    ? Math.round((repeatCustomers / customersWithBookings.size) * 100)
    : 0;

  // Analytics Calculations
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED" || j.status === "FEEDBACK_REQUESTED");
  const totalRevenue = jobs.reduce((acc, j) => acc + (j.amount ?? 0), 0);

  // Revenue by Service Breakdown
  const serviceBreakdown = services.map((s) => {
    const srvJobs = jobs.filter((j) => j.serviceId === s.id);
    const rev = srvJobs.reduce((acc, j) => acc + (j.amount ?? 0), 0);
    return {
      name: s.name,
      count: srvJobs.length,
      revenue: rev,
      percentage: Math.round((rev / (totalRevenue || 1)) * 100),
    };
  });

  // Per-Worker Performance (direct assignment model — no squads)
  const workerPerformance = users
    .filter((u) => ASSIGNABLE_ROLES.includes(u.role))
    .map((w) => {
      const workerJobs = jobs.filter((j) => (j.assignedStaffIds || []).includes(w.id));
      const done = workerJobs.filter((j) => j.status === "COMPLETED" || j.status === "FEEDBACK_REQUESTED").length;
      const leadJobs = workerJobs.filter((j) => j.assignedStaffIds?.[0] === w.id).length;
      return {
        id: w.id,
        name: w.name,
        total: workerJobs.length,
        completed: done,
        leadJobs,
        revenue: workerJobs.reduce((acc, j) => acc + (j.amount ?? 0), 0),
      };
    });

  return (
    <AdminLayout>
      <PageHeader
        title="Operations & Growth Analytics"
        description="Comprehensive business performance dashboard: service unit economics, field-worker delivery benchmarks, rework rates, and referral channel conversions."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Reports & Analytics" },
        ]}
        actions={
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 text-xs">
            <button
              onClick={() => setPeriod("month")}
              className={`px-3 py-1 rounded font-medium ${
                period === "month" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Current Month
            </button>
            <button
              onClick={() => setPeriod("quarter")}
              className={`px-3 py-1 rounded font-medium ${
                period === "quarter" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Q3 2026
            </button>
            <button
              onClick={() => setPeriod("year")}
              className={`px-3 py-1 rounded font-medium ${
                period === "year" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Full Year
            </button>
          </div>
        }
      />

      {/* Row 1: High Level Executive Metrics — all computed from live data */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Average Quality Score
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">{avgQcScore}%</div>
          <div className="text-[11px] text-emerald-600 font-medium">{firstPassRate}% First-Pass Rate</div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Rework Defect Rate
          </div>
          <div className="text-2xl font-semibold text-amber-700 mt-1">{reworkRate}%</div>
          <div className="text-[11px] text-slate-400">Industry benchmark: 12%</div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Customer CSAT Rating
          </div>
          <div className="text-2xl font-semibold text-amber-600 mt-1 flex items-center gap-1">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            {avgCsat || "—"} {avgCsat ? "/ 5.0" : ""}
          </div>
          <div className="text-[11px] text-slate-400">{fiveStarRate}% 5-Star Reviews</div>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 bg-white shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Repeat Client Rate
          </div>
          <div className="text-2xl font-semibold text-blue-700 mt-1">{repeatRate}%</div>
          <div className="text-[11px] text-emerald-600 font-medium">{repeatCustomers} repeat client{repeatCustomers === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Row 2: Service Unit Economics & Worker Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Service Revenue Distribution */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Revenue by Service Package
            </h3>
            <span className="text-xs text-slate-400">Gross Contribution</span>
          </div>

          <div className="space-y-3">
            {serviceBreakdown.map((s) => (
              <div key={s.name} className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{s.name}</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(s.revenue)} ({s.percentage}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-900 rounded-full"
                    style={{ width: `${Math.max(5, s.percentage)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worker Performance Matrix */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Field Worker Delivery & SLA Benchmarks
            </h3>
            <span className="text-xs text-slate-400">Performance Index</span>
          </div>

          <div className="space-y-3">
            {workerPerformance.length === 0 ? (
              <div className="text-xs text-slate-400 p-4 text-center">
                No field workers registered yet.
              </div>
            ) : (
              workerPerformance.map((w) => (
                <div
                  key={w.id}
                  className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 text-xs flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{w.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {w.completed} job{w.completed === 1 ? "" : "s"} closed • led {w.leadJobs} as lead
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-semibold text-slate-900">
                      {formatCurrency(w.revenue)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-semibold">
                      {w.total} assigned
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Referral Channels & Complaint Resolution SLAs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Referral Channels */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Partner Channel Attribution & ROI
            </h3>
            <span className="text-xs text-slate-400">Conversion Funnel</span>
          </div>

          <div className="space-y-3">
            {partners.map((p) => (
              <div key={p.id} className="p-3 rounded-lg border border-slate-100 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{p.name}</span>
                  <span className="font-semibold text-emerald-700">{formatCurrency(p.totalRevenueGenerated)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Code: <strong className="font-mono text-slate-700">{p.code}</strong></span>
                  <span>{p.totalConversions} conversions from {p.totalReferrals} leads ({Math.round((p.totalConversions / p.totalReferrals) * 100)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Complaint Resolution SLA */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Quality Incident & Complaint SLAs
            </h3>
            <span className="text-xs text-slate-400">Resolution Speed</span>
          </div>

          <div className="space-y-3 text-xs">
            {complaints.map((c) => (
              <div key={c.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-slate-900">{c.jobId}</span>
                  <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                    {c.status}
                  </span>
                </div>
                <p className="text-slate-800 font-medium">{c.description}</p>
                <div className="text-[11px] text-slate-400">
                  Assigned Manager: <strong className="text-slate-700">{c.assignedOwnerName}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
