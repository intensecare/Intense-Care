"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Invoice, Job, Customer, Property, Service, Payment, SystemSettings } from "@/lib/types";
import { formatCurrency, formatDate, amountInWords, buildWhatsAppShareUrl } from "@/lib/utils";
import { getTaxRate, getGstin, getSacCode } from "@/lib/tax";
import { Printer, X, FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PRINT_ROOT_ID = "print-root-tax-invoice";

interface PrintableInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  job?: Job;
  customer?: Customer;
  property?: Property;
  service?: Service;
  payments?: Payment[];
  systemSettings?: SystemSettings;
}

export function PrintableInvoiceModal({
  isOpen,
  onClose,
  invoice,
  job,
  customer,
  property,
  service,
  payments = [],
  systemSettings,
}: PrintableInvoiceModalProps) {
  // Print isolation: while this document is open, printing outputs ONLY the
  // invoice (A4 page, exact colors) instead of the dashboard behind it.
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

  // Every identity/statutory value renders from configured settings — the
  // document shows only real data and simply omits lines that are not set.
  const companyName = systemSettings?.companyName?.trim() || "Intense Care";
  const companyTagline = systemSettings?.companyTagline?.trim() || "";
  const companyAddress = systemSettings?.companyAddress?.trim() || "";
  const companyPhone = systemSettings?.companyPhone?.trim() || "";
  const companyEmail = systemSettings?.companyEmail?.trim() || "";
  const gstin = systemSettings ? getGstin(systemSettings) : "";
  const sacCode = systemSettings ? getSacCode(systemSettings) : "";
  const taxName = systemSettings?.taxLabel?.trim() || "GST";
  const taxPct = Math.round(getTaxRate(systemSettings ?? { taxRatePercent: 0 }) * 10000) / 100;
  const taxEnabled = invoice.tax > 0;

  const taxableValue = Math.max(0, invoice.subtotal - (invoice.discount || 0));
  const hasDiscount = (invoice.discount || 0) > 0;

  const words = amountInWords(invoice.total);
  const balanceWords = invoice.balanceDue > 0 ? amountInWords(invoice.balanceDue) : "";

  const docTitle = `Tax Invoice ${invoice.invoiceNumber} - ${companyName}`;
  const whatsappMessage = [
    `*${companyName}* — Tax Invoice`,
    `Invoice No: ${invoice.invoiceNumber}`,
    job ? `Booking Ref: ${job.id}` : "",
    customer ? `Billed to: ${customer.name}` : "",
    `Total: ${formatCurrency(invoice.total)}`,
    `Paid: ${formatCurrency(invoice.amountPaid)}`,
    `Balance Due: ${formatCurrency(invoice.balanceDue)}`,
    invoice.dueDate ? `Payment due by ${formatDate(invoice.dueDate)}.` : "",
    "",
    "The tax invoice PDF is attached (print / save as PDF from the app).",
  ]
    .filter(Boolean)
    .join("\n");
  const whatsappUrl = buildWhatsAppShareUrl(customer?.whatsapp || customer?.phone, whatsappMessage);

  const handlePrint = () => window.print();

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
              Tax Invoice — #{invoice.invoiceNumber}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Share invoice summary via WhatsApp (attach the saved PDF from Print / Save as PDF)">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
            </a>
            <Button
              onClick={handlePrint}
              size="sm"
              className="h-8 text-xs bg-rose-500 text-white gap-1.5"
            >
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
          {/* Header: company identity | document meta */}
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
                Tax Invoice
              </div>
              <div className="text-lg font-semibold text-slate-900 font-mono mt-1">
                {invoice.invoiceNumber}
              </div>
              <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                <div>
                  Issue Date: <strong className="text-slate-800">{formatDate(invoice.issuedAt)}</strong>
                </div>
                <div>
                  Due Date: <strong className="text-slate-800">{formatDate(invoice.dueDate)}</strong>
                </div>
                {job && (
                  <div>
                    Booking Ref: <strong className="text-slate-800">{job.id}</strong>
                  </div>
                )}
              </div>
              <span
                className={`inline-block mt-2 px-3 py-1 rounded-md text-[10px] font-semibold border ${
                  invoice.status === "PAID"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : invoice.status === "PARTIAL"
                    ? "bg-amber-100 text-amber-800 border-amber-300"
                    : "bg-red-100 text-red-800 border-rose-300"
                }`}
              >
                {invoice.status === "PAID" ? "Paid" : invoice.status === "PARTIAL" ? "Partially Paid" : "Unpaid"}
              </span>
            </div>
          </div>

          {/* Parties: billed-to | service property | booking window */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="sm:col-span-1">
              <span className="font-semibold text-slate-400 text-[10px] block mb-1">
                Billed To
              </span>
              <div className="font-semibold text-slate-900 text-sm">{customer?.name || "—"}</div>
              {customer?.address && <div className="text-slate-600 mt-0.5">{customer.address}</div>}
              {customer?.phone && <div className="text-slate-600">{customer.phone}</div>}
              {customer?.email && <div className="text-slate-600">{customer.email}</div>}
            </div>

            <div className="sm:col-span-1">
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

            <div className="sm:col-span-1">
              <span className="font-semibold text-slate-400 text-[10px] block mb-1">
                Service Window
              </span>
              {job ? (
                <>
                  <div className="font-semibold text-slate-900">{formatDate(job.scheduledDate)}</div>
                  <div className="text-slate-600">{job.scheduledTimeSlot}</div>
                  {job.completedAt && (
                    <div className="text-slate-500 mt-1">Completed: {formatDate(job.completedAt)}</div>
                  )}
                </>
              ) : (
                <div className="text-slate-400">—</div>
              )}
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[10px]">
                <th className="py-2.5 px-3 rounded-l-md font-semibold">#</th>
                <th className="py-2.5 font-semibold">Description of Services</th>
                {sacCode && <th className="py-2.5 text-center font-semibold">SAC</th>}
                <th className="py-2.5 text-center font-semibold">Qty</th>
                <th className="py-2.5 text-right pr-3 rounded-r-md font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200 align-top">
                <td className="py-3 px-3 text-slate-500">1</td>
                <td className="py-3 pr-4">
                  <div className="font-semibold text-slate-900 text-sm">
                    {service?.name || (job ? `Cleaning services per booking ${job.id}` : "Cleaning services")}
                  </div>
                  {service?.description && (
                    <div className="text-slate-500 text-[11px] mt-0.5">{service.description}</div>
                  )}
                  {job?.notes && (
                    <div className="text-slate-400 text-[11px] mt-1 italic">Note: {job.notes}</div>
                  )}
                </td>
                {sacCode && <td className="py-3 text-center font-mono text-slate-600">{sacCode}</td>}
                <td className="py-3 text-center font-medium text-slate-700">1</td>
                <td className="py-3 text-right pr-3 font-semibold text-slate-900 text-sm">
                  {formatCurrency(invoice.subtotal)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Totals + amount in words */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-3 leading-relaxed">
              <span className="font-semibold text-slate-400 text-[10px] block mb-1">
                Amount in Words
              </span>
              {words ? `INR ${words} Only` : "—"}
            </div>

            <div className="w-full space-y-1.5 text-xs sm:min-w-[260px] sm:justify-self-end">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {hasDiscount && (
                <div className="flex justify-between text-slate-600">
                  <span>Discount:</span>
                  <span className="font-semibold text-slate-900">
                    −{formatCurrency(invoice.discount)}
                  </span>
                </div>
              )}
              {taxEnabled && (
                <div className="flex justify-between text-slate-600">
                  <span>
                    {taxName} @ {taxPct}%:
                  </span>
                  <span className="font-semibold text-slate-900">{formatCurrency(invoice.tax)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-900 font-semibold text-sm border-t-2 border-slate-900 pt-2">
                <span>Total:</span>
                <span>{formatCurrency(invoice.total)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Amount Paid:</span>
                <span>{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-red-700 font-semibold pt-1.5 border-t border-dashed border-slate-300">
                <span>Balance Due:</span>
                <span>{formatCurrency(invoice.balanceDue)}</span>
              </div>
              {balanceWords && (
                <div className="text-[10px] text-slate-400 text-right">
                  ({balanceWords} due)
                </div>
              )}
            </div>
          </div>

          {/* Settlement history */}
          {payments.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-[10px] font-semibold text-slate-400 mb-2">
                Payment History
              </h4>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400 text-[9px] border-b border-slate-200">
                    <th className="py-1.5 text-left font-semibold">Date</th>
                    <th className="py-1.5 text-left font-semibold">Method</th>
                    <th className="py-1.5 text-left font-semibold">Reference</th>
                    <th className="py-1.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-1.5 text-slate-600">{formatDate(p.paidAt)}</td>
                      <td className="py-1.5 text-slate-700 font-semibold">{p.paymentMethod.replace(/_/g, " ")}</td>
                      <td className="py-1.5 text-slate-500 font-mono">{p.transactionReference || "—"}</td>
                      <td className="py-1.5 text-right font-semibold text-emerald-700">
                        +{formatCurrency(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Terms + signatory */}
          <div className="border-t border-slate-200 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6 text-[10px] text-slate-500 leading-relaxed">
            <div>
              <h4 className="font-semibold text-slate-400 text-[9px] mb-1.5">
                Terms &amp; Notes
              </h4>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Payment due by {formatDate(invoice.dueDate)}.</li>
                {companyEmail && <li>Billing queries: {companyEmail}.</li>}
                <li>This is a computer-generated tax invoice and is valid without a physical signature.</li>
              </ul>
            </div>
            <div className="text-right flex flex-col justify-end">
              <div className="pt-8 border-t border-slate-300 mt-auto">
                For <strong className="text-slate-700">{companyName}</strong>
                <div className="text-[9px] text-slate-400 mt-0.5">Authorised Signatory</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
