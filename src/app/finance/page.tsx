"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { DollarSign, FileText, CheckCircle2, TrendingUp, AlertTriangle, Plus, CreditCard, Loader2, Trash2, Printer, ExternalLink } from "lucide-react";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function FinancePage() {
  const { invoices, payments, customers, jobs, recordPayment } = useApp();

  const [activeTab, setActiveTab] = useState("invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<any>("upi");
  const [payRef, setPayRef] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const jobNo = (id: string) => jobs.find((j) => j.id === id)?.jobNumber ?? id;
  const detailInvoice = detailInvoiceId ? invoices.find((i) => i.id === detailInvoiceId) ?? null : null;

  const totalInvoiced = invoices.reduce((acc, i) => acc + i.total, 0);
  const totalCollected = invoices.reduce((acc, i) => acc + i.amountPaid, 0);
  const totalReceivables = invoices.reduce((acc, i) => acc + i.balanceDue, 0);

  const handleOpenPaymentModal = (inv: any) => {
    setSelectedInvoiceId(inv.id);
    setPayAmount(inv.balanceDue);
    setPayRef(`TXN-${Date.now().toString().slice(-6)}`);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceId || payAmount <= 0) return;
    setIsSubmittingPayment(true);

    await recordPayment(selectedInvoiceId, payAmount, payMethod, payRef);
    setSelectedInvoiceId(null);
    setIsSubmittingPayment(false);
  };

  return (
    <AdminLayout>
      <PageHeader title="Payments" description="Invoices and the payments recorded against them." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-zinc-500">Invoiced</div>
          <div className="text-3xl font-semibold text-zinc-950 mt-2">{formatCurrency(totalInvoiced)}</div>
          <div className="text-xs text-zinc-400 mt-1">{invoices.length} invoices</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-emerald-800">Collected</div>
          <div className="text-3xl font-semibold text-emerald-700 mt-2">{formatCurrency(totalCollected)}</div>
          <div className="text-xs text-zinc-400 mt-1">{payments.length} payments</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-amber-800">Still to collect</div>
          <div className="text-3xl font-semibold text-amber-700 mt-2">{formatCurrency(totalReceivables)}</div>
          <div className="text-xs text-zinc-400 mt-1">{invoices.filter((i) => i.balanceDue > 0).length} invoices open</div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-zinc-200/70 p-1 rounded-xl">
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        </TabsList>

        {/* 1. INVOICES TAB */}
        <TabsContent value="invoices" className="space-y-4">
          {invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No tax invoices generated yet"
              description="Tax invoices are created upon booking scheduling with itemized GST breakdown."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Job ID</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Subtotal + GST</th>
                      <th className="py-3 px-4">Total Amount</th>
                      <th className="py-3 px-4">Paid / Balance Due</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {invoices.map((inv) => {
                      const cust = customers.find((c) => c.id === inv.customerId);

                      return (
                        <tr
                          key={inv.id}
                          onClick={() => setDetailInvoiceId(inv.id)}
                          className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                          title="Open invoice details"
                        >
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                            {inv.invoiceNumber}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <Link href={`/jobs/${inv.jobId}`} className="text-blue-600 hover:underline">
                              {jobNo(inv.jobId)}
                            </Link>
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {cust?.name}
                          </td>
                          <td className="py-3 px-4 text-slate-500">
                            {formatCurrency(inv.subtotal)} + {formatCurrency(inv.tax)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {formatCurrency(inv.total)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-emerald-700 font-semibold">{formatCurrency(inv.amountPaid)}</span> /{" "}
                            <span className={inv.balanceDue > 0 ? "text-red-600 font-semibold" : "text-slate-400"}>
                              {formatCurrency(inv.balanceDue)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <PaymentStatusBadge status={inv.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            {inv.balanceDue > 0 && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenPaymentModal(inv);
                                }}
                                className="h-7 text-xs bg-rose-500 text-white font-medium"
                              >
                                Collect Payment
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* 2. PAYMENTS TAB */}
        <TabsContent value="payments" className="space-y-4">
          {payments.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No payments recorded yet"
              description="Record bank transfers, UPI transactions, or card receipts against outstanding invoices."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Payment ID</th>
                      <th className="py-3 px-4">Job ID</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Method</th>
                      <th className="py-3 px-4">Transaction Reference</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                          {p.id}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <Link href={`/jobs/${p.jobId}`} className="text-blue-600 hover:underline">
                            {jobNo(p.jobId)}
                          </Link>
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-700">
                          {formatCurrency(p.amount)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-[11px] text-slate-700">
                          {p.paymentMethod}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 text-[11px]">
                          {p.transactionReference}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {formatDateTime(p.paidAt)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

      </Tabs>

      {/* Invoice Detail Dialog */}
      <Dialog open={detailInvoice !== null} onOpenChange={(open) => !open && setDetailInvoiceId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailInvoice && (() => {
            const cust = customers.find((c) => c.id === detailInvoice.customerId);
            const invoicePayments = payments.filter((p) => p.invoiceId === detailInvoice.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-slate-700" />
                    {detailInvoice.invoiceNumber}
                    <PaymentStatusBadge status={detailInvoice.status} />
                  </DialogTitle>
                  <DialogDescription>Tax invoice with settlement history.</DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Customer</span>
                      {cust ? (
                        <Link href={`/customers/${cust.id}`} className="block font-semibold text-slate-800 hover:underline">
                          {cust.name}
                        </Link>
                      ) : (
                        <div className="font-semibold text-slate-800">—</div>
                      )}
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Job</span>
                      <Link href={`/jobs/${detailInvoice.jobId}`} className="block font-mono font-semibold text-blue-600 hover:underline">
                        {jobNo(detailInvoice.jobId)}
                      </Link>
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Issued</span>
                      <div className="font-semibold text-slate-800">{formatDate(detailInvoice.issuedAt)}</div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Due date</span>
                      <div className="font-semibold text-slate-800">{formatDate(detailInvoice.dueDate)}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(detailInvoice.subtotal)}</span>
                    </div>
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">GST</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(detailInvoice.tax)}</span>
                    </div>
                    {detailInvoice.discount > 0 && (
                      <div className="p-2.5 flex justify-between">
                        <span className="text-slate-500">Discount</span>
                        <span className="font-semibold text-slate-800">− {formatCurrency(detailInvoice.discount)}</span>
                      </div>
                    )}
                    <div className="p-2.5 flex justify-between bg-slate-50">
                      <span className="font-semibold text-slate-900">Total</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(detailInvoice.total)}</span>
                    </div>
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">Amount paid</span>
                      <span className="font-semibold text-emerald-700">{formatCurrency(detailInvoice.amountPaid)}</span>
                    </div>
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">Balance due</span>
                      <span className={detailInvoice.balanceDue > 0 ? "font-semibold text-red-600" : "font-semibold text-slate-400"}>
                        {formatCurrency(detailInvoice.balanceDue)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-slate-500">
                      Settlements ({invoicePayments.length})
                    </h4>
                    {invoicePayments.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No payments recorded against this invoice yet.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {invoicePayments.map((p) => (
                          <div key={p.id} className="p-2.5 flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-emerald-700">{formatCurrency(p.amount)}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{p.transactionReference}</div>
                            </div>
                            <div className="text-right text-[10px] text-slate-500">
                              <div className="capitalize">{p.paymentMethod.replace("_", " ")}</div>
                              <div>{formatDateTime(p.paidAt)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter className="pt-3 border-t border-slate-100">
                  {detailInvoice.balanceDue > 0 && (
                    <Button
                      size="sm"
                      className="text-xs bg-rose-500 text-white"
                      onClick={() => {
                        const target = detailInvoice;
                        setDetailInvoiceId(null);
                        handleOpenPaymentModal(target);
                      }}
                    >
                      <CreditCard className="h-3.5 w-3.5 mr-1" />
                      Collect Payment
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setDetailInvoiceId(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>


      {/* Collect Payment Dialog */}
      <Dialog open={!!selectedInvoiceId} onOpenChange={(open) => !open && setSelectedInvoiceId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment Settlement</DialogTitle>
            <DialogDescription>
              Record customer payment for outstanding tax invoice.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitPayment} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Settlement Amount (₹) *</label>
              <Input
                type="number"
                value={payAmount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPayAmount(e.target.value === "" ? 0 : Number(e.target.value))}
                required
                className="text-xs font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Payment Instrument</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="card">Credit / Debit Card</option>
                <option value="bank_transfer">Direct Bank Transfer</option>
                <option value="cash">Cash on Handover</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Transaction Reference ID *</label>
              <Input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                required
                className="text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedInvoiceId(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={isSubmittingPayment}>
                {isSubmittingPayment ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Recording...
                  </>
                ) : (
                  "Record Payment"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}
