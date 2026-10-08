"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, BarChart3 } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { InvoiceTypeBadge } from "@/components/invoice/InvoiceDocument";
import { useGstReport, periodRange } from "@/components/gst/useGstReport";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { InvoiceRow } from "@/components/invoice/InvoiceList";

type Period = "month" | "quarter" | "fy";

/** Tax Officer home: this period's GST at a glance + the latest GST invoices. */
export default function GstDashboardPage() {
  const { currentUser } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const { from, to } = periodRange(period);
  const { data, error, reload } = useGstReport(from, to);
  const [recent, setRecent] = useState<InvoiceRow[] | null>(null);

  useEffect(() => {
    fetch("/api/invoices?type=GST", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRecent(j?.success ? j.data.invoices.slice(0, 5) : []))
      .catch(() => setRecent([]));
  }, []);

  const t = data?.totals;
  const metrics = t
    ? [
        { label: "GST invoices", value: String(t.invoices) },
        { label: "Taxable value", value: formatMoney(t.taxable) },
        { label: "Total GST", value: formatMoney(t.totalGst) },
        { label: "Grand total", value: formatMoney(t.grandTotal) },
      ]
    : [];

  return (
    <AdminLayout>
      <PageHeader
        title="GST Dashboard"
        description={`Hello ${currentUser?.name?.split(" ")[0] ?? ""} — GST invoices only.`}
        actions={
          <div className="inline-flex rounded-xl bg-zinc-100 p-1" role="radiogroup" aria-label="Period">
            {([["month", "This month"], ["quarter", "This quarter"], ["fy", "This FY"]] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={period === k} onClick={() => setPeriod(k)} className={cn("min-h-10 px-3 rounded-lg text-sm font-medium", period === k ? "bg-white shadow-sm font-semibold text-zinc-950" : "text-zinc-600")}>
                {l}
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !t ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-zinc-500">{formatDate(from)} – {formatDate(to)}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 min-w-0">
                <div className="text-sm text-zinc-500">{m.label}</div>
                <div className="text-lg sm:text-2xl font-semibold text-zinc-950 mt-1 break-words tabular-nums">{m.value}</div>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-950 mb-3">GST breakdown</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[["CGST", t.cgst], ["SGST", t.sgst], ["IGST", t.igst]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-zinc-50 px-4 py-3 flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-zinc-600">{k}</dt>
                  <dd className="text-base font-semibold text-zinc-950 tabular-nums">{formatMoney(v as number)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/gst/invoices" className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 hover:shadow-md transition-shadow min-h-[72px]">
              <FileText className="h-6 w-6 text-rose-500 shrink-0" aria-hidden />
              <span className="flex-1"><span className="block text-base font-semibold text-zinc-950">GST Invoices</span><span className="text-sm text-zinc-500">Search, filter, view and print</span></span>
              <ChevronRight className="h-5 w-5 text-zinc-400" aria-hidden />
            </Link>
            <Link href="/gst/reports" className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 hover:shadow-md transition-shadow min-h-[72px]">
              <BarChart3 className="h-6 w-6 text-rose-500 shrink-0" aria-hidden />
              <span className="flex-1"><span className="block text-base font-semibold text-zinc-950">GST Reports</span><span className="text-sm text-zinc-500">Month-wise GST summary</span></span>
              <ChevronRight className="h-5 w-5 text-zinc-400" aria-hidden />
            </Link>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-950">Latest GST invoices</h2>
            {recent === null ? (
              <SkeletonList rows={3} />
            ) : recent.length === 0 ? (
              <p className="text-sm text-zinc-500">No GST invoices yet.</p>
            ) : (
              <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/gst/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3 min-h-[64px] hover:bg-zinc-50">
                      <span className="flex-1 min-w-0">
                        <span className="block font-mono text-sm font-semibold text-zinc-950 break-all">{r.invoiceNumber}</span>
                        <span className="block text-sm text-zinc-500 truncate">{r.customerName} · {formatDate(r.issuedAt)}</span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-sm font-semibold text-zinc-950 tabular-nums">{formatMoney(r.total)}</span>
                        <InvoiceTypeBadge type={r.invoiceType} className="mt-1" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
