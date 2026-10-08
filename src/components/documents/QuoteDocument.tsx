"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, FileSignature, XCircle } from "lucide-react";
import {
  DocumentHeader,
  DocumentLineTable,
  DocumentMeta,
  DocumentParties,
  DocumentSheet,
  DocumentTerms,
  DocumentTotals,
  TaxTypeBadge,
  type DocumentLineRow,
} from "@/components/documents/DocumentParts";
import { formatDuration } from "@/lib/documents";
import { cn, formatDate } from "@/lib/utils";

/** What GET /api/quotes/[id] returns. */
export interface QuoteDetail {
  quote: {
    id: string;
    quoteNumber: string;
    createdAt: string;
    validUntil: string;
    status: "draft" | "sent" | "accepted" | "declined" | "converted_to_job";
    invoiceType: "GST" | "NON_GST";
    subtotal: number;
    discount: number;
    taxable: number;
    gstRate: number;
    cgst: number;
    sgst: number;
    igst: number;
    interState: boolean;
    tax: number;
    total: number;
    paymentTerms: string;
    serviceTerms: string;
    notes: string;
    acceptedAt: string | null;
    acceptedBy: string | null;
    jobId: string | null;
    jobNumber: string | null;
    lines: (DocumentLineRow & { durationHours?: number })[];
  };
  customer: { name: string; phone: string; email: string; address: string; gstin?: string };
  serviceAddress: string;
  propertyTitle: string;
  company: {
    name: string;
    tagline: string;
    address: string;
    phone: string;
    email: string;
    gstin: string;
    sacCode: string;
    logoUrl: string;
    paymentTerms: string;
    serviceTerms: string;
    bankDetails: string;
  };
}

export function useQuoteDetail(id: string | undefined) {
  const [data, setData] = useState<QuoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(res.status === 404 ? "This quotation was not found." : json?.error || "Could not load the quotation.");
      } else {
        setData(json.data);
      }
    } catch {
      setError("You are offline. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

const STATUS_LOOK: Record<
  QuoteDetail["quote"]["status"],
  { label: string; className: string; icon: React.ElementType }
> = {
  draft: { label: "Draft", className: "border-zinc-200 bg-zinc-100 text-zinc-700", icon: FileSignature },
  sent: { label: "Awaiting acceptance", className: "border-amber-200 bg-amber-50 text-amber-800", icon: Clock },
  accepted: { label: "Accepted", className: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
  declined: { label: "Declined", className: "border-red-200 bg-red-50 text-red-800", icon: XCircle },
  converted_to_job: { label: "Booked as a job", className: "border-info-200 bg-info-50 text-info-700", icon: CheckCircle2 },
};

export function QuoteStatusBadge({ status, className }: { status: QuoteDetail["quote"]["status"]; className?: string }) {
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.sent;
  const Icon = look.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        look.className,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {look.label}
    </span>
  );
}

/** Days left on the quotation, or null once it has lapsed. */
function validityNote(validUntil: string, status: QuoteDetail["quote"]["status"]): string {
  if (status === "converted_to_job") return "Converted into a job.";
  if (status === "declined") return "This quotation was declined.";
  const end = new Date(`${validUntil}T23:59:59`);
  const days = Math.ceil((end.getTime() - Date.now()) / (24 * 3600 * 1000));
  if (Number.isNaN(days)) return "";
  if (days < 0) return `This quotation expired on ${formatDate(validUntil)}.`;
  if (days === 0) return "Valid until the end of today.";
  return `Valid for ${days} more day${days === 1 ? "" : "s"}, until ${formatDate(validUntil)}.`;
}

/**
 * §4 THE QUOTATION DOCUMENT.
 *
 * The company letterhead, the quotation number and validity, the customer and
 * the service address, the priced service table, the GST ladder (absent
 * entirely on a Non-GST quotation), the terms, and the customer acceptance
 * block at the foot.
 */
export function QuoteDocument({ detail }: { detail: QuoteDetail }) {
  const { quote: q, customer, company, serviceAddress } = detail;
  const gst = q.invoiceType === "GST";
  const totalDuration = q.lines.reduce((a, l) => a + (l.durationHours ?? 0) * l.quantity, 0);

  return (
    <DocumentSheet>
      <DocumentHeader
        company={{ ...company, gstin: gst ? company.gstin : undefined }}
        title="QUOTATION"
        subtitle={gst ? "Prices include GST as shown" : "No GST is charged on this quotation"}
        badges={
          <>
            <TaxTypeBadge type={gst ? "GST" : "NON_GST"} />
            <QuoteStatusBadge status={q.status} />
          </>
        }
      />

      <DocumentMeta
        items={[
          { label: "Quotation number", value: q.quoteNumber, mono: true },
          { label: "Quotation date", value: formatDate(q.createdAt) },
          { label: "Valid until", value: formatDate(q.validUntil) },
          ...(q.jobNumber ? [{ label: "Job ID", value: q.jobNumber, mono: true }] : []),
        ]}
      />

      <DocumentParties
        customer={customer}
        showGstin={gst}
        billingLabel="Quotation for"
        serviceAddress={serviceAddress}
        serviceLabel="Service / property address"
        extra={
          totalDuration > 0 ? (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Estimated duration</h3>
              <div className="mt-1 text-sm font-semibold text-zinc-950">{formatDuration(totalDuration)}</div>
            </div>
          ) : null
        }
      />

      <DocumentLineTable lines={q.lines} gst={gst} gstRate={q.gstRate} />

      <DocumentTotals
        gst={gst}
        subtotal={q.subtotal}
        discount={q.discount}
        taxable={q.taxable}
        gstRate={q.gstRate}
        cgst={q.cgst}
        sgst={q.sgst}
        igst={q.igst}
        totalGst={q.tax}
        total={q.total}
        interState={q.interState}
      />

      <p className="text-sm text-zinc-600">{validityNote(q.validUntil, q.status)}</p>

      <DocumentTerms
        items={[
          { label: "Payment terms", body: q.paymentTerms },
          { label: "Service terms", body: q.serviceTerms },
          { label: "Notes", body: q.notes },
        ]}
      />

      {/* Customer acceptance — the record of who accepted, and when. */}
      <section className="rounded-xl border border-zinc-200 px-4 py-4 doc-keep">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Customer acceptance</h3>
        {q.acceptedAt ? (
          <p className="mt-1 text-sm text-emerald-800">
            Accepted by <strong>{q.acceptedBy || "the customer"}</strong> on {formatDate(q.acceptedAt)}.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-600">
              I accept this quotation and authorise the work described above.
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="h-10" />
                <div className="border-t border-zinc-400 pt-1.5 text-sm text-zinc-700">Customer signature</div>
              </div>
              <div>
                <div className="h-10" />
                <div className="border-t border-zinc-400 pt-1.5 text-sm text-zinc-700">Name &amp; date</div>
              </div>
            </div>
          </>
        )}
      </section>

      <footer className="text-xs text-zinc-500 pt-2 border-t border-zinc-200">
        This is a computer-generated quotation from {company.name || "us"}.
        {gst ? "" : " No GST is charged on this quotation."}
      </footer>
    </DocumentSheet>
  );
}
