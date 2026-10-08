"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Receipt, FileText } from "lucide-react";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { QrImage } from "@/components/common/JobQr";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { Invoice } from "@/lib/types";

/** What GET /api/invoices/[id] returns. */
export interface InvoiceDetail {
  invoice: Invoice;
  job: { id?: string; jobNumber: string; serviceName: string; serviceDate: string };
  customer: { name: string; address: string; gstin?: string; phone?: string; email?: string };
  company: { name: string; address: string; phone: string; email: string; gstin: string; sacCode: string };
}

export function useInvoiceDetail(id: string | undefined) {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(res.status === 404 ? "This invoice was not found." : json?.error || "Could not load the invoice.");
      else setData(json.data);
    } catch {
      setError("You're offline. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

/** GST / Non-GST chip — text, not colour alone. */
export function InvoiceTypeBadge({ type, className }: { type: Invoice["invoiceType"]; className?: string }) {
  const gst = type === "GST";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", gst ? "border-info-200 bg-info-50 text-info-700" : "border-zinc-200 bg-zinc-100 text-zinc-700", className)}>
      {gst ? <Receipt className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
      {gst ? "GST" : "Non-GST"}
    </span>
  );
}

const Row = ({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) => (
  <div className={cn("flex items-baseline justify-between gap-4 px-4 py-2.5", strong && "bg-zinc-50")}>
    <dt className={cn("text-sm", strong ? "font-semibold text-zinc-950" : muted ? "text-zinc-400" : "text-zinc-600")}>{label}</dt>
    <dd className={cn("text-right tabular-nums", strong ? "text-lg font-semibold text-zinc-950" : "text-sm font-medium text-zinc-900")}>{value}</dd>
  </div>
);

/**
 * The printable invoice. A GST invoice shows GSTINs and the CGST / SGST /
 * IGST breakdown; a Non-GST invoice shows NO GST fields at all — just the
 * amount and the grand total.
 */
export function InvoiceDocument({ detail, qrUrl, showPayments = true }: { detail: InvoiceDetail; qrUrl?: string | null; showPayments?: boolean }) {
  const { invoice: inv, customer, company, job } = detail;
  const gst = inv.invoiceType === "GST";
  const taxable = Math.round((inv.subtotal - inv.discount) * 100) / 100;
  const half = inv.gstRate / 2;

  return (
    <article className="invoice-doc rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 shadow-sm space-y-6 print:shadow-none print:border-0 print:p-0">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-zinc-950">{company.name || "Intense Care"}</div>
          {company.address && <div className="text-sm text-zinc-600 whitespace-pre-line break-words">{company.address}</div>}
          {(company.phone || company.email) && <div className="text-sm text-zinc-600 break-words">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>}
          {gst && company.gstin && <div className="text-sm text-zinc-900 mt-1"><span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{company.gstin}</span></div>}
        </div>
        <div className="sm:text-right shrink-0">
          <div className="text-xl font-semibold tracking-tight text-zinc-950">{gst ? "TAX INVOICE" : "INVOICE"}</div>
          <div className="mt-1 flex sm:justify-end gap-2 flex-wrap">
            <InvoiceTypeBadge type={inv.invoiceType} />
            <PaymentStatusBadge status={inv.status} />
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-xl bg-zinc-50 px-4 py-3"><dt className="text-zinc-500">Invoice number</dt><dd className="font-mono font-semibold text-zinc-950 break-all">{inv.invoiceNumber}</dd></div>
        <div className="rounded-xl bg-zinc-50 px-4 py-3"><dt className="text-zinc-500">Invoice date</dt><dd className="font-semibold text-zinc-950">{formatDate(inv.issuedAt)}</dd></div>
        <div className="rounded-xl bg-zinc-50 px-4 py-3"><dt className="text-zinc-500">Job ID</dt><dd className="font-mono font-semibold text-zinc-950 break-all">{job.jobNumber}</dd></div>
      </dl>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Bill to</h3>
          <div className="mt-1 text-base font-semibold text-zinc-950 break-words">{customer.name}</div>
          {customer.address && <div className="text-sm text-zinc-600 break-words">{customer.address}</div>}
          {customer.phone && <div className="text-sm text-zinc-600">{customer.phone}</div>}
          {gst && <div className="text-sm text-zinc-900 mt-1"><span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{customer.gstin || "Unregistered"}</span></div>}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service</h3>
          <div className="mt-1 text-base font-semibold text-zinc-950 break-words">{job.serviceName}</div>
          <div className="text-sm text-zinc-600">Service date: {formatDate(job.serviceDate)}</div>
          {gst && company.sacCode && <div className="text-sm text-zinc-600">SAC: {company.sacCode}</div>}
          {gst && <div className="text-sm text-zinc-600">Supply: {inv.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>}
        </div>
      </section>

      <dl className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
        {gst ? (
          <>
            <Row label="Service amount" value={formatMoney(inv.subtotal)} />
            {inv.discount > 0 && <Row label="Discount" value={`− ${formatMoney(inv.discount)}`} />}
            <Row label="Taxable amount" value={formatMoney(taxable)} />
            <Row label="GST %" value={`${inv.gstRate}%`} />
            {inv.interState ? (
              <Row label={`IGST @ ${inv.gstRate}%`} value={formatMoney(inv.igst)} />
            ) : (
              <>
                <Row label={`CGST @ ${half}%`} value={formatMoney(inv.cgst)} />
                <Row label={`SGST @ ${half}%`} value={formatMoney(inv.sgst)} />
              </>
            )}
            <Row label="Total GST" value={formatMoney(inv.tax)} />
            <Row label="Grand total" value={formatMoney(inv.total)} strong />
          </>
        ) : (
          <>
            <Row label="Amount" value={formatMoney(inv.subtotal)} />
            {inv.discount > 0 && <Row label="Discount" value={`− ${formatMoney(inv.discount)}`} />}
            <Row label="Grand total" value={formatMoney(inv.total)} strong />
          </>
        )}
        {showPayments && (
          <>
            <Row label="Paid" value={formatMoney(inv.amountPaid)} />
            <Row label="Balance due" value={formatMoney(inv.balanceDue)} />
          </>
        )}
      </dl>

      {qrUrl && (
        <section className="flex items-center gap-4 rounded-xl border border-zinc-200 p-4 break-inside-avoid">
          <QrImage value={qrUrl} size={112} label="QR code to view this service" />
          <div className="min-w-0">
            <div className="text-base font-semibold text-zinc-950">Scan QR to View Service</div>
            <p className="text-sm text-zinc-600">Status, before/after photos, quality check, this invoice, approval and feedback — one secure page.</p>
          </div>
        </section>
      )}

      <footer className="text-xs text-zinc-500">
        {gst ? "This is a computer-generated tax invoice." : "This is a computer-generated invoice. No GST is charged on this invoice."}
      </footer>
    </article>
  );
}
