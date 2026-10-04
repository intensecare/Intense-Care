"use client";

import React, { useState, useMemo } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { ReferralPartner, CommissionRule, CommissionEntry, Payout } from "@/lib/types";
import {
  Share2,
  DollarSign,
  TrendingUp,
  Plus,
  QrCode,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Users,
  Settings,
  Loader2,
  Edit2,
  Trash2,
  Banknote,
  Phone,
  Mail,
  Landmark,
  History,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmModal } from "@/components/common/ConfirmModal";

export default function ReferralsAndCommissionsPage() {
  const {
    partners,
    commissionRules,
    commissionEntries,
    payouts,
    jobs,
    customers,
    createPartner,
    updatePartner,
    deletePartner,
    createCommissionRule,
    updateCommissionRule,
    deleteCommissionRule,
    approveCommissionEntry,
    createPayout,
  } = useApp();

  const [activeTab, setActiveTab] = useState("partners");
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [selectedPartnerForPayout, setSelectedPartnerForPayout] = useState<ReferralPartner | null>(null);
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "partner" | "rule"; id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [partnerStatus, setPartnerStatus] = useState<"active" | "inactive">("active");
  const [detailPartnerId, setDetailPartnerId] = useState<string | null>(null);

  // New Partner Form State
  const [partnerName, setPartnerName] = useState("");
  const [partnerType, setPartnerType] = useState<ReferralPartner["partnerType"]>("interior_designer");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerCode, setPartnerCode] = useState("");
  const [partnerRuleId, setPartnerRuleId] = useState("");

  // New Rule Form State
  const [ruleName, setRuleName] = useState("");
  const [rulePartnerType, setRulePartnerType] = useState<CommissionRule["partnerType"]>("interior_designer");
  const [calculationType, setCalculationType] = useState<CommissionRule["calculationType"]>("percentage");
  const [ruleValue, setRuleValue] = useState<number>(12);

  // Payout Form State
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutMethod, setPayoutMethod] = useState<Payout["payoutMethod"]>("bank_transfer");
  const [payoutRef, setPayoutRef] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);
  const [isSubmittingRule, setIsSubmittingRule] = useState(false);
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);

  // Commission rule options for dropdown
  const commissionRuleOptions = useMemo(() =>
    commissionRules.map((r) => ({
      value: r.id,
      label: `${r.name} (${r.value}% / ${r.calculationType})`,
    })),
  [commissionRules]);

  const totalReferralRevenue = partners.reduce((acc, p) => acc + p.totalRevenueGenerated, 0);
  const totalCommissionPaid = partners.reduce((acc, p) => acc + p.totalCommissionPaid, 0);
  const totalCommissionPending = partners.reduce((acc, p) => acc + p.totalCommissionPending, 0);

  const isEditingPartner = editingPartnerId !== null;

  const detailPartner = detailPartnerId
    ? partners.find((p) => p.id === detailPartnerId) ?? null
    : null;

  const openCreatePartner = () => {
    setEditingPartnerId(null);
    setActionError("");
    setPartnerName("");
    setPartnerEmail("");
    setPartnerPhone("");
    setPartnerCode("");
    setPartnerType("interior_designer");
    setPartnerRuleId("");
    setPartnerStatus("active");
    setIsPartnerModalOpen(true);
  };

  const openEditPartner = (p: ReferralPartner) => {
    setEditingPartnerId(p.id);
    setActionError("");
    setPartnerName(p.name);
    setPartnerType(p.partnerType);
    setPartnerEmail(p.email || "");
    setPartnerPhone(p.phone || "");
    setPartnerCode(p.code);
    setPartnerRuleId(p.commissionRuleId || "");
    setPartnerStatus(p.status === "inactive" ? "inactive" : "active");
    setIsPartnerModalOpen(true);
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerName) return;
    setIsSubmittingPartner(true);
    setActionError("");

    const result = isEditingPartner && editingPartnerId
      ? await updatePartner(editingPartnerId, {
          name: partnerName,
          partnerType,
          email: partnerEmail,
          phone: partnerPhone,
          commissionRuleId: partnerRuleId || null,
          status: partnerStatus,
        })
      : await createPartner({
          name: partnerName,
          partnerType,
          email: partnerEmail,
          phone: partnerPhone,
          code: partnerCode || undefined,
          commissionRuleId: partnerRuleId || commissionRules[0]?.id,
        });

    setIsSubmittingPartner(false);
    if (!result.success) {
      setActionError(result.message);
      return;
    }

    setIsPartnerModalOpen(false);
    setEditingPartnerId(null);
    setPartnerName("");
    setPartnerEmail("");
    setPartnerPhone("");
    setPartnerCode("");
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setActionError("");
    const result =
      deleteTarget.kind === "partner"
        ? await deletePartner(deleteTarget.id)
        : await deleteCommissionRule(deleteTarget.id);
    if (!result.success) {
      setActionError(result.message);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName) return;
    setIsSubmittingRule(true);

    const result = await createCommissionRule({
      name: ruleName,
      partnerType: rulePartnerType,
      calculationType,
      value: ruleValue,
      isDefault: false,
      active: true,
    });
    if (!result.success) {
      setIsSubmittingRule(false);
      return;
    }

    setIsRuleModalOpen(false);
    setRuleName("");
    setIsSubmittingRule(false);
  };

  const handleOpenPayout = (partner: ReferralPartner) => {
    setSelectedPartnerForPayout(partner);
    setPayoutAmount(partner.totalCommissionPending);
    setPayoutRef(`NEFT-${Date.now().toString().slice(-6)}`);
    setIsPayoutModalOpen(true);
  };

  const handleSubmitPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartnerForPayout || payoutAmount <= 0) return;
    setIsSubmittingPayout(true);

    await createPayout(
      selectedPartnerForPayout.id,
      payoutAmount,
      payoutMethod,
      payoutRef,
      payoutNotes
    );

    setIsPayoutModalOpen(false);
    setIsSubmittingPayout(false);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Referrals & Commission Management"
        description="Partner directory, configurable commission rules engine, conversion attribution, ledger, and payout settlements."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Referrals & Commissions" },
        ]}
        actions={
          <div className="flex gap-2">
            <Button
              onClick={openCreatePartner}
              className="bg-rose-500 text-white hover:bg-rose-600 h-9 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Register Partner
            </Button>
            <Button
              onClick={() => setIsRuleModalOpen(true)}
              variant="outline"
              size="sm"
              className="h-9 text-xs"
            >
              <Settings className="h-3.5 w-3.5 mr-1" />
              New Commission Rule
            </Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Active Partners
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-2">
            {partners.length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Designers, realtors & agents</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Referred Revenue
          </div>
          <div className="text-2xl font-semibold text-emerald-700 mt-2">
            {formatCurrency(totalReferralRevenue)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Lifetime booking attribution</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Pending Commission
          </div>
          <div className="text-2xl font-semibold text-amber-700 mt-2">
            {formatCurrency(totalCommissionPending)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Awaiting disbursement</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Commissions Paid Out
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-2">
            {formatCurrency(totalCommissionPaid)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Direct bank / UPI transfers</div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        {actionError && (
          <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
            {actionError}
          </p>
        )}
        <TabsList className="bg-slate-200/70 p-1">
          <TabsTrigger value="partners">Partner Directory ({partners.length})</TabsTrigger>
          <TabsTrigger value="ledger">
            Commission Ledger ({commissionEntries.length})
          </TabsTrigger>
          <TabsTrigger value="rules">
            Configurable Rules Engine ({commissionRules.length})
          </TabsTrigger>
          <TabsTrigger value="payouts">Payout Records ({payouts.length})</TabsTrigger>
        </TabsList>

        {/* 1. PARTNERS TAB */}
        <TabsContent value="partners" className="space-y-4">
          {partners.length === 0 ? (
            <EmptyState
              icon={Share2}
              title="No referral partners registered yet"
              description="Register interior designers, real estate brokers, and corporate partners to generate unique attribution links and track commission earnings."
              actionLabel="Configure Commission Rules"
              onAction={() => setActiveTab("rules")}
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="p-4 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Registered Referral Partners
                  </h3>
                  <p className="text-xs text-slate-500">
                    Interior studios, real estate brokerages, corporate managers, and VIP clients
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Partner</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Referral Code / Link</th>
                      <th className="py-3 px-4">Conversions</th>
                      <th className="py-3 px-4">Revenue Generated</th>
                      <th className="py-3 px-4">Earned / Pending</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {partners.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => setDetailPartnerId(p.id)}
                        className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                        title="Open partner details"
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            {p.name}
                            {p.status === "inactive" && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-200 text-slate-600">
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.phone}</div>
                        </td>
                        <td className="py-3 px-4 capitalize text-slate-600">
                          {p.partnerType.replace("_", " ")}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <span className="font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {p.code}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-900">{p.totalConversions}</span> / {p.totalReferrals} leads
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {formatCurrency(p.totalRevenueGenerated)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-emerald-700">
                            {formatCurrency(p.totalCommissionEarned)} earned
                          </div>
                          <div className="text-[11px] text-amber-700 font-medium">
                            {formatCurrency(p.totalCommissionPending)} pending
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                          {p.totalCommissionPending > 0 && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenPayout(p);
                              }}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Disburse Payout
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditPartner(p);
                            }}
                            title="Edit partner"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionError("");
                              setDeleteTarget({ kind: "partner", id: p.id, name: p.name });
                            }}
                            title="Delete partner"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Link
                            href={`/partner-portal/${p.code}`}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Partner View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* 2. COMMISSION LEDGER TAB */}
        <TabsContent value="ledger" className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Commission Lifecycle Ledger
                </h3>
                <p className="text-xs text-slate-500">
                  REFERRAL → BOOKED → COMPLETED → COMMISSION_PENDING → APPROVED → PAID
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Entry ID</th>
                    <th className="py-3 px-4">Job ID</th>
                    <th className="py-3 px-4">Partner</th>
                    <th className="py-3 px-4">Booking Amount</th>
                    <th className="py-3 px-4">Commission</th>
                    <th className="py-3 px-4">Rule Applied</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {commissionEntries.map((entry) => {
                    const partner = partners.find((p) => p.id === entry.partnerId);

                    return (
                      <tr key={entry.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                          {entry.id}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <Link href={`/jobs/${entry.jobId}`} className="text-blue-600 hover:underline">
                            {entry.jobId}
                          </Link>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {partner?.name}
                        </td>
                        <td className="py-3 px-4 font-semibold">
                          {formatCurrency(entry.bookingAmount)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-700">
                          {formatCurrency(entry.commissionAmount)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500 max-w-[200px] truncate">
                          {entry.ruleApplied}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              entry.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : entry.status === "APPROVED"
                                ? "bg-blue-100 text-blue-800"
                                : entry.status === "REVERSED"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {entry.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {entry.status === "COMMISSION_PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => approveCommissionEntry(entry.id)}
                              className="h-6 text-[10px] text-blue-700"
                            >
                              Approve
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* 3. CONFIGURABLE RULES ENGINE TAB */}
        <TabsContent value="rules" className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Configurable Commission Engine Rules
                </h3>
                <p className="text-xs text-slate-500">
                  Admins can configure percentage, fixed, tiered, or service-specific commission rules without code changes.
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => setIsRuleModalOpen(true)}
                className="bg-rose-500 text-white text-xs h-8"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Commission Rule
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {commissionRules.map((rule) => (
                <div
                  key={rule.id}
                  className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-sm">
                      {rule.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                        {rule.calculationType}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                        onClick={() => {
                          setActionError("");
                          setDeleteTarget({ kind: "rule", id: rule.id, name: rule.name });
                        }}
                        title="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="text-slate-600">
                    Target Partner Type: <strong className="capitalize">{rule.partnerType.replace("_", " ")}</strong>
                  </div>

                  <div className="p-2.5 rounded bg-white border border-slate-200 text-slate-700">
                    {rule.calculationType === "percentage" && (
                      <span>Calculates flat <strong>{rule.value}%</strong> on total completed booking amount.</span>
                    )}
                    {rule.calculationType === "fixed" && (
                      <span>Awards flat <strong>₹{rule.value}</strong> per completed job.</span>
                    )}
                    {rule.calculationType === "tiered" && (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-800">Tier Breakdown:</div>
                        {rule.tierRules?.map((t, idx) => (
                          <div key={idx} className="text-[11px] text-slate-600 flex justify-between">
                            <span>₹{t.minAmount} - ₹{t.maxAmount}:</span>
                            <span className="font-semibold">{t.rate}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {rule.calculationType === "service_specific" && (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-800">Service Overrides:</div>
                        {Object.entries(rule.serviceOverrides || {}).map(([srv, rate]) => (
                          <div key={srv} className="text-[11px] text-slate-600 flex justify-between">
                            <span>{srv}:</span>
                            <span className="font-semibold">{rate}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* 4. PAYOUTS TAB */}
        <TabsContent value="payouts" className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/75 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Partner Payout History
              </h3>
              <p className="text-xs text-slate-500">
                Audit trail of bank and UPI disbursements
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {payouts.map((pay) => (
                <div key={pay.id} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60">
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900 text-sm">{pay.partnerName}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Ref: {pay.referenceNumber} • Method: {pay.payoutMethod.toUpperCase()}
                    </div>
                    {pay.notes && <p className="text-[11px] text-slate-600 italic">"{pay.notes}"</p>}
                  </div>

                  <div className="text-right">
                    <div className="text-base font-semibold text-emerald-700">
                      {formatCurrency(pay.amount)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Disbursed: {formatDateTime(pay.paidAt || pay.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* New Commission Rule Dialog */}
      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configure Commission Rule</DialogTitle>
            <DialogDescription>
              Define dynamic commission calculation without changing platform code.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRule} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Rule Name *</label>
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="E.g., High-Value Realtor Bonus (15%)"
                required
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Target Partner Type</label>
              <select
                value={rulePartnerType}
                onChange={(e) => setRulePartnerType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="interior_designer">Interior Designer</option>
                <option value="real_estate_agent">Real Estate Agent / Broker</option>
                <option value="corporate_partner">Corporate Facility Partner</option>
                <option value="customer">Customer Advocate</option>
                <option value="influencer">Social Influencer</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Calculation Engine</label>
              <select
                value={calculationType}
                onChange={(e) => setCalculationType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="percentage">Percentage of Booking Amount (%)</option>
                <option value="fixed">Fixed Cash Bounty (₹ Flat)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">
                Rate Value ({calculationType === "percentage" ? "%" : "₹"})
              </label>
              <Input
                type="number"
                value={ruleValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setRuleValue(e.target.value === "" ? 0 : Number(e.target.value))}
                required
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRuleModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={isSubmittingRule}>
                {isSubmittingRule ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Rule"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disburse Payout Dialog */}
      <Dialog open={isPayoutModalOpen} onOpenChange={setIsPayoutModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disburse Partner Commission Payout</DialogTitle>
            <DialogDescription>
              Issue payment to {selectedPartnerForPayout?.name} and clear pending ledger balance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitPayout} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Payout Amount (₹) *</label>
              <Input
                type="number"
                value={payoutAmount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPayoutAmount(e.target.value === "" ? 0 : Number(e.target.value))}
                required
                className="text-xs font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Disbursement Method</label>
              <select
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="bank_transfer">Direct Bank Transfer (NEFT/RTGS)</option>
                <option value="upi">Instant UPI</option>
                <option value="cheque">Bank Cheque</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Transaction Reference # *</label>
              <Input
                value={payoutRef}
                onChange={(e) => setPayoutRef(e.target.value)}
                placeholder="UTR / Bank Transfer Reference"
                required
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Notes / Remarks</label>
              <Input
                value={payoutNotes}
                onChange={(e) => setPayoutNotes(e.target.value)}
                placeholder="E.g., September referral commission batch"
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPayoutModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-emerald-600 text-white" disabled={isSubmittingPayout}>
                {isSubmittingPayout ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Confirm & Record Payout"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Register / Edit Partner Dialog */}
      <Dialog open={isPartnerModalOpen} onOpenChange={setIsPartnerModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditingPartner ? "Edit Referral Partner" : "Register Referral Partner"}</DialogTitle>
            <DialogDescription>
              {isEditingPartner
                ? "Update partner details, commission rule assignment, or account status."
                : "Create a new partner account for attribution, tracking, and commission payouts."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreatePartner} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Partner / Business Name *</label>
              <Input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="E.g., Studio Luxe Interiors"
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Partner Category</label>
                <select
                  value={partnerType}
                  onChange={(e) => setPartnerType(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white text-xs"
                >
                  <option value="interior_designer">Interior Designer / Studio</option>
                  <option value="real_estate_agent">Real Estate Broker</option>
                  <option value="corporate_partner">Corporate Partner</option>
                  <option value="employee">Employee / Staff</option>
                  <option value="influencer">Influencer / Creator</option>
                  <option value="customer">VIP Customer</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Custom Code (Optional)</label>
                <Input
                  value={partnerCode}
                  onChange={(e) => setPartnerCode(e.target.value.toUpperCase())}
                  placeholder="E.g., LUXE10"
                  className="text-xs font-mono"
                  disabled={isEditingPartner}
                />
                {isEditingPartner && (
                  <p className="text-[10px] text-slate-400">Referral codes are permanent — portal links would break if changed.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Email Address</label>
                <Input
                  type="email"
                  value={partnerEmail}
                  onChange={(e) => setPartnerEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Phone Number</label>
                <Input
                  value={partnerPhone}
                  onChange={(e) => setPartnerPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Assigned Commission Rule</label>
              <SearchableSelect
                value={partnerRuleId}
                onChange={setPartnerRuleId}
                options={commissionRuleOptions}
                placeholder="Select a commission rule"
                className="text-xs"
              />
            </div>

            {isEditingPartner && (
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Account Status</label>
                <select
                  value={partnerStatus}
                  onChange={(e) => setPartnerStatus(e.target.value as "active" | "inactive")}
                  className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white text-xs"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPartnerModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={isSubmittingPartner}>
                {isSubmittingPartner ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : isEditingPartner ? (
                  "Save Changes"
                ) : (
                  "Register Partner"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Partner Detail Dialog */}
      <Dialog open={detailPartner !== null} onOpenChange={(open) => !open && setDetailPartnerId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailPartner && (() => {
            const rule = commissionRules.find((r) => r.id === detailPartner.commissionRuleId);
            const partnerEntries = commissionEntries.filter((e) => e.partnerId === detailPartner.id);
            const partnerPayouts = payouts.filter((x) => x.partnerId === detailPartner.id);
            const attributedCustomers = customers.filter((c) => c.referralPartnerId === detailPartner.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    {detailPartner.name}
                    <span className="font-mono text-xs bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                      {detailPartner.code}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        detailPartner.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {detailPartner.status}
                    </span>
                  </DialogTitle>
                  <DialogDescription>
                    Full partner file: performance counters, commission ledger and payout history.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2 text-xs max-h-[60vh] overflow-y-auto">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="capitalize bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                      {detailPartner.partnerType.replace("_", " ")}
                    </span>
                    {detailPartner.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3 text-slate-400" />
                        {detailPartner.email}
                      </span>
                    )}
                    {detailPartner.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3 text-slate-400" />
                        {detailPartner.phone}
                      </span>
                    )}
                    <span>Registered {formatDate(detailPartner.createdAt)}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="font-semibold text-slate-900 text-sm">{detailPartner.totalReferrals}</div>
                      <div className="text-slate-400">Attributed leads</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="font-semibold text-slate-900 text-sm">{detailPartner.totalConversions}</div>
                      <div className="text-slate-400">Conversions</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="font-semibold text-slate-900 text-sm">{formatCurrency(detailPartner.totalRevenueGenerated)}</div>
                      <div className="text-slate-400">Revenue generated</div>
                    </div>
                    <div className="p-2 rounded bg-emerald-50 border border-emerald-100">
                      <div className="font-semibold text-emerald-700 text-sm">{formatCurrency(detailPartner.totalCommissionEarned)}</div>
                      <div className="text-emerald-600/70">Commission earned</div>
                    </div>
                    <div className="p-2 rounded bg-amber-50 border border-amber-100">
                      <div className="font-semibold text-amber-700 text-sm">{formatCurrency(detailPartner.totalCommissionPending)}</div>
                      <div className="text-amber-600/70">Pending</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="font-semibold text-slate-900 text-sm">{formatCurrency(detailPartner.totalCommissionPaid)}</div>
                      <div className="text-slate-400">Paid out</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <Settings className="h-3 w-3 text-slate-400" />
                        Commission rule
                      </strong>
                      {rule ? (
                        <span className="text-slate-600">
                          {rule.name} — {rule.calculationType === "percentage" ? `${rule.value}%` : formatCurrency(rule.value)}{" "}
                          ({rule.calculationType.replace("_", " ")})
                        </span>
                      ) : (
                        <span className="text-slate-400">Default active rule applied at settlement</span>
                      )}
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <Landmark className="h-3 w-3 text-slate-400" />
                        Bank / Payout details
                      </strong>
                      {detailPartner.bankDetails ? (
                        <span className="text-slate-600 block truncate">
                          {detailPartner.bankDetails.accountName}
                          {detailPartner.bankDetails.upiId ? ` · UPI: ${detailPartner.bankDetails.upiId}` : ""}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not recorded</span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-blue-50/60 border border-blue-100 text-blue-900">
                    <strong className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {attributedCustomers.length} attributed customer lead(s)
                    </strong>
                    {attributedCustomers.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {attributedCustomers.map((c) => (
                          <Link
                            key={c.id}
                            href={`/customers/${c.id}`}
                            className="block text-[11px] text-blue-700 hover:underline"
                          >
                            {c.name} ({c.phone})
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                      <History className="h-3 w-3" />
                      Commission Ledger ({partnerEntries.length})
                    </h4>
                    {partnerEntries.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No commission entries yet.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {partnerEntries.map((e) => (
                          <div key={e.id} className="p-2.5 flex items-center justify-between gap-2">
                            <div>
                              <Link
                                href={`/jobs/${e.jobId}`}
                                className="font-mono text-[11px] text-blue-600 hover:underline"
                              >
                                {e.jobId}
                              </Link>
                              <div className="text-[10px] text-slate-400">{formatDate(e.createdAt)}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="font-semibold text-emerald-700">{formatCurrency(e.commissionAmount)}</div>
                                <div className="text-[10px] text-slate-400">on {formatCurrency(e.bookingAmount)}</div>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[9px] font-semibold ${
                                  e.status === "PAID"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : e.status === "APPROVED"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {e.status.replace("_", " ")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {partnerPayouts.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                        <Banknote className="h-3 w-3" />
                        Payouts ({partnerPayouts.length})
                      </h4>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {partnerPayouts.map((x) => (
                          <div key={x.id} className="p-2.5 flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">{formatCurrency(x.amount)}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{x.referenceNumber}</div>
                            </div>
                            <div className="text-right text-[10px] text-slate-500">
                              <div className="capitalize">{x.payoutMethod.replace("_", " ")}</div>
                              <div>{formatDate(x.paidAt)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter className="pt-3 border-t border-slate-100">
                  {detailPartner.totalCommissionPending > 0 && (
                    <Button
                      size="sm"
                      className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => {
                        const target = detailPartner;
                        setDetailPartnerId(null);
                        handleOpenPayout(target);
                      }}
                    >
                      Disburse Payout
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const target = detailPartner;
                      setDetailPartnerId(null);
                      openEditPartner(target);
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    Edit Partner
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDetailPartnerId(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete Partner / Rule Confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title={deleteTarget?.kind === "rule" ? "Delete Commission Rule" : "Delete Referral Partner"}
        description={
          deleteTarget?.kind === "rule"
            ? `Delete the rule "${deleteTarget?.name ?? ""}"? Rules assigned to partners cannot be deleted — deactivate instead.`
            : `Permanently delete partner "${deleteTarget?.name ?? ""}"? Partners with commission history cannot be deleted — mark them inactive instead.`
        }
        confirmText="Delete"
      />
    </AdminLayout>
  );
}
