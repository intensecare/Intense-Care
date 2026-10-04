"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Quote, Customer, Property, Service, SystemSettings } from "@/lib/types";
import { formatCurrency, formatDate, amountInWords, buildWhatsAppShareUrl } from "@/lib/utils";
import { getTaxRate, getGstin } from "@/lib/tax";
import { Printer, X, FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PRINT_ROOT_ID = "print-root-quotation";

interface QuotePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: Quote;
  customer?: Customer;
  property?: Property;
  service?: Service;
  systemSettings?: SystemSettings;
}

/**
 * Printable quotation document: company identity and the exact line items the
 * desk priced, with the configured tax. Shareable over WhatsApp (summary text;
 * attach the saved PDF) and print-isolated on A4 like the tax invoice.
 */
export function QuotePreviewModal({
  isOpen,
  onClose,
  quote,
  customer,
  property,
  service,
  systemSettings,
}: QuotePreviewModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const style = document.createElement("style");
    style.id = `${PRINT_ROOT_ID}-style`;
    style.textContent = `
      @media print {
        body { overflow: visible !important; }
        body > *:not([data-print-overlay]) { display: none !important; }
        [data-print-overlay] {
          position: static !important;
          inset: auto !important;
          display: block !important;
          background: transparent !important;
          backdrop-filter: none !important;
          padding: 0 !important;
          margin: 0 !important;
          overflow: visible !important;
        }
        #${PRINT_ROOT_ID} {
          position: static !important;
          max-width: none !important;
          max-height: none !important;
          width: 100% !important;
          margin: 0 !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          overflow: visible !important;
        }
        html, body {
          width: auto !important;
          min-width: 0 !important;
          background: #fff !important;
        }
        #${PRINT_ROOT_ID} .print-scroll {
          max-height: none !important;
          overflow: visible !important;
          /* The page frame lives INSIDE the content: the print dialog's margin
             override (e.g. a sticky "None") cannot strip it, so the document
             can never render flush to — or beyond — the paper edge. */
          padding: 14mm !important;
        }
        /* Full-bleed page: the document supplies its own margins. Chrome also
           suppresses its header/footer UI when the @page margin is 0. */
        @page { size: A4 portrait; margin: 0; }
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add("overflow-hidden");
    return () => {
      style.remove();
      document.body.classList.remove("overflow-hidden");
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  const companyName = systemSettings?.companyName?.trim() || "Intense Care";
  const companyTagline = systemSettings?.companyTagline?.trim() || "";
  const companyAddress = systemSettings?.companyAddress?.trim() || "";
  const companyPhone = systemSettings?.companyPhone?.trim() || "";
  const companyEmail = systemSettings?.companyEmail?.trim() || "";
  const gstin = systemSettings ? getGstin(systemSettings) : "";
  const taxName = systemSettings?.taxLabel?.trim() || "GST";
  const taxPct = Math.round(getTaxRate(systemSettings ?? { taxRatePercent: 0 }) * 10000) / 100;

  const items = quote.items.length > 0
    ? quote.items
    : [{ description: service?.name || "Cleaning services", quantity: 1, unitPrice: quote.subtotal, amount: quote.subtotal }];

  const words = amountInWords(quote.total);
  const isExpired = new Date(quote.validUntil).getTime() < Date.now();

  const whatsappMessage = [
    `*${companyName}* — Quotation ${quote.quoteNumber}`,
    customer ? `Prepared for: ${customer.name}` : "",
    ...items.map((it) => `• ${it.description} × ${it.quantity} — ${formatCurrency(it.amount)}`),
    `Total: ${formatCurrency(quote.total)}`,
    `This quotation is valid until ${formatDate(quote.validUntil)}.`,
    "",
    "Reply here to confirm your booking — the detailed quotation PDF is attached.",
  ]
    .filter(Boolean)
    .join("\n");
  const whatsappUrl = buildWhatsAppShareUrl(customer?.whatsapp || customer?.phone, whatsappMessage);

  return createPortal(
    <div data-print-overlay="true" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        id={PRINT_ROOT_ID}
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col"
      >
        {/* Modal action bar (hidden on print) */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between print:hidden shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-900">
              Quotation — #{quote.quoteNumber}
              {quote.status === "converted_to_job" && (
                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Converted
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Share the quotation via WhatsApp (attach the saved PDF)">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
            </a>
            <Button onClick={() => window.print()} size="sm" className="h-8 text-xs bg-rose-500 text-white gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </Button>
            <Button onClick={onClose} variant="outline" size="sm" className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ============ PRINTABLE DOCUMENT ============ */}
        <div className="print-scroll p-8 overflow-y-auto flex-1 space-y-5 text-slate-800 print:overflow-visible" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight leading-tight">
                {companyName}
              </h1>
              {companyTagline && (
                <p className="text-[11px] text-slate-500 font-medium">{companyTagline}</p>
              )}
              <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                {companyAddress && <div>{companyAddress}</div>}
                {(companyPhone || companyEmail) && (
                  <div>
                    {companyPhone}
                    {companyPhone && companyEmail ? " • " : ""}
                    {companyEmail}
                  </div>
                )}
                {gstin && <div className="font-semibold">GSTIN: {gstin}</div>}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-[10px] font-semibold text-slate-400">
                Quotation
              </div>
              <div className="text-lg font-semibold text-slate-900 font-mono mt-1">
                {quote.quoteNumber}
              </div>
              <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                <div>
                  Quote Date: <strong className="text-slate-800">{formatDate(quote.createdAt)}</strong>
                </div>
                <div>
                  Valid Until: <strong className="text-slate-800">{formatDate(quote.validUntil)}</strong>
                </div>
              </div>
              {quote.status === "converted_to_job" ? (
                <span className="inline-block mt-2 px-3 py-1 rounded-md text-[10px] font-semibold border bg-emerald-100 text-emerald-800 border-emerald-300">
                  Converted to Booking
                </span>
              ) : isExpired ? (
                <span className="inline-block mt-2 px-3 py-1 rounded-md text-[10px] font-semibold border bg-amber-100 text-amber-800 border-amber-300">
                  Validity Expired
                </span>
              ) : null}
            </div>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <span className="font-semibold text-slate-400 text-[10px] block mb-1">
                Prepared For
              </span>
              <div className="font-semibold text-slate-900 text-sm">{customer?.name || "—"}</div>
              {customer?.address && <div className="text-slate-600 mt-0.5">{customer.address}</div>}
              {customer?.phone && <div className="text-slate-600">{customer.phone}</div>}
              {customer?.email && <div className="text-slate-600">{customer.email}</div>}
            </div>

            <div>
              <span className="font-semibold text-slate-400 text-[10px] block mb-1">
                Service Location
              </span>
              <div className="font-semibold text-slate-900">{property?.title || "—"}</div>
              {property?.address && <div className="text-slate-600 mt-0.5">{property.address}</div>}
              {(property?.city || property?.postalCode) && (
                <div className="text-slate-500">
                  {[property?.city, property?.postalCode].filter(Boolean).join(" ")}
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[10px]">
                <th className="py-2.5 px-3 rounded-l-md font-semibold w-8">#</th>
                <th className="py-2.5 font-semibold">Description of Services</th>
                <th className="py-2.5 text-center font-semibold">Qty</th>
                <th className="py-2.5 text-right font-semibold">Unit Price</th>
                <th className="py-2.5 pr-3 rounded-r-md text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it, i) => (
                <tr key={i} className="align-top">
                  <td className="py-3 px-3 text-slate-500">{i + 1}</td>
                  <td className="py-3 pr-4 font-semibold text-slate-900">{it.description}</td>
                  <td className="py-3 text-center text-slate-700">{it.quantity}</td>
                  <td className="py-3 text-right font-mono text-slate-700">{formatCurrency(it.unitPrice)}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-slate-900">{formatCurrency(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(quote.subtotal)}</span>
              </div>
              {quote.tax > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>
                    {taxName} @ {taxPct}%:
                  </span>
                  <span className="font-semibold text-slate-900">{formatCurrency(quote.tax)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-900 font-semibold text-sm border-t-2 border-slate-900 pt-2">
                <span>Quotation Total:</span>
                <span>{formatCurrency(quote.total)}</span>
              </div>
              {words && <div className="text-[10px] text-slate-400 text-right">({words} only)</div>}
            </div>
          </div>

          {/* Terms */}
          <div className="border-t border-slate-200 pt-4 text-[10px] text-slate-500 leading-relaxed">
            <h4 className="font-semibold text-slate-400 text-[9px] mb-1.5">
              Terms &amp; Notes
            </h4>
            <ul className="list-disc list-inside space-y-0.5">
              <li>This quotation is valid until {formatDate(quote.validUntil)}.</li>
              <li>Prices include {taxName} as itemised above; any applicable taxes at booking time prevail.</li>
              <li>Accepting this quotation converts it into a confirmed booking with a tax invoice.</li>
              {companyEmail && <li>Queries: {companyEmail}.</li>}
              <li>This is a computer-generated quotation.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
