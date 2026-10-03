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

export default function ReferralsAndCommissionsPage() {
  const {
    partners,
    commissionRules,
    commissionEntries,
    payouts,
    jobs,
    createPartner,
    createCommissionRule,
    updateCommissionRule,
    approveCommissionEntry,
    createPayout,
  } = useApp();

  const [activeTab, setActiveTab] = useState("partners");
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [selectedPartnerForPayout, setSelectedPartnerForPayout] = useState<ReferralPartner | null>(null);

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

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerName) return;
    setIsSubmittingPartner(true);

    const result = await createPartner({
      name: partnerName,
      partnerType,
      email: partnerEmail,
      phone: partnerPhone,
      code: partnerCode || undefined,
      commissionRuleId: partnerRuleId || commissionRules[0]?.id,
    });
    if (!result.success) {
      setIsSubmittingPartner(false);
      return;
    }

    setIsPartnerModalOpen(false);
    setPartnerName("");
    setPartnerEmail("");
    setPartnerPhone("");
    setPartnerCode("");
    setIsSubmittingPartner(false);
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
              onClick={() => setIsPartnerModalOpen(true)}
              className="bg-slate-900 text-white hover:bg-slate-800 h-9 text-xs"
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
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active Partners
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {partners.length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Designers, realtors & agents</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Referred Revenue
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">
            {formatCurrency(totalReferralRevenue)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Lifetime booking attribution</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Pending Commission
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-2">
            {formatCurrency(totalCommissionPending)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Awaiting disbursement</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Commissions Paid Out
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {formatCurrency(totalCommissionPaid)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Direct bank / UPI transfers</div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
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
                      <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.phone}</div>
                        </td>
                        <td className="py-3 px-4 capitalize text-slate-600">
                          {p.partnerType.replace("_", " ")}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {p.code}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-900">{p.totalConversions}</span> / {p.totalReferrals} leads
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
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
                              onClick={() => handleOpenPayout(p)}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Disburse Payout
                            </Button>
                          )}
                          <Link href={`/partner-portal/${p.code}`} target="_blank">
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
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
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
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
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
                        <td className="py-3 px-4 font-bold text-emerald-700">
                          {formatCurrency(entry.commissionAmount)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500 max-w-[200px] truncate">
                          {entry.ruleApplied}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              entry.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : entry.status === "APPROVED"
                                ? "bg-blue-100 text-blue-800"
                                : entry.status === "REVERSED"
                                ? "bg-rose-100 text-rose-800"
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
                <h3 className="text-sm font-bold text-slate-900">
                  Configurable Commission Engine Rules
                </h3>
                <p className="text-xs text-slate-500">
                  Admins can configure percentage, fixed, tiered, or service-specific commission rules without code changes.
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => setIsRuleModalOpen(true)}
                className="bg-slate-900 text-white text-xs h-8"
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
                    <span className="font-bold text-slate-900 text-sm">
                      {rule.name}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 text-slate-700">
                      {rule.calculationType}
                    </span>
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
                            <span className="font-bold">{t.rate}%</span>
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
                            <span className="font-bold">{rate}%</span>
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
                    <div className="font-bold text-slate-900 text-sm">{pay.partnerName}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Ref: {pay.referenceNumber} • Method: {pay.payoutMethod.toUpperCase()}
                    </div>
                    {pay.notes && <p className="text-[11px] text-slate-600 italic">"{pay.notes}"</p>}
                  </div>

                  <div className="text-right">
                    <div className="text-base font-bold text-emerald-700">
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
              <Button type="submit" size="sm" className="bg-slate-900 text-white" disabled={isSubmittingRule}>
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
                className="text-xs font-bold"
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

      {/* Register Partner Dialog */}
      <Dialog open={isPartnerModalOpen} onOpenChange={setIsPartnerModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register Referral Partner</DialogTitle>
            <DialogDescription>
              Create a new partner account for attribution, tracking, and commission payouts.
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
                  className="text-xs font-mono uppercase"
                />
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

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPartnerModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-slate-900 text-white" disabled={isSubmittingPartner}>
                {isSubmittingPartner ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  "Register Partner"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
