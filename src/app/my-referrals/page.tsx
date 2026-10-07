"use client";

import React, { useEffect, useState } from "react";
import { PortalLayout } from "@/components/common/PortalLayout";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Copy, Check, Share2, Link2 } from "lucide-react";

interface PartnerPayload {
  partner: { name: string; code: string; partnerType: string; status: string };
  referralLink: string;
  bookingLink: string;
  funnel: { leads: number; booked: number; completed: number };
  money: { revenue: number; commission: number; pending: number; paid: number };
  jobs: { id: string; stage: string; scheduledDate: string; serviceName: string | null }[];
  commissionEntries: { id: string; jobId: string; bookingAmount: number; commissionAmount: number; status: string; createdAt: string }[];
  payouts: { id: string; amount: number; method: string; reference: string; status: string; paidAt: string }[];
}

/**
 * REFERRAL PARTNER home — "My Referrals" (§12).
 * Generate link → leads → booked → completed → commission → paid.
 * Own data only; nothing operational.
 */
export default function MyReferralsPage() {
  const [data, setData] = useState<PartnerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/partner");
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) setData(json.data);
        else setError(json?.error || "Could not load your referrals.");
      } catch {
        setError("Network error. Please retry.");
      }
    })();
  }, []);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.bookingLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* link stays visible to copy manually */
    }
  };

  return (
    <PortalLayout title="My Referrals" greeting={data ? `${data.partner.name} · ${data.partner.code}` : undefined}>
      {error && <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}
      {!data && !error && <div className="text-center text-sm text-slate-400 py-10">Loading…</div>}
      {data && (
        <>
          <section className="grid grid-cols-3 gap-3">
            {[
              ["Leads", data.funnel.leads],
              ["Booked", data.funnel.booked],
              ["Completed", data.funnel.completed],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-white border border-slate-200 p-4 text-center">
                <div className="text-3xl font-semibold text-slate-900 leading-none">{value}</div>
                <div className="text-xs text-slate-500 mt-1.5">{label}</div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-500">Revenue</div>
                <div className="text-lg font-semibold text-slate-900">{formatCurrency(data.money.revenue)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Commission</div>
                <div className="text-lg font-semibold text-emerald-700">{formatCurrency(data.money.commission)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Pending</div>
                <div className="text-lg font-semibold text-amber-700">{formatCurrency(data.money.pending)}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">Paid out so far: <strong className="text-slate-800">{formatCurrency(data.money.paid)}</strong></div>
          </section>

          <section className="rounded-2xl bg-slate-900 text-white p-5 space-y-3">
            <div className="flex items-center gap-2 font-semibold">
              <Link2 className="h-5 w-5" /> Your referral link
            </div>
            <div className="text-xs break-all bg-white/10 rounded-lg px-3 py-2 font-mono">{data.bookingLink}</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={copy} className="h-12 rounded-xl bg-white text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Book a professional deep clean with my referral link: ${data.bookingLink}`)}`}
                target="_blank"
                rel="noreferrer"
                className="h-12 rounded-xl bg-emerald-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
              >
                <Share2 className="h-4 w-4" /> Share
              </a>
            </div>
            <p className="text-[11px] text-white/60">Customers who book through this link are attributed to you. Commission becomes eligible when the job completes and is paid after approval.</p>
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-sm">Referred services</div>
            {data.jobs.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">No referred bookings yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.jobs.map((j) => (
                  <li key={j.id} className="px-5 py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{j.serviceName ?? "Service"}</div>
                      <div className="text-xs text-slate-500">{formatDate(j.scheduledDate)}</div>
                    </div>
                    <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", j.stage === "Completed" ? "bg-emerald-50 text-emerald-700" : j.stage === "Cancelled" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700")}>{j.stage}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-sm">Commission ledger</div>
            {data.commissionEntries.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">No commission entries yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.commissionEntries.map((e) => (
                  <li key={e.id} className="px-5 py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{formatCurrency(e.commissionAmount)}</div>
                      <div className="text-xs text-slate-500">on {formatCurrency(e.bookingAmount)} · {formatDate(e.createdAt)}</div>
                    </div>
                    <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", e.status === "PAID" ? "bg-emerald-50 text-emerald-700" : e.status === "APPROVED" ? "bg-sky-50 text-sky-700" : e.status === "REVERSED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
                      {e.status === "COMMISSION_PENDING" ? "Eligible" : e.status.charAt(0) + e.status.slice(1).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-sm">Payout history</div>
            {data.payouts.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">No payouts yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.payouts.map((p) => (
                  <li key={p.id} className="px-5 py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{formatCurrency(p.amount)}</div>
                      <div className="text-xs text-slate-500">{p.method.replace("_", " ")} · {p.reference} · {formatDate(p.paidAt)}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PortalLayout>
  );
}
