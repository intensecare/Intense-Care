"use client";

import React from "react";
import { InvoiceTypeBadge } from "@/components/invoice/InvoiceDocument";
import { QuoteStatusBadge } from "@/components/quote/QuoteParts";
import {
  DocFrame,
  DocCompanyMeta,
  DocParty,
  DocParties,
  ItemsTable,
  TotalsBand,
  AmountInWordsBand,
  DocTerms,
  DocSignature,
  TwoColRow,
  type DocCompany,
} from "@/components/document/DocParts";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Quote } from "@/lib/types";

export interface QuoteDetail {
  quote: Quote;
  customer: { name: string; phone?: string; email?: string; address?: string | null; gstin?: string | null };
  property: { title: string; address: string } | null;
  company: DocCompany;
}

/**
 * The printable quotation, in the same ruled-ledger format as the invoice:
 * logo and company identity beside the quotation's key facts, who it is for
 * and where the work happens, the itemised service table, the GST breakup
 * and totals ribbon (GST rows only on a GST quotation), the amount in words,
 * the customer's acceptance, and terms and the authorized signature.
 */
export function QuotationDocument({ detail }: { detail: QuoteDetail }) {
  const { quote: q, customer, property, company } = detail;
  const gst = q.quoteType === "GST";
  return (
    <div className="space-y-3">
      <DocFrame title="QUOTATION" chips={<><InvoiceTypeBadge type={q.quoteType} /><QuoteStatusBadge status={q.status} /></>}>
        <DocCompanyMeta
          company={company}
          showGstin={gst}
          meta={[
            { label: "Quotation No.", value: q.quoteNumber, mono: true },
            { label: "Date", value: formatDate(q.createdAt) },
            { label: "Valid Until", value: formatDate(q.validUntil) },
          ]}
        />

        <DocParties>
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
            {gst && <div>Supply: {q.interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>}
          </DocParty>
        </DocParties>

        <ItemsTable items={q.items} gst={gst} gstRate={q.gstRate} sacCode={company.sacCode} />

        <TotalsBand gst={gst} subtotal={q.subtotal} discount={q.discount} gstRate={q.gstRate} interState={q.interState} cgst={q.cgst} sgst={q.sgst} igst={q.igst} tax={q.tax} total={q.total} />

        <AmountInWordsBand total={q.total} />

        <div className="border-b-2 border-zinc-800 p-4 text-sm text-zinc-700">
          {q.acceptedAt ? (
            <>
              <div className="font-semibold text-emerald-800">Accepted by the customer</div>
              <div>{q.acceptedBy} · {formatDateTime(q.acceptedAt)}</div>
            </>
          ) : (
            <>
              <div className="font-semibold text-zinc-800">Customer acceptance</div>
              <div className="mt-6 inline-block border-t border-zinc-400 pt-1 min-w-[12rem]">Name, signature &amp; date</div>
            </>
          )}
        </div>

        <TwoColRow
          last
          left={<DocTerms blocks={[{ heading: "Payment terms", text: q.paymentTerms }, { heading: "Notes", text: q.notes }, { heading: "Terms & conditions", text: q.terms }]} />}
          right={<DocSignature company={company} />}
        />
      </DocFrame>

      <p className="text-xs text-zinc-500 px-1">
        This quotation is valid until {formatDate(q.validUntil)}. {gst ? "GST as applicable is shown above." : "No GST is charged on this quotation."}
      </p>
    </div>
  );
}
