"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Receipt, FileText, Landmark } from "lucide-react";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { QrImage } from "@/components/common/JobQr";
import {
  DocumentHeader,
  DocumentLineTable,
  DocumentMeta,
  DocumentParties,
  DocumentSheet,
  DocumentTerms,
  DocumentTotals,
  TaxTypeBadge,
  TotalsRow,
  SignatureArea,
  type DocumentLineRow,
} from "@/components/documents/DocumentParts";
import { cn, formatDate, formatMoney, formatTimeSlot } from "@/lib/utils";
import type { Invoice } from "@/lib/types";

/** What GET /api/invoices/[id] returns. */
export interface InvoiceDetail {
  invoice: Invoice;
  job: {
    id?: string;
    jobNumber: string;
    serviceName: string;
    serviceDate: string;
    serviceTimeSlot?: string;
    /** §5 Where the work was done — printed apart from the billing address. */
    serviceAddress?: string;
  };
  /** §3/§5 One row per service sold. Older invoices come back without lines. */
  lines?: DocumentLineRow[];
  payments?: { id: string; amount: number; paymentMethod: string; transactionReference: string; paidAt: string }[];
  customer: { name: string; address: string; gstin?: string; phone?: string; email?: string };
  company: {
    name: string;
    tagline?: string;
    address: string;
    phone: string;
    email: string;
    gstin: string;
    sacCode: string;
    logoUrl?: string;
    paymentTerms?: string;
    bankDetails?: string;
  };
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

/** GST / Non-GST chip — kept exported for the invoice list and job screens. */
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
 * §5 THE INVOICE DOCUMENT.
 *
 * A GST invoice shows both GSTINs, the SAC code, the item table and the
 * CGST / SGST (or IGST) ladder, under the heading GST INVOICE. A Non-GST
 * invoice says NON-GST INVOICE and has no GST field anywhere on the paper —
 * the rows are absent, not zeroed.
 */
export function InvoiceDocument({
  detail,
  qrUrl,
  showPayments = true,
}: {
  detail: InvoiceDetail;
  qrUrl?: string | null;
  showPayments?: boolean;
}) {
  const { invoice: inv, customer, company, job } = detail;
  const gst = inv.invoiceType === "GST";
  const taxable = Math.round((inv.subtotal - inv.discount) * 100) / 100;

  // Older invoices (and roles without line access) fall back to one line for
  // the job service, so the table is never empty.
  const lines: DocumentLineRow[] =
    detail.lines && detail.lines.length > 0
      ? detail.lines
      : [
          {
            name: job.serviceName,
            quantity: 1,
            unitPrice: inv.subtotal,
            discount: inv.discount,
            amount: taxable,
            taxable: true,
          },
        ];

  const paid = inv.amountPaid > 0;

  return (
    <DocumentSheet className="invoice-doc">
      <DocumentHeader
        company={{ ...company, gstin: gst ? company.gstin : undefined }}
        title={gst ? "GST INVOICE" : "NON-GST INVOICE"}
        subtitle={gst ? "Tax invoice" : "No GST is charged on this invoice"}
        badges={
          <>
            <TaxTypeBadge type={gst ? "GST" : "NON_GST"} />
            <PaymentStatusBadge status={inv.status} />
          </>
        }
      />

      <DocumentMeta
        items={[
          { label: "Invoice number", value: inv.invoiceNumber, mono: true },
          { label: "Invoice date", value: formatDate(inv.issuedAt) },
          { label: "Job ID", value: job.jobNumber, mono: true },
          { label: "Due date", value: formatDate(inv.dueDate) },
        ]}
      />

      <DocumentParties
        customer={customer}
        showGstin={gst}
        serviceAddress={job.serviceAddress}
        extra={
          <div className={cn(job.serviceAddress && "mt-3")}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service</h3>
            <div className="mt-1 text-sm font-semibold text-zinc-950 break-words">{job.serviceName}</div>
            <div className="text-sm text-zinc-600">
              {formatDate(job.serviceDate)}
              {job.serviceTimeSlot ? ` · ${formatTimeSlot(job.serviceTimeSlot)}` : ""}
            </div>
            {gst && company.sacCode && <div className="text-sm text-zinc-600">SAC: {company.sacCode}</div>}
            {gst && (
              <div className="text-sm text-zinc-600">
                Supply: {inv.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}
              </div>
            )}
          </div>
        }
      />

      <DocumentLineTable lines={lines} gst={gst} gstRate={inv.gstRate} />

      <DocumentTotals
        gst={gst}
        subtotal={inv.subtotal}
        discount={inv.discount}
        taxable={taxable}
        gstRate={inv.gstRate}
        cgst={inv.cgst}
        sgst={inv.sgst}
        igst={inv.igst}
        totalGst={inv.tax}
        total={inv.total}
        interState={inv.interState}
      >
        {showPayments && (
          <>
            <TotalsRow label="Paid" value={formatMoney(inv.amountPaid)} />
            <TotalsRow label="Balance due" value={formatMoney(inv.balanceDue)} strong={inv.balanceDue > 0} />
          </>
        )}
      </DocumentTotals>

      {showPayments && detail.payments && detail.payments.length > 0 && (
        <section className="doc-keep">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Payments received</h3>
          <ul className="mt-1.5 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {detail.payments.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-zinc-600">
                  {formatDate(p.paidAt)} · {p.paymentMethod.replace(/_/g, " ")}
                  {p.transactionReference ? ` · ${p.transactionReference}` : ""}
                </span>
                <span className="tabular-nums font-medium text-zinc-900">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DocumentTerms
        items={[
          { label: "Payment terms", body: company.paymentTerms },
          { label: "Notes", body: gst ? null : "No GST is charged on this invoice." },
        ]}
      />

      {showPayments && company.bankDetails && inv.balanceDue > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 doc-keep">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <Landmark className="h-3.5 w-3.5" aria-hidden /> Payment details
          </h3>
          <p className="mt-1 text-sm text-zinc-700 whitespace-pre-line break-words">{company.bankDetails}</p>
        </section>
      )}

      {qrUrl && (
        <section className="flex items-center gap-4 rounded-xl border border-zinc-200 p-4 doc-keep">
          <QrImage value={qrUrl} size={112} label="QR code to view this service" />
          <div className="min-w-0">
            <div className="text-base font-semibold text-zinc-950">Scan QR to View Service</div>
            <p className="text-sm text-zinc-600">
              Status, before/after photos, quality check, this invoice, approval and feedback — one secure page.
            </p>
          </div>
        </section>
      )}

      <SignatureArea companyName={company.name || ""} />

      <footer className="text-xs text-zinc-500 pt-2 border-t border-zinc-200">
        {gst
          ? "This is a computer-generated tax invoice."
          : "This is a computer-generated invoice. No GST is charged on this invoice."}
        {paid && inv.balanceDue <= 0 ? " Paid in full — thank you." : ""}
      </footer>
    </DocumentSheet>
  );
}
