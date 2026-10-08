"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Receipt, FileText } from "lucide-react";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { QrImage } from "@/components/common/JobQr";
import { DocHeader, DocFacts, DocParty, ItemsTable, TotalsTable, TotalsRow, DocTerms, DocSignature, type DocCompany } from "@/components/document/DocParts";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { Invoice, QuoteLine } from "@/lib/types";

/** What GET /api/invoices/[id] returns. */
export interface InvoiceDetail {
  invoice: Invoice;
  job: { id?: string; jobNumber: string; serviceName: string; serviceDate: string };
  customer: { name: string; address: string; serviceAddress?: string; gstin?: string; phone?: string; email?: string };
  company: DocCompany;
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

/**
 * The printable invoice: logo and company, Job ID, bill-to and service
 * address, the service table, totals, payment status and terms, notes and
 * the authorized signature. A GST invoice shows GSTINs and the CGST / SGST /
 * IGST breakdown; a Non-GST invoice shows NO GST fields at all.
 */
export function InvoiceDocument({ detail, qrUrl, showPayments = true }: { detail: InvoiceDetail; qrUrl?: string | null; showPayments?: boolean }) {
  const { invoice: inv, customer, company, job } = detail;
  const gst = inv.invoiceType === "GST";
  const items: QuoteLine[] = inv.items?.length
    ? inv.items
    : [{ description: job.serviceName, quantity: 1, rate: inv.subtotal, amount: inv.subtotal, custom: false }];

  return (
    <article className="invoice-doc rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 shadow-sm space-y-6 print:shadow-none print:border-0 print:p-0">
      <DocHeader
        company={company}
        showGstin={gst}
        title={gst ? "TAX INVOICE" : "INVOICE"}
        chips={<><InvoiceTypeBadge type={inv.invoiceType} /><PaymentStatusBadge status={inv.status} /></>}
      />

      <DocFacts
        facts={[
          { label: "Invoice number", value: inv.invoiceNumber, mono: true },
          { label: "Invoice date", value: formatDate(inv.issuedAt) },
          { label: "Job ID", value: job.jobNumber, mono: true },
        ]}
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DocParty heading="Bill to">
          <div className="text-base font-semibold text-zinc-950">{customer.name}</div>
          {customer.address && <div>{customer.address}</div>}
          {customer.phone && <div>{customer.phone}</div>}
          {gst && <div className="text-zinc-900"><span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{customer.gstin || "Unregistered"}</span></div>}
        </DocParty>
        <DocParty heading="Service address">
          {customer.serviceAddress && <div className="text-zinc-900">{customer.serviceAddress}</div>}
          <div>Service date: {formatDate(job.serviceDate)}</div>
          {gst && company.sacCode && <div>SAC: {company.sacCode}</div>}
          {gst && <div>Supply: {inv.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>}
        </DocParty>
      </section>

      <ItemsTable items={items} />

      <TotalsTable
        gst={gst}
        subtotal={inv.subtotal}
        discount={inv.discount}
        gstRate={inv.gstRate}
        interState={inv.interState}
        cgst={inv.cgst}
        sgst={inv.sgst}
        igst={inv.igst}
        tax={inv.tax}
        total={inv.total}
        extra={
          showPayments ? (
            <>
              <TotalsRow label="Paid" value={formatMoney(inv.amountPaid)} />
              <TotalsRow label="Balance due" value={formatMoney(inv.balanceDue)} />
            </>
          ) : null
        }
      />

      <DocTerms
        blocks={[
          { heading: "Payment terms", text: inv.paymentTerms },
          { heading: "Notes", text: inv.notes },
        ]}
      />

      <DocSignature company={company} />

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
