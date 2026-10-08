"use client";

import React from "react";
import { InvoiceTypeBadge } from "@/components/invoice/InvoiceDocument";
import { QuoteStatusBadge } from "@/components/quote/QuoteParts";
import { DocHeader, DocFacts, DocParty, ItemsTable, TotalsTable, DocTerms, DocSignature, type DocCompany } from "@/components/document/DocParts";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Quote } from "@/lib/types";

export interface QuoteDetail {
  quote: Quote;
  customer: { name: string; phone?: string; email?: string; address?: string | null; gstin?: string | null };
  property: { title: string; address: string } | null;
  company: DocCompany;
}

/**
 * The printable quotation: logo and company details, number and dates,
 * customer and property, the service table, totals (GST rows only on a GST
 * quotation), payment terms, terms & conditions and the authorized signature.
 */
export function QuotationDocument({ detail }: { detail: QuoteDetail }) {
  const { quote: q, customer, property, company } = detail;
  const gst = q.quoteType === "GST";
  return (
    <article className="invoice-doc rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 shadow-sm space-y-6 print:shadow-none print:border-0 print:p-0">
      <DocHeader company={company} showGstin={gst} title="QUOTATION" chips={<><InvoiceTypeBadge type={q.quoteType} /><QuoteStatusBadge status={q.status} /></>} />

      <DocFacts
        facts={[
          { label: "Quotation number", value: q.quoteNumber, mono: true },
          { label: "Date", value: formatDate(q.createdAt) },
          { label: "Valid until", value: formatDate(q.validUntil) },
        ]}
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DocParty heading="Prepared for">
          <div className="text-base font-semibold text-zinc-950">{customer.name}</div>
          {customer.address && <div>{customer.address}</div>}
          {customer.phone && <div>{customer.phone}</div>}
          {gst && <div className="text-zinc-900"><span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{q.customerGstin || customer.gstin || "Unregistered"}</span></div>}
        </DocParty>
        <DocParty heading="Property / location">
          {property ? (
            <>
              <div className="text-zinc-900 font-medium">{property.title}</div>
              <div>{property.address}</div>
            </>
          ) : (
            <div>To be confirmed</div>
          )}
          {gst && company.sacCode && <div>SAC: {company.sacCode}</div>}
          {gst && <div>Supply: {q.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>}
        </DocParty>
      </section>

      <ItemsTable items={q.items} />

      <TotalsTable gst={gst} subtotal={q.subtotal} discount={q.discount} gstRate={q.gstRate} interState={q.interState} cgst={q.cgst} sgst={q.sgst} igst={q.igst} tax={q.tax} total={q.total} />

      <DocTerms
        blocks={[
          { heading: "Payment terms", text: q.paymentTerms },
          { heading: "Notes", text: q.notes },
          { heading: "Terms & conditions", text: q.terms },
        ]}
      />

      <div className="flex flex-col-reverse sm:flex-row sm:items-end sm:justify-between gap-6">
        <div className="text-sm text-zinc-600">
          {q.acceptedAt ? (
            <>
              <div className="font-semibold text-emerald-800">Accepted</div>
              <div>{q.acceptedBy} · {formatDateTime(q.acceptedAt)}</div>
            </>
          ) : (
            <>
              <div className="font-semibold text-zinc-800">Customer acceptance</div>
              <div className="mt-8 border-t border-zinc-300 pt-1 w-48">Name, signature &amp; date</div>
            </>
          )}
        </div>
        <DocSignature company={company} />
      </div>

      <footer className="text-xs text-zinc-500">
        This quotation is valid until {formatDate(q.validUntil)}. {gst ? "GST as applicable is shown above." : "No GST is charged on this quotation."}
      </footer>
    </article>
  );
}
