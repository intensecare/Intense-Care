"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Customer, SystemSettings, CustomerDetailJob, Invoice, Payment } from "@/lib/types";
import { formatCurrency, formatDate, amountInWords, buildWhatsAppShareUrl } from "@/lib/utils";
import { Printer, X, FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PRINT_ROOT_ID = "print-root-customer-statement";

interface CustomerStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
  invoices: Invoice[];
  payments: Payment[];
  jobs: CustomerDetailJob[];
  systemSettings?: SystemSettings;
}

/**
 * Printable Statement of Account for one customer: every tax invoice, every
 * payment receipt, and the running outstanding balance — print/share ready
 * for clients. All identity figures come from live DB records; nothing is
 * hardcoded. Financial data is Admin-only, so callers gate rendering.
 */
export function CustomerStatementModal({
  isOpen,
  onClose,
  customer,
  invoices,
  payments,
  jobs,
  systemSettings,
}: CustomerStatementModalProps) {
  // Print isolation: output only this document when printing (A4, exact colors).
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
  const gstin = systemSettings?.gstin?.trim() || "";

  const sortedInvoices = [...invoices].sort(
    (a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime()
  );
  const sortedPayments = [...payments].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
  );

  const invoiceNumberById = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));
  const serviceLabel = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    return job?.service?.name || job?.id || "—";
  };

  const totalBilled = sortedInvoices.reduce((sum, i) => sum + i.total, 0);
  const totalPaid = sortedPayments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.max(0, totalBilled - totalPaid);
  const words = amountInWords(outstanding);

  const periodFrom = sortedInvoices[0]?.issuedAt || customer.createdAt;
  const periodTo = new Date().toISOString();

  const statementTitle = `Statement of Account - ${customer.name}`;
  const whatsappMessage = [
    `*${companyName}* — Statement of Account`,
    `Customer: ${customer.name}`,
    `Period: ${formatDate(periodFrom)} to ${formatDate(periodTo)}`,
    `Total Billed: ${formatCurrency(totalBilled)}`,
    `Total Paid: ${formatCurrency(totalPaid)}`,
    `Outstanding Balance: ${formatCurrency(outstanding)}`,
    "",
    "The detailed statement PDF is attached (print / save as PDF from the app).",
  ].join("\n");
  const whatsappUrl = buildWhatsAppShareUrl(customer.whatsapp || customer.phone, whatsappMessage);

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
              Statement of Account — {customer.name}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Share the account summary via WhatsApp (attach the saved PDF)">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
            </a>
            <Button onClick={() => window.print()} size="sm" className="h-8 text-xs bg-rose-500 text-white gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </Button>
            <Button onClick={onClose} variant="outline" size="sm" className="w-8 p-0">
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
                <p className="text-xs text-slate-500 font-medium">{companyTagline}</p>
              )}
              <div className="text-xs text-slate-600 mt-2 leading-relaxed">
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
              <div className="text-xs font-semibold text-slate-400">
                Statement of Account
              </div>
              <div className="text-sm font-semibold text-slate-900 mt-1">{customer.name}</div>
              <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                <div>
                  Statement Date: <strong className="text-slate-800">{formatDate(periodTo)}</strong>
                </div>
                <div>
                  Period: <strong className="text-slate-800">{formatDate(periodFrom)} – {formatDate(periodTo)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Customer identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 border border-slate-100 rounded-lg p-4">
            <div>
              <span className="font-semibold text-slate-400 text-xs block mb-1">
                Account Holder
              </span>
              <div className="font-semibold text-slate-900 text-sm">{customer.name}</div>
              {customer.address && <div className="text-slate-600 mt-0.5">{customer.address}</div>}
              <div className="text-slate-600">{customer.phone}{customer.email ? ` • ${customer.email}` : ""}</div>
            </div>
            <div className="sm:text-right">
              <span className="font-semibold text-slate-400 text-xs block mb-1">
                Account Summary
              </span>
              <div className="text-slate-600">
                Invoices issued: <strong className="text-slate-800">{sortedInvoices.length}</strong>
              </div>
              <div className="text-slate-600">
                Payments received: <strong className="text-slate-800">{sortedPayments.length}</strong>
              </div>
            </div>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-400">Total Billed</div>
              <div className="text-base font-semibold text-slate-900 mt-1">{formatCurrency(totalBilled)}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-600">Total Paid</div>
              <div className="text-base font-semibold text-emerald-800 mt-1">{formatCurrency(totalPaid)}</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold text-red-600">Outstanding Balance</div>
              <div className="text-base font-semibold text-red-800 mt-1">{formatCurrency(outstanding)}</div>
            </div>
          </div>

          {/* Invoice ledger */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2">
              Tax Invoices
            </h4>
            {sortedInvoices.length === 0 ? (
              <p className="text-xs text-slate-400">No invoices issued in this period.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-xs">
                    <th className="py-2 px-2.5 rounded-l-md text-left font-semibold">Date</th>
                    <th className="py-2 text-left font-semibold">Invoice #</th>
                    <th className="py-2 text-left font-semibold">Service / Booking</th>
                    <th className="py-2 text-right font-semibold">Billed</th>
                    <th className="py-2 text-right font-semibold">Paid</th>
                    <th className="py-2 pr-2.5 rounded-r-md text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedInvoices.map((inv) => (
                    <tr key={inv.id} className="align-top">
                      <td className="py-2 px-2.5 text-slate-600">{formatDate(inv.issuedAt)}</td>
                      <td className="py-2 font-mono font-semibold text-slate-800">{inv.invoiceNumber}</td>
                      <td className="py-2 text-slate-600">{serviceLabel(inv.jobId)}</td>
                      <td className="py-2 text-right font-semibold text-slate-800">{formatCurrency(inv.total)}</td>
                      <td className="py-2 text-right text-emerald-700">{formatCurrency(inv.amountPaid)}</td>
                      <td className="py-2 pr-2.5 text-right font-semibold text-red-700">{formatCurrency(inv.balanceDue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 font-semibold text-slate-900">
                    <td className="py-2 px-2.5" colSpan={3}>
                      Total
                    </td>
                    <td className="py-2 text-right">{formatCurrency(totalBilled)}</td>
                    <td className="py-2 text-right text-emerald-700">{formatCurrency(totalPaid)}</td>
                    <td className="py-2 pr-2.5 text-right text-red-700">{formatCurrency(outstanding)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Payment receipts */}
          {sortedPayments.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-400 mb-2">
                Payment Receipts
              </h4>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-slate-400 text-xs border-b border-slate-200">
                    <th className="py-1.5 text-left font-semibold">Date</th>
                    <th className="py-1.5 text-left font-semibold">Reference</th>
                    <th className="py-1.5 text-left font-semibold">Method</th>
                    <th className="py-1.5 text-left font-semibold">Applied To</th>
                    <th className="py-1.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-1.5 text-slate-600">{formatDate(p.paidAt)}</td>
                      <td className="py-1.5 font-mono text-slate-500">{p.transactionReference || "—"}</td>
                      <td className="py-1.5 font-semibold text-slate-700">{p.paymentMethod.replace(/_/g, " ")}</td>
                      <td className="py-1.5 font-mono text-slate-600">
                        {invoiceNumberById.get(p.invoiceId) || "—"}
                      </td>
                      <td className="py-1.5 text-right font-semibold text-emerald-700">+{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Outstanding in words + footer */}
          <div className="border-t border-slate-200 pt-4 space-y-3 text-xs">
            {words && (
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-slate-600">
                <span className="font-semibold text-slate-400 text-xs block mb-1">
                  Outstanding Balance in Words
                </span>
                INR {words} Only
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs text-slate-500 leading-relaxed">
              <div>
                <h4 className="font-semibold text-slate-400 text-xs mb-1.5">Notes</h4>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>This statement reflects all transactions recorded up to {formatDate(periodTo)}.</li>
                  {companyEmail && <li>Account queries: {companyEmail}.</li>}
                  <li>This is a computer-generated statement.</li>
                </ul>
              </div>
              <div className="text-right flex flex-col justify-end">
                <div className="pt-8 border-t border-slate-300 mt-auto">
                  For <strong className="text-slate-700">{companyName}</strong>
                  <div className="text-xs text-slate-400 mt-0.5">Authorised Signatory</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
