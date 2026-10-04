"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
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
import { PromptModal } from "@/components/common/PromptModal";
import { EmptyState } from "@/components/common/EmptyState";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { AmcContract, AmcVisit } from "@/lib/types";import {
  RefreshCw,
  Plus,
  CalendarClock,
  CalendarCheck,
  FileText,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Loader2,
  Bell,
  Plane,
  Home,
  ClipboardList,
} from "lucide-react";

const FREQUENCY_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIMONTHLY", label: "Twice a Month" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "CUSTOM", label: "Custom Spread" },
];

export default function AmcPage() {
  const { customers, properties, services, users, currentRole } = useApp();

  const [contracts, setContracts] = useState<AmcContract[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [rescheduleConfig, setRescheduleConfig] = useState<{ visitId: string; contractId: string; current: string } | null>(null);
  const [reportVisit, setReportVisit] = useState<{ contract: AmcContract; visit: AmcVisit } | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const loadContracts = async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/amc");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setContracts(json.data as AmcContract[]);
      else setLoadError(json?.error || "Failed to load AMC contracts.");
    } catch {
      setLoadError("Network error while loading AMC contracts.");
    }
  };

  React.useEffect(() => {
    void loadContracts();
  }, []);

  // ---------------------------------------------------------------- stats
  const allVisits = (contracts ?? []).flatMap((c) => c.visits);
  const today = new Date().toISOString().slice(0, 10);
  const activeContracts = (contracts ?? []).filter((c) => c.status === "ACTIVE" || c.status === "EXPIRING_SOON");
  const upcomingVisits = allVisits.filter(
    (v) => (v.status === "SCHEDULED" || v.status === "REMINDED" || v.status === "RESCHEDULED") && v.scheduledDate >= today
  );
  const completedVisits = allVisits.filter((v) => v.status === "COMPLETED");
  const visitsRemaining = allVisits.filter(
    (v) => v.status === "SCHEDULED" || v.status === "REMINDED" || v.status === "RESCHEDULED"
  ).length;
  const expiringContracts = (contracts ?? []).filter(
    (c) => c.status === "EXPIRING_SOON" || (c.status === "ACTIVE" && c.endDate <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))
  );
  const paymentPending = (contracts ?? []).filter((c) => c.paymentStatus !== "PAID" && c.status !== "CANCELLED");

  // ---------------------------------------------------------------- create
  const eligibleCustomers = [...customers];
  const [form, setForm] = useState({
    customerId: "",
    propertyId: "",
    serviceId: "",
    nriContactName: "",
    nriContactPhone: "",
    nriContactEmail: "",
    localContactName: "",
    localContactPhone: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
    contractValue: "",
    includedServicesText: "Deep Cleaning,Kitchen Degreasing,Bathroom Descaling",
    visitCount: "12",
    frequency: "MONTHLY",
    assignedStaffIds: [] as string[],
    emergencyContact: "",
    notes: "",
  });
  const formProperties = properties.filter((p) => p.customerId === form.customerId);
  const eligibleStaff = users.filter((u) => u.role === "staff" && u.active);

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerId || !form.propertyId) {
      showToast("Select the customer and their property first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/amc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId,
          propertyId: form.propertyId,
          serviceId: form.serviceId || null,
          nriContactName: form.nriContactName || null,
          nriContactPhone: form.nriContactPhone || null,
          nriContactEmail: form.nriContactEmail || null,
          localContactName: form.localContactName || null,
          localContactPhone: form.localContactPhone || null,
          startDate: form.startDate,
          endDate: form.endDate,
          contractValue: Number(form.contractValue) || 0,
          includedServices: form.includedServicesText.split(",").map((s) => s.trim()).filter(Boolean),
          visitCount: Math.max(1, parseInt(form.visitCount, 10) || 1),
          frequency: form.frequency,
          assignedStaffIds: form.assignedStaffIds,
          emergencyContact: form.emergencyContact || null,
          notes: form.notes || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setCreateOpen(false);
        showToast("AMC contract created — visits generated automatically.");
        await loadContracts();
      } else {
        showToast(json?.error || "Failed to create the contract.");
      }
    } catch {
      showToast("Network error creating the contract.");
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- actions
  const patchContract = async (contractId: string, body: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/amc/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        showToast(successMsg);
        await loadContracts();
        return true;
      }
      showToast(json?.error || "Action failed.");
      return false;
    } catch {
      showToast("Network error.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const visitStatusChip = (status: AmcVisit["status"]) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "REMINDED":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "CANCELLED":
        return "bg-red-50 text-red-700 border-red-200";
      case "RESCHEDULED":
        return "bg-slate-100 text-slate-600 border-slate-200";
      case "IN_PROGRESS":
        return "bg-rose-50 text-rose-700 border-rose-200";
      default:
        return "bg-white text-slate-600 border-slate-200";
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="AMC — Annual Maintenance Contracts"
        description="Recurring home maintenance for NRI families: contracts, visit calendars, field execution and the remote-owner visit report."
        breadcrumbs={[{ label: "Operations", href: "/" }, { label: "AMC" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void loadContracts()} disabled={contracts === null}>
              <RefreshCw className={cn("h-3.5 w-3.5", contracts === null && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New AMC Contract
            </Button>
          </div>
        }
      />

      {toast && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}

      {/* §2 Dashboard stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {[
          { label: "Active Contracts", value: activeContracts.length, icon: ShieldCheck, tint: "text-rose-600 bg-rose-50 border-rose-100" },
          { label: "Upcoming Visits", value: upcomingVisits.length, icon: CalendarClock, tint: "text-slate-700 bg-slate-50 border-slate-200" },
          { label: "Completed Visits", value: completedVisits.length, icon: CalendarCheck, tint: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: "Visits Remaining", value: visitsRemaining, icon: ClipboardList, tint: "text-amber-600 bg-amber-50 border-amber-100" },
          { label: "Expiring ≤30 days", value: expiringContracts.length, icon: AlertTriangle, tint: "text-amber-700 bg-amber-50 border-amber-200" },
          { label: "Payment Pending", value: paymentPending.length, icon: FileText, tint: "text-rose-600 bg-rose-50 border-rose-100" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div className={cn("h-8 w-8 rounded-lg border flex items-center justify-center mb-2", s.tint)}>
              <s.icon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-semibold text-slate-900 leading-none">{s.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Contracts */}
      {contracts === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{loadError}</div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No AMC contracts yet"
          description="Create the first annual maintenance contract — visits are generated automatically across the contract window."
          actionLabel="New AMC Contract"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-5">
          {contracts.map((c) => {
            const done = c.visits.filter((v) => v.status === "COMPLETED").length;
            const nextVisit = c.visits
              .filter((v) => v.status !== "COMPLETED" && v.status !== "CANCELLED" && v.scheduledDate >= today)
              .sort((a, b) => a.visitNumber - b.visitNumber)[0];
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                {/* Contract header */}
                <div className="p-5 pb-4 border-b border-slate-100 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 font-mono">{c.contractNumber}</h3>
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                            c.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : c.status === "EXPIRING_SOON"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : c.status === "CANCELLED"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          )}
                        >
                          {c.status.replace("_", " ")}
                        </span>
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                            c.paymentStatus === "PAID"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : c.paymentStatus === "PARTIAL"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          )}
                        >
                          {c.paymentStatus === "PENDING" ? "Payment Pending" : c.paymentStatus === "PARTIAL" ? "Partially Paid" : "Paid"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        {c.customerName} · {c.propertyTitle} · {c.serviceName || "Deep Cleaning"}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-semibold text-slate-900">{formatCurrency(c.contractValue)}</div>
                      <div className="text-slate-400">
                        {formatDate(c.startDate)} → {formatDate(c.endDate)}
                      </div>
                    </div>
                  </div>

                  {/* §2 required fields at a glance */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="flex items-center gap-1 text-slate-400 font-semibold"><Plane className="h-3 w-3" /> NRI Contact</span>
                      <p className="text-slate-800 font-medium mt-0.5">{c.nriContactName || "—"}</p>
                      <p className="font-mono text-slate-500">{c.nriContactPhone || ""}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="flex items-center gap-1 text-slate-400 font-semibold"><Home className="h-3 w-3" /> Local Contact</span>
                      <p className="text-slate-800 font-medium mt-0.5">{c.localContactName || "—"}</p>
                      <p className="font-mono text-slate-500">{c.localContactPhone || ""}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="text-slate-400 font-semibold">Included Services</span>
                      <p className="text-slate-800 font-medium mt-0.5">{c.includedServices.length ? c.includedServices.join(", ") : "—"}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="text-slate-400 font-semibold">Team & Emergency</span>
                      <p className="text-slate-800 font-medium mt-0.5">{c.assignedStaffNames?.join(", ") || "Unassigned"}</p>
                      <p className="font-mono text-slate-500 flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{c.emergencyContact || "—"}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      {FREQUENCY_OPTIONS.find((f) => f.value === c.frequency)?.label ?? c.frequency} · {done}/{c.visitCount} visits completed ·{" "}
                      {nextVisit ? `next on ${formatDate(nextVisit.scheduledDate)}` : "no visits pending"}
                    </span>
                    {currentRole === "super_admin" && (
                      <div className="flex items-center gap-1.5">
                        {c.paymentStatus !== "PAID" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={busy}
                            onClick={() =>
                              void patchContract(
                                c.id,
                                { action: "update_contract", paymentStatus: c.paymentStatus === "PENDING" ? "PARTIAL" : "PAID" },
                                c.paymentStatus === "PENDING" ? "Marked partially paid." : "Marked fully paid."
                              )
                            }
                          >
                            Mark {c.paymentStatus === "PENDING" ? "Partially Paid" : "Paid"}
                          </Button>
                        )}
                        {c.status !== "CANCELLED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] text-red-700 border-red-200 hover:bg-red-50"
                            disabled={busy}
                            onClick={() =>
                              void patchContract(c.id, { action: "update_contract", status: "CANCELLED" }, "Contract cancelled.")
                            }
                          >
                            Cancel Contract
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Visits timeline */}
                <div className="p-5 pt-4">
                  <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Visit Schedule & NRI Reports
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {c.visits.map((v) => (
                      <div key={v.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">
                            Visit {v.visitNumber} · {formatDate(v.scheduledDate)}
                          </span>
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-semibold border", visitStatusChip(v.status))}>
                            {v.status}
                          </span>
                        </div>
                        {v.staffNames && v.staffNames.length > 0 && (
                          <p className="text-slate-500">Team: {v.staffNames.join(", ")}</p>
                        )}
                        {v.reminderSentAt && <p className="text-amber-700">Reminder sent {formatDate(v.reminderSentAt)}</p>}
                        {v.status === "COMPLETED" ? (
                          <div className="space-y-1">
                            <p className="text-slate-600">
                              {v.arrivedAt && v.completedAt ? `${formatDate(v.arrivedAt)} → ${formatDate(v.completedAt)}` : ""}
                              {v.qcScore !== null && v.qcScore !== undefined ? ` · QC ${v.qcScore}%` : ""}
                            </p>
                            {v.nriApproved !== null && (
                              <p className={v.nriApproved ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
                                {v.nriApproved ? "NRI owner approved" : "Awaiting NRI owner approval"}
                              </p>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] w-full"
                              onClick={() => setReportVisit({ contract: c, visit: v })}
                            >
                              <FileText className="h-3 w-3 mr-1" />
                              View NRI Report
                            </Button>
                          </div>
                        ) : v.status !== "CANCELLED" ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 gap-1"
                              disabled={busy}
                              onClick={() => void patchContract(c.id, { action: "remind_visit", visitId: v.id }, `Reminder logged for visit ${v.visitNumber}.`)}
                            >
                              <Bell className="h-2.5 w-2.5" />
                              Remind
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2"
                              disabled={busy}
                              onClick={() => setRescheduleConfig({ visitId: v.id, contractId: c.id, current: v.scheduledDate })}
                            >
                              Reschedule
                            </Button>
                            <Button
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              disabled={busy}
                              onClick={() => setReportVisit({ contract: c, visit: v })}
                            >
                              Complete & Report
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create contract dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Annual Maintenance Contract</DialogTitle>
            <DialogDescription>
              Visits are generated automatically and evenly spread across the contract window.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateContract} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Customer</label>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value, propertyId: "" }))}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                >
                  <option value="">Select customer…</option>
                  {eligibleCustomers.map((cu) => (
                    <option key={cu.id} value={cu.id}>
                      {cu.name} ({cu.phone})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Property</label>
                <select
                  value={form.propertyId}
                  onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                  disabled={!form.customerId}
                >
                  <option value="">Select property…</option>
                  {formProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} — {p.address}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Service Package</label>
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                >
                  <option value="">Any / general</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Contract Value (₹)</label>
                <Input value={form.contractValue} onChange={(e) => setForm((f) => ({ ...f, contractValue: e.target.value }))} placeholder="e.g. 24000" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                >
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Start Date</label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">End Date</label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Number of Visits</label>
                <Input value={form.visitCount} onChange={(e) => setForm((f) => ({ ...f, visitCount: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">NRI Contact Name</label>
                <Input value={form.nriContactName} onChange={(e) => setForm((f) => ({ ...f, nriContactName: e.target.value }))} placeholder="Owner abroad" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">NRI Contact Phone</label>
                <Input value={form.nriContactPhone} onChange={(e) => setForm((f) => ({ ...f, nriContactPhone: e.target.value }))} placeholder="+971…" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">NRI Contact Email</label>
                <Input value={form.nriContactEmail} onChange={(e) => setForm((f) => ({ ...f, nriContactEmail: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Local Contact Name</label>
                <Input value={form.localContactName} onChange={(e) => setForm((f) => ({ ...f, localContactName: e.target.value }))} placeholder="e.g. parents / caretaker" />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Local Contact Phone</label>
                <Input value={form.localContactPhone} onChange={(e) => setForm((f) => ({ ...f, localContactPhone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Emergency Contact</label>
                <Input value={form.emergencyContact} onChange={(e) => setForm((f) => ({ ...f, emergencyContact: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Included Services (comma separated)</label>
                <Input value={form.includedServicesText} onChange={(e) => setForm((f) => ({ ...f, includedServicesText: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Assign Team</label>
                <div className="flex flex-wrap gap-1.5">
                  {eligibleStaff.map((w) => {
                    const selected = form.assignedStaffIds.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            assignedStaffIds: selected
                              ? f.assignedStaffIds.filter((id) => id !== w.id)
                              : [...f.assignedStaffIds, w.id],
                          }))
                        }
                        className={cn(
                          "px-2.5 py-1 rounded text-[11px] font-semibold border transition-all",
                          selected ? "bg-rose-500 text-white border-rose-500" : "bg-white text-slate-700 border-slate-200 hover:border-rose-300"
                        )}
                      >
                        {w.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Gate access, keys with caretaker, etc." />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Create Contract & Generate Visits
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reschedule prompt */}
      <PromptModal
        isOpen={!!rescheduleConfig}
        onClose={() => setRescheduleConfig(null)}
        title="Reschedule AMC Visit"
        description="Enter the new visit date (YYYY-MM-DD):"
        placeholder={rescheduleConfig?.current || "2026-11-01"}
        defaultValue={rescheduleConfig?.current || ""}
        confirmText="Reschedule Visit"
        onSubmit={(val) => {
          if (rescheduleConfig && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
            void patchContract(rescheduleConfig.contractId, { action: "reschedule_visit", visitId: rescheduleConfig.visitId, scheduledDate: val.trim() }, "Visit rescheduled.");
          } else {
            showToast("Please use the YYYY-MM-DD date format.");
          }
          setRescheduleConfig(null);
        }}
      />

      {/* Visit complete / NRI report dialog */}
      <Dialog open={!!reportVisit} onOpenChange={(o) => !o && setReportVisit(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {reportVisit && (
            <ReportDialog
              contract={reportVisit.contract}
              visit={reportVisit.visit}
              busy={busy}
              onClose={() => setReportVisit(null)}
              onComplete={async (payload) => {
                const ok = await patchContract(
                  reportVisit.contract.id,
                  { action: "complete_visit", visitId: reportVisit.visit.id, ...payload },
                  "Visit completed — NRI report recorded."
                );
                if (ok) setReportVisit(null);
              }}
              onApproval={async (nriApproved, nriNotes) => {
                await patchContract(reportVisit.contract.id, { action: "nri_approval", visitId: reportVisit.visit.id, nriApproved, nriNotes }, nriApproved ? "NRI approval recorded." : "Approval request noted.");
                setReportVisit(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Complete-visit + NRI report dialog                                          */
/* -------------------------------------------------------------------------- */
function ReportDialog({
  contract,
  visit,
  busy,
  onClose,
  onComplete,
  onApproval,
}: {
  contract: AmcContract;
  visit: AmcVisit;
  busy: boolean;
  onClose: () => void;
  onComplete: (payload: Record<string, unknown>) => Promise<void>;
  onApproval: (approved: boolean, notes?: string) => Promise<void>;
}) {
  const isCompleted = visit.status === "COMPLETED";
  const [qcScore, setQcScore] = useState(visit.qcScore?.toString() ?? "95");
  const [issues, setIssues] = useState(visit.issuesFound ?? "");
  const [recommendations, setRecommendations] = useState(visit.recommendations ?? "");
  const [nriNotes, setNriNotes] = useState(visit.nriNotes ?? "");

  const nextVisit = contract.visits.find(
    (v) => v.visitNumber === visit.visitNumber + 1 && v.status !== "CANCELLED"
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isCompleted ? `NRI Visit Report — Visit ${visit.visitNumber}` : `Complete Visit ${visit.visitNumber} & Record Report`}
        </DialogTitle>
        <DialogDescription>
          {contract.contractNumber} · {contract.customerName} · {formatDate(visit.scheduledDate)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-1 text-xs">
        {/* §2 NRI report fields */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-slate-400 font-semibold text-[10px]">Arrival</span>
            <p className="text-slate-800 font-medium">{visit.arrivedAt ? formatDate(visit.arrivedAt) : "On visit date"}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-slate-400 font-semibold text-[10px]">Completion</span>
            <p className="text-slate-800 font-medium">{visit.completedAt ? formatDate(visit.completedAt) : isCompleted ? formatDate(visit.scheduledDate) : "—"}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-slate-400 font-semibold text-[10px]">Staff</span>
            <p className="text-slate-800 font-medium">{visit.staffNames?.join(", ") || contract.assignedStaffNames?.join(", ") || "—"}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-slate-400 font-semibold text-[10px]">Work Completed</span>
            <p className="text-slate-800 font-medium">{contract.includedServices.join(", ") || contract.serviceName || "Deep cleaning"}</p>
          </div>
        </div>

        {isCompleted ? (
          <div className="space-y-2">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 font-semibold text-[10px]">Quality Result</span>
              <p className="text-slate-800 font-medium">{visit.qcScore !== null && visit.qcScore !== undefined ? `${visit.qcScore}% — Passed` : "Not recorded"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 font-semibold text-[10px]">Issues</span>
              <p className="text-slate-800">{visit.issuesFound || "None"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 font-semibold text-[10px]">Recommendations</span>
              <p className="text-slate-800">{visit.recommendations || "None"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 font-semibold text-[10px]">Next Scheduled Visit</span>
              <p className="text-slate-800 font-medium">{nextVisit ? formatDate(nextVisit.scheduledDate) : "Contract window complete"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-400 font-semibold text-[10px]">Payment / Contract</span>
              <p className="text-slate-800 font-medium">
                {contract.paymentStatus === "PAID" ? "Paid" : contract.paymentStatus === "PARTIAL" ? "Partially Paid" : "Payment Pending"} ·{" "}
                {contract.status.replace("_", " ")}
              </p>
            </div>

            {visit.nriApproved === null || visit.nriApproved === undefined ? (
              <div className="space-y-2 pt-1">
                <Input value={nriNotes} onChange={(e) => setNriNotes(e.target.value)} placeholder="Note from the NRI owner (optional)" />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-9"
                    disabled={busy}
                    onClick={() => void onApproval(true, nriNotes || undefined)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Record NRI Approval
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9 text-amber-700 border-amber-200 hover:bg-amber-50"
                    disabled={busy}
                    onClick={() => void onApproval(false, nriNotes || undefined)}
                  >
                    Needs Attention
                  </Button>
                </div>
              </div>
            ) : (
              <p className={cn("text-[11px] font-medium", visit.nriApproved ? "text-emerald-700" : "text-amber-700")}>
                {visit.nriApproved ? "NRI owner approved this visit." : "Visit flagged by the NRI owner — follow up."}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">QC Score (0–100)</label>
              <Input value={qcScore} onChange={(e) => setQcScore(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Issues Found (for the NRI report)</label>
              <Input value={issues} onChange={(e) => setIssues(e.target.value)} placeholder="e.g. Chimney baffle needs replacement part" />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Recommendations</label>
              <Input value={recommendations} onChange={(e) => setRecommendations(e.target.value)} placeholder="e.g. Deep sofa shampoo next visit" />
            </div>
            <Button size="sm" className="w-full h-9" disabled={busy} onClick={() => void onComplete({ qcScore: parseInt(qcScore, 10) || null, issuesFound: issues || null, recommendations: recommendations || null })}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Mark Visit Completed
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
