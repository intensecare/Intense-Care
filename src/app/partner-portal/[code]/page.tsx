"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ReferralPartner, CommissionEntry, Payout } from "@/lib/types";
import {
  Share2,
  QrCode,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type PortalData = {
  partner: Pick<
    ReferralPartner,
    | "name"
    | "code"
    | "partnerType"
    | "status"
    | "totalReferrals"
    | "totalConversions"
    | "totalRevenueGenerated"
    | "totalCommissionEarned"
    | "totalCommissionPaid"
    | "totalCommissionPending"
  >;
  commissionEntries: CommissionEntry[];
  payouts: Payout[];
};

export default function PartnerPortalPage() {
  const params = useParams();
  const partnerCode = (params?.code as string) || "";

  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/partner-portal/${encodeURIComponent(partnerCode)}`)
      .then((res) => res.json().catch(() => null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data) {
          setData(json.data as PortalData);
        } else {
          setError(json?.error || "This partner portal link is invalid.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the partner portal. Please retry.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partnerCode]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-sm text-slate-500">Loading partner dashboard…</div>
      </div>
    );
  }

  const partner = data?.partner;

  if (error || !partner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md border border-slate-200 text-center max-w-md w-full">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Share2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Partner Portal Not Found</h2>
          <p className="text-sm text-slate-600 mb-6">
            {error ||
              `The referral partner code provided (${partnerCode}) is invalid or has expired. Please check your partner link or contact operations support.`}
          </p>
          <Link href="/login">
            <Button size="sm" className="">
              Return to Staff Portal
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const partnerCommissions = data?.commissionEntries ?? [];
  const partnerPayouts = data?.payouts ?? [];

  // Referral landing URL is derived from the deployment origin (config-driven,
  // no hardcoded marketing domain).
  const shareableUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${partner.code}`
      : `?ref=${partner.code}`;

  const copyToClipboard = (text: string, type: "link" | "code") => {
    navigator.clipboard.writeText(text);
    if (type === "link") {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200/90 py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Intense Care Partner Network
              </div>
              <div className="text-[10px] text-purple-700 font-semibold">
                Official Affiliate Dashboard
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-semibold text-slate-900">{partner.name}</div>
            <div className="text-[10px] text-slate-400 capitalize">
              {partner.partnerType.replace("_", " ")}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Welcome Banner */}
        <div className="rounded-lg border border-purple-200 bg-purple-900 text-white p-6 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold bg-purple-800 text-purple-200 px-2 py-0.5 rounded">
              {partner.status === "active" ? "Verified Partner" : "Partner (Inactive)"}
            </span>
            <h1 className="text-xl sm:text-2xl font-semibold">
              Welcome, {partner.name}
            </h1>
            <p className="text-xs text-purple-200 leading-relaxed max-w-lg">
              Track your client bookings, earned commissions, and settlement history.
            </p>
          </div>

          <div className="bg-purple-800/80 p-3 rounded-lg border border-purple-700 text-center sm:text-right shrink-0">
            <div className="text-[10px] font-semibold text-purple-300">
              Your Exclusive Referral Code
            </div>
            <div className="text-xl font-mono font-semibold text-amber-300 tracking-wider mt-0.5">
              {partner.code}
            </div>
          </div>
        </div>

        {/* Shareable Link & QR Code Box */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <h3 className="text-xs font-semibold text-slate-500">
            Your Tracking Links & Promo Tools
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Link Box */}
            <div className="sm:col-span-2 space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Direct Booking URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareableUrl}
                  className="flex-1 font-mono text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700"
                />
                <Button
                  size="sm"
                  onClick={() => copyToClipboard(shareableUrl, "link")}
                  className="bg-slate-900 text-white text-xs h-10 px-3"
                >
                  {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span className="ml-1.5">{copiedLink ? "Copied" : "Copy"}</span>
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">
                Bookings attributed to your code automatically appear in your commission ledger when they complete.
              </p>
            </div>

            {/* QR Code Preview */}
            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50 flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 bg-white border border-slate-200 rounded flex items-center justify-center text-slate-700 shadow-2xs">
                <QrCode className="h-10 w-10 text-slate-800" />
              </div>
              <span className="text-[10px] font-semibold text-slate-600 mt-1.5">
                Client QR Scan Card
              </span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-[10px] font-semibold text-slate-400">
              Total Clients Referred
            </span>
            <div className="text-2xl font-semibold text-slate-900 mt-1">
              {partner.totalReferrals}
            </div>
            <div className="text-[11px] text-emerald-600 font-medium">
              {partner.totalConversions} Converted
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-[10px] font-semibold text-slate-400">
              Generated Sales
            </span>
            <div className="text-2xl font-semibold text-slate-900 mt-1">
              {formatCurrency(partner.totalRevenueGenerated)}
            </div>
            <div className="text-[11px] text-slate-400">Gross deep clean value</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-[10px] font-semibold text-slate-400">
              Earned Commission
            </span>
            <div className="text-2xl font-semibold text-emerald-700 mt-1">
              {formatCurrency(partner.totalCommissionEarned)}
            </div>
            <div className="text-[11px] text-slate-400">Lifetime earnings</div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-xs">
            <span className="text-[10px] font-semibold text-amber-700">
              Pending Payout
            </span>
            <div className="text-2xl font-semibold text-amber-900 mt-1">
              {formatCurrency(partner.totalCommissionPending)}
            </div>
            <div className="text-[11px] text-amber-700 font-medium">Ready for transfer</div>
          </div>
        </div>

        {/* Commission Entries Table */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50/75 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Referred Jobs & Commission Ledger
            </h3>
            <p className="text-xs text-slate-500">
              Individual commissions credited upon job completion
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Booking Ref</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Order Value</th>
                  <th className="py-3 px-4">Your Commission</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {partnerCommissions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-slate-400">
                      No completed referrals yet. Share your booking URL to get started.
                    </td>
                  </tr>
                ) : (
                  partnerCommissions.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {c.jobId}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {formatDate(c.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {formatCurrency(c.bookingAmount)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-emerald-700">
                        {formatCurrency(c.commissionAmount)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            c.status === "PAID"
                              ? "bg-emerald-100 text-emerald-800"
                              : c.status === "APPROVED"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payout History */}
        {partnerPayouts.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/75 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Settlement History</h3>
              <p className="text-xs text-slate-500">Commissions paid out to your account</p>
            </div>
            <div className="divide-y divide-slate-100">
              {partnerPayouts.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">{formatCurrency(p.amount)}</div>
                    <div className="text-[11px] text-slate-400">
                      {formatDate(p.createdAt)} · {p.payoutMethod.replace("_", " ")} · {p.referenceNumber}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Note: bank details are managed by operations; contact support for updates. */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <ExternalLink className="h-3 w-3" />
          Questions about your commissions? Contact your operations partner manager.
        </div>
      </main>
    </div>
  );
}
