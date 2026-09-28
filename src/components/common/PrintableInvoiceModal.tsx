"use client";

import React from "react";
import { Invoice, Job, Customer, Property, Service, Payment, SystemSettings } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getTaxLabel, getGstin, getSacCode } from "@/lib/tax";
import { Printer, X, CheckCircle2, Building2, User, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  if (!isOpen) return null;

  // Tax label + statutory identifiers render from the configured settings.
  const taxLabel = systemSettings
    ? getTaxLabel(systemSettings)
    : invoice.tax > 0
    ? "Tax"
    : "Tax (0%)";
  const gstin = systemSettings ? getGstin(systemSettings) : "";
  const sacCode = systemSettings ? getSacCode(systemSettings) : "";

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Modal Top Action Header (Hidden during print) */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between print:hidden shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-900">
              Tax Invoice Document — #{invoice.invoiceNumber}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handlePrint}
              size="sm"
              className="h-8 text-xs bg-slate-900 text-white gap-1.5"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Invoice Printable Body */}
        <div className="p-8 overflow-y-auto flex-1 space-y-6 text-slate-800 font-sans print:p-0 print:overflow-visible">
          {/* Header & Branding */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-slate-900 text-white font-black text-base flex items-center justify-center">
                  IC
                </div>
                <div>
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">
                    Intense Care ERP
                  </h1>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Enterprise Deep Cleaning Field Services Ltd.
                  </p>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                {gstin ? `GSTIN: ${gstin}` : "GSTIN: Not configured"}
                {sacCode ? ` • SAC Code: ${sacCode}` : ""}<br />
                MG Road Commercial Hub, Bengaluru, KA 560001<br />
                Support: +91 80 4900 1122 • billing@intensecare.com
              </div>
            </div>

            <div className="text-right">
              <span
                className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 ${
                  invoice.status === "PAID"
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : invoice.status === "PARTIAL"
                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                    : "bg-rose-100 text-rose-800 border border-rose-300"
                }`}
              >
                {invoice.status}
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-mono">
                {invoice.invoiceNumber}
              </h2>
              <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                <div>Issue Date: <strong className="text-slate-700">{formatDate(invoice.issuedAt)}</strong></div>
                <div>Due Date: <strong className="text-slate-700">{formatDate(invoice.dueDate)}</strong></div>
                {job && <div>Job ID: <strong className="text-slate-700">{job.id}</strong></div>}
              </div>
            </div>
          </div>

          {/* Customer & Property Address Section */}
          <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-lg border border-slate-100 text-xs">
            <div>
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
                Billed To (Customer)
              </span>
              <div className="font-bold text-slate-900 text-sm">
                {customer?.name || "Valued Customer"}
              </div>
              <div className="text-slate-600 mt-0.5">{customer?.phone}</div>
              <div className="text-slate-600">{customer?.email}</div>
            </div>

            <div>
              <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
                Service Property Address
              </span>
              <div className="font-bold text-slate-900">
                {property?.title || "Residential Property"}
              </div>
              <div className="text-slate-600 mt-0.5">{property?.address || "Site Address"}</div>
              <div className="text-slate-500">{property?.city} {property?.postalCode}</div>
            </div>
          </div>

          {/* Itemized Invoice Table */}
          <div>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 text-slate-500 font-semibold uppercase text-[10px]">
                  <th className="py-2.5">Service Item Description</th>
                  <th className="py-2.5 text-center">Qty</th>
                  <th className="py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3 pr-4">
                    <div className="font-bold text-slate-900 text-sm">
                      {service?.name || "Deep Cleaning Service"}
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      {service?.description || "Professional deep cleaning service"}
                    </div>
                  </td>
                  <td className="py-3 text-center font-medium text-slate-700">
                    1
                  </td>
                  <td className="py-3 text-right font-bold text-slate-900 text-sm">
                    {formatCurrency(invoice.subtotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Financial Calculation Breakdown */}
          <div className="border-t border-slate-200 pt-4 flex justify-end">
            <div className="w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{taxLabel}:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(invoice.tax)}</span>
              </div>
              <div className="flex justify-between text-slate-900 font-bold text-sm border-t border-slate-300 pt-2">
                <span>Total Amount Billed:</span>
                <span className="text-slate-900">{formatCurrency(invoice.total)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold pt-1">
                <span>Amount Paid:</span>
                <span>{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-rose-700 font-bold pt-1 border-t border-dashed border-slate-200">
                <span>Balance Due:</span>
                <span>{formatCurrency(invoice.balanceDue)}</span>
              </div>
            </div>
          </div>

          {/* Payment Log History */}
          {payments.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Settlement History
              </h4>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-[11px] bg-slate-50 p-2 rounded border border-slate-100"
                  >
                    <div>
                      <span className="font-bold text-slate-800 uppercase">{p.paymentMethod}</span>
                      <span className="text-slate-400 ml-2">Ref: {p.transactionReference}</span>
                    </div>
                    <div className="font-bold text-emerald-700">
                      +{formatCurrency(p.amount)} <span className="text-[10px] text-slate-400 font-normal">({formatDate(p.paidAt)})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invoice Terms Footer */}
          <div className="border-t border-slate-100 pt-4 text-[10px] text-slate-400 text-center leading-relaxed">
            Thank you for choosing Intense Care for your deep cleaning needs.<br />
            This is a computer-generated tax invoice. For billing support, contact billing@intensecare.com.
          </div>
        </div>
      </div>
    </div>
  );
}
