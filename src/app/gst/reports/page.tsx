"use client";

import React, { useState } from "react";
import { Download, Printer, BarChart3 } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGstReport, periodRange, monthLabel, type GstBucket } from "@/components/gst/useGstReport";
import { formatMoney } from "@/lib/utils";

/** Month-wise GST summary (GST invoices only), downloadable as CSV. */
export default function GstReportsPage() {
  const fy = periodRange("fy");
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const { data, error, reload } = useGstReport(from, to);

  const downloadCsv = () => {
    if (!data) return;
    const head = ["Month", "GST invoices", "Taxable value", "CGST", "SGST", "IGST", "Total GST", "Grand total"];
    const line = (b: GstBucket, label: string) => [label, b.invoices, b.taxable, b.cgst, b.sgst, b.igst, b.totalGst, b.grandTotal].join(",");
    const csv = [head.join(","), ...data.months.map((b) => line(b, monthLabel(b.month))), line(data.totals, "Total")].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gst-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <PageHeader title="GST Reports" description="Month-wise GST from GST invoices. Non-GST invoices are never included." />

      <div className="print:hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <span className="w-12 shrink-0">From</span>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <span className="w-12 shrink-0">To</span>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        <Button variant="outline" onClick={downloadCsv} disabled={!data || data.totals.invoices === 0}><Download className="h-4 w-4" aria-hidden /> Download CSV</Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!data}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <SkeletonList rows={3} />
      ) : data.totals.invoices === 0 ? (
        <EmptyState icon={BarChart3} title="No GST invoices in this period" description="Pick a different date range." />
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-950 mb-3">Total for the period</h2>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ["GST invoices", String(data.totals.invoices)],
                ["Taxable value", formatMoney(data.totals.taxable)],
                ["CGST", formatMoney(data.totals.cgst)],
                ["SGST", formatMoney(data.totals.sgst)],
                ["IGST", formatMoney(data.totals.igst)],
                ["Total GST", formatMoney(data.totals.totalGst)],
                ["Grand total", formatMoney(data.totals.grandTotal)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-zinc-50 px-4 py-3 min-w-0">
                  <dt className="text-sm text-zinc-500">{k}</dt>
                  <dd className="text-base sm:text-lg font-semibold text-zinc-950 tabular-nums break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <DataTable
            caption="GST by month"
            rows={data.months}
            rowKey={(b) => b.month}
            columns={[
              { key: "m", header: "Month", mobile: "title", cell: (b) => monthLabel(b.month) },
              { key: "n", header: "Invoices", align: "right", cell: (b) => b.invoices },
              { key: "tx", header: "Taxable", align: "right", cell: (b) => formatMoney(b.taxable) },
              { key: "c", header: "CGST", align: "right", cell: (b) => formatMoney(b.cgst) },
              { key: "s", header: "SGST", align: "right", cell: (b) => formatMoney(b.sgst) },
              { key: "i", header: "IGST", align: "right", cell: (b) => formatMoney(b.igst) },
              { key: "g", header: "Total GST", align: "right", cell: (b) => <span className="font-semibold">{formatMoney(b.totalGst)}</span> },
              { key: "t", header: "Grand total", align: "right", cell: (b) => formatMoney(b.grandTotal) },
            ]}
          />
        </div>
      )}
    </AdminLayout>
  );
}
