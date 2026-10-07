"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { FinanceHome } from "@/components/finance/FinanceHome";
import { EmptyState } from "@/components/common/EmptyState";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { Expense, Quote } from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { DollarSign, FileText, CheckCircle2, TrendingUp, AlertTriangle, Plus, CreditCard, Loader2, Trash2, Printer, ExternalLink } from "lucide-react";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { QuoteFormDialog } from "@/components/common/QuoteFormDialog";
import { QuotePreviewModal } from "@/components/common/QuotePreviewModal";
import { ConvertQuoteDialog } from "@/components/common/ConvertQuoteDialog";
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
  const { invoices, payments, quotes, customers, jobs, expenses, payouts, partners, properties, services, systemSettings, recordPayment, createExpense, createQuote, convertQuoteToInvoice, deleteExpense, deleteQuote } = useApp();

  const [deleteTarget, setDeleteTarget] = useState<{ kind: "expense" | "quote"; id: string; label: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [activeTab, setActiveTab] = useState("invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);

  // Quotation workflow: raise (form), preview (print/share), convert (schedule).
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [convertTarget, setConvertTarget] = useState<Quote | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<any>("upi");
  const [payRef, setPayRef] = useState("");

  // New Expense Modal State
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expCategory, setExpCategory] = useState<Expense["category"]>("chemicals");
  const [expAmount, setExpAmount] = useState<number>(0);
  const [expDesc, setExpDesc] = useState("");
  const [expMethod, setExpMethod] = useState<Expense["paymentMethod"]>("card");
  const [expRef, setExpRef] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  const detailInvoice = detailInvoiceId ? invoices.find((i) => i.id === detailInvoiceId) ?? null : null;
  const detailQuote = detailQuoteId ? quotes.find((q) => q.id === detailQuoteId) ?? null : null;
  const detailExpense = detailExpenseId ? expenses.find((e) => e.id === detailExpenseId) ?? null : null;

  const totalInvoiced = invoices.reduce((acc, i) => acc + i.total, 0);
  const totalCollected = invoices.reduce((acc, i) => acc + i.amountPaid, 0);
  const totalReceivables = invoices.reduce((acc, i) => acc + i.balanceDue, 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
  // Referral commission payouts are a real cash outflow (settled on the
  // Referrals module) — they must reduce the operating result.
  const totalCommissionsPaid = payouts.reduce((acc, p) => acc + p.amount, 0);
  const totalCommissionsPending = partners.reduce((acc, p) => acc + p.totalCommissionPending, 0);
  const netOperatingIncome = totalCollected - totalExpenses - totalCommissionsPaid;

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

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expAmount <= 0 || !expDesc.trim()) return;
    setIsSubmittingExpense(true);

    await createExpense({
      date: new Date().toISOString().split("T")[0],
      category: expCategory,
      amount: expAmount,
      description: expDesc,
      paymentMethod: expMethod,
      reference: expRef || undefined,
    });

    setShowExpenseModal(false);
    setExpAmount(0);
    setExpDesc("");
    setExpRef("");
    setIsSubmittingExpense(false);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Finance"
        description="Billable job → invoice → payment → reconcile → report. Outstanding, collections and refunds at a glance."
        breadcrumbs={[{ label: "Finance" }]}
      />

      {/* Role home: outstanding / collected / pending / overdue + attention + refunds */}
      <FinanceHome />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">
            Total Invoiced
          </div>
          <div className="text-2xl font-semibold text-slate-900 mt-2">
            {formatCurrency(totalInvoiced)}
          </div>
          <div className="text-xs text-slate-400 mt-1">{invoices.length} Invoices Issued</div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold text-emerald-800">
            Actual Revenue Collected
          </div>
          <div className="text-2xl font-semibold text-emerald-700 mt-2">
            {formatCurrency(totalCollected)}
          </div>
          <div className="text-xs text-emerald-600 mt-1">Verified cash/bank receipts</div>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold text-red-800">
            Total Expenses
          </div>
          <div className="text-2xl font-semibold text-red-700 mt-2">
            {formatCurrency(totalExpenses)}
          </div>
          <div className="text-xs text-red-600 mt-1">{expenses.length} Recorded expenses</div>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold text-purple-800">
            Referral Commissions Paid
          </div>
          <div className="text-2xl font-semibold text-purple-700 mt-2">
            {formatCurrency(totalCommissionsPaid)}
          </div>
          <div className="text-xs text-purple-600 mt-1">
            {payouts.length} payouts{totalCommissionsPending > 0 ? ` • ${formatCurrency(totalCommissionsPending)} pending` : ""}
          </div>
        </div>

        <div className="rounded-lg border border-slate-900 bg-slate-900 text-white p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-300">
            Net Operating Result
          </div>
          <div className="text-2xl font-semibold mt-2">
            {formatCurrency(netOperatingIncome)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Collected revenue − Expenses − Commissions</div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList className="bg-slate-200/70 p-1">
            <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
            <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
            <TabsTrigger value="quotes">Quotations ({quotes.length})</TabsTrigger>
            <TabsTrigger value="expenses">Business Expenses ({expenses.length})</TabsTrigger>
          </TabsList>

          {activeTab === "expenses" && (
            <Button
              size="sm"
              onClick={() => setShowExpenseModal(true)}
              className="bg-rose-500 text-white text-xs h-8"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Record Business Expense
            </Button>
          )}
          {activeTab === "quotes" && (
            <div className="flex items-center gap-2">
              <Link
                href="/quotations"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                title="Open the full Quotations workspace"
              >
                <ExternalLink className="h-3 w-3" />
                Quotations Workspace
              </Link>
              <Button
                size="sm"
                onClick={() => setQuoteFormOpen(true)}
                className="bg-rose-500 text-white text-xs h-8"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Raise Quotation
              </Button>
            </div>
          )}
        </div>

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
                              {inv.jobId}
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
                            {p.jobId}
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

        {/* 3. QUOTES TAB */}
        <TabsContent value="quotes" className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="divide-y divide-slate-100">
              {quotes.map((q) => {
                const cust = customers.find((c) => c.id === q.customerId);

                return (
                  <div
                    key={q.id}
                    onClick={() => setDetailQuoteId(q.id)}
                    className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60 cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900">{q.quoteNumber}</span>
                        <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-800">
                          {q.status}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-800">{cust?.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Valid until: {formatDate(q.validUntil)}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-base font-semibold text-slate-900">{formatCurrency(q.total)}</div>
                        <div className="text-[11px] text-slate-400">Subtotal + Tax</div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewQuote(q);
                        }}
                        className="text-xs h-8 gap-1"
                        title="Print / share the quotation with the client"
                      >
                        <Printer className="h-3 w-3" />
                        View / Print
                      </Button>

                      {q.status !== "converted_to_job" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConvertTarget(q);
                          }}
                          className="text-xs h-8 border-slate-300"
                        >
                          Convert to Booking
                        </Button>
                      )}

                      {q.status === "sent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionError("");
                            setDeleteTarget({ kind: "quote", id: q.id, label: q.quoteNumber });
                          }}
                          className="text-xs h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                          title="Delete open quotation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* 4. EXPENSES TAB */}
        <TabsContent value="expenses" className="space-y-4">
          {expenses.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No expenses recorded"
              description="Record operational costs such as chemicals, equipment maintenance, fuel, and salaries."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Payment Method</th>
                      <th className="py-3 px-4">Reference</th>
                      <th className="py-3 px-4 font-semibold text-right">Amount</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {expenses.map((exp) => (
                      <tr
                        key={exp.id}
                        onClick={() => setDetailExpenseId(exp.id)}
                        className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                        title="Open expense details"
                      >
                        <td className="py-3 px-4 text-slate-500 font-mono">
                          {formatDate(exp.date)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {exp.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {exp.description}
                        </td>
                        <td className="py-3 px-4 font-semibold text-[11px] text-slate-600">
                          {exp.paymentMethod.replace("_", " ")}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">
                          {exp.reference || "—"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-red-700 text-right">
                          {formatCurrency(exp.amount)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionError("");
                              setDeleteTarget({ kind: "expense", id: exp.id, label: exp.description });
                            }}
                            title="Delete expense"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {actionError && (
        <p className="mt-3 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
          {actionError}
        </p>
      )}

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
                        {detailInvoice.jobId}
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

      {/* Quote Detail Dialog */}
      <Dialog open={detailQuote !== null} onOpenChange={(open) => !open && setDetailQuoteId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailQuote && (() => {
            const cust = customers.find((c) => c.id === detailQuote.customerId);
            const property = properties.find((p) => p.id === detailQuote.propertyId);
            const service = services.find((s) => s.id === detailQuote.serviceId);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-blue-600" />
                    {detailQuote.quoteNumber}
                    <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-800">
                      {detailQuote.status}
                    </span>
                  </DialogTitle>
                  <DialogDescription>Quotation details and conversion actions.</DialogDescription>
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
                      <span className="text-[11px] text-slate-400">Property</span>
                      <div className="font-semibold text-slate-800 truncate">
                        {property ? property.title : detailQuote.propertyId}
                      </div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Service package</span>
                      <div className="font-semibold text-slate-800">{service ? service.name : detailQuote.serviceId}</div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                      <span className="text-[11px] text-slate-400">Valid until</span>
                      <div className="font-semibold text-slate-800">{formatDate(detailQuote.validUntil)}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(detailQuote.subtotal)}</span>
                    </div>
                    <div className="p-2.5 flex justify-between">
                      <span className="text-slate-500">GST</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(detailQuote.tax)}</span>
                    </div>
                    <div className="p-2.5 flex justify-between bg-slate-50">
                      <span className="font-semibold text-slate-900">Total</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(detailQuote.total)}</span>
                    </div>
                  </div>

                  {detailQuote.items.length > 0 && (
                    <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                      {detailQuote.items.map((it, i) => (
                        <div key={i} className="p-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{it.description}</div>
                            <div className="text-[10px] text-slate-400">Qty {it.quantity}</div>
                          </div>
                          <span className="font-mono text-slate-700 shrink-0">{formatCurrency(it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <DialogFooter className="pt-3 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1"
                    onClick={() => {
                      setPreviewQuote(detailQuote);
                    }}
                  >
                    <Printer className="h-3.5 w-3.5 mr-0.5" />
                    Print / Share
                  </Button>
                  {detailQuote.status === "sent" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-slate-300"
                        onClick={() => {
                          setConvertTarget(detailQuote);
                        }}
                      >
                        Convert to Booking
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                        onClick={() => {
                          const q = detailQuote;
                          setDetailQuoteId(null);
                          setActionError("");
                          setDeleteTarget({ kind: "quote", id: q.id, label: q.quoteNumber });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setDetailQuoteId(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Expense Detail Dialog */}
      <Dialog open={detailExpense !== null} onOpenChange={(open) => !open && setDetailExpenseId(null)}>
        <DialogContent className="sm:max-w-md">
          {detailExpense && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="h-4 w-4 text-zinc-400" />
                  {formatCurrency(detailExpense.amount)}
                  <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                    {detailExpense.category}
                  </span>
                </DialogTitle>
                <DialogDescription>Operational expense record.</DialogDescription>
              </DialogHeader>

              <div className="space-y-2 py-2 text-xs">
                <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                  <span className="text-[11px] text-slate-400">Description</span>
                  <div className="font-semibold text-slate-800">{detailExpense.description}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                    <span className="text-[11px] text-slate-400">Date</span>
                    <div className="font-semibold text-slate-800">{formatDate(detailExpense.date)}</div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                    <span className="text-[11px] text-slate-400">Payment method</span>
                    <div className="font-semibold text-slate-800 capitalize">
                      {detailExpense.paymentMethod.replace("_", " ")}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                    <span className="text-[11px] text-slate-400">Reference</span>
                    <div className="font-mono font-semibold text-slate-800">
                      {detailExpense.reference || "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                    <span className="text-[11px] text-slate-400">Recorded</span>
                    <div className="font-semibold text-slate-800">{formatDate(detailExpense.createdAt)}</div>
                  </div>
                </div>
              </div>

              <DialogFooter className="pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                  onClick={() => {
                    const exp = detailExpense;
                    setDetailExpenseId(null);
                    setActionError("");
                    setDeleteTarget({ kind: "expense", id: exp.id, label: exp.description });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete Expense
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetailExpenseId(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Expense / Quote Confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setActionError("");
          const result =
            deleteTarget.kind === "expense"
              ? await deleteExpense(deleteTarget.id)
              : await deleteQuote(deleteTarget.id);
          if (!result.success) setActionError(result.message);
        }}
        title={deleteTarget?.kind === "quote" ? "Delete Quotation" : "Delete Expense"}
        description={
          deleteTarget?.kind === "quote"
            ? `Delete open quotation ${deleteTarget?.label ?? ""}? Converted quotations cannot be deleted.`
            : `Delete expense "${deleteTarget?.label ?? ""}"? This permanently removes it from the books.`
        }
        confirmText="Delete"
      />

      {/* Raise Quotation Dialog */}
      <QuoteFormDialog
        open={quoteFormOpen}
        onOpenChange={setQuoteFormOpen}
        customers={customers}
        properties={properties}
        services={services}
        systemSettings={systemSettings}
        onSubmit={async (payload) => createQuote(payload)}
      />

      {/* Convert Quotation Dialog (pick service schedule) */}
      <ConvertQuoteDialog
        isOpen={convertTarget !== null}
        onClose={() => setConvertTarget(null)}
        quote={convertTarget}
        property={properties.find((p) => p.id === convertTarget?.propertyId)}
        onConfirm={async (q, schedule) => convertQuoteToInvoice(q.id, schedule)}
      />

      {/* Quotation Document (print / share) */}
      {previewQuote && (
        <QuotePreviewModal
          isOpen={previewQuote !== null}
          onClose={() => setPreviewQuote(null)}
          quote={previewQuote}
          customer={customers.find((c) => c.id === previewQuote.customerId)}
          property={properties.find((p) => p.id === previewQuote.propertyId)}
          service={services.find((s) => s.id === previewQuote.serviceId)}
          systemSettings={systemSettings}
        />
      )}

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

      {/* Record Business Expense Dialog */}
      <Dialog open={showExpenseModal} onOpenChange={setShowExpenseModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Operational Business Expense</DialogTitle>
            <DialogDescription>
              Log company expenditure for accurate net profit accounting.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddExpense} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Expense Category *</label>
              <select
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="chemicals">Chemicals & Cleaning Supplies</option>
                <option value="equipment">Equipment & Machinery</option>
                <option value="fuel">Fuel & Logistics</option>
                <option value="salaries">Staff Wages / Bonuses</option>
                <option value="marketing">Marketing & Ads</option>
                <option value="utilities">Utilities & Office</option>
                <option value="other">Other Operational Expense</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Amount (₹) *</label>
              <Input
                type="number"
                value={expAmount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setExpAmount(e.target.value === "" ? 0 : Number(e.target.value))}
                required
                className="text-xs font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Description *</label>
              <Input
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="e.g. 20L Industrial Floor Degreaser purchase"
                required
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Payment Instrument</label>
              <select
                value={expMethod}
                onChange={(e) => setExpMethod(e.target.value as any)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="card">Company Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="upi">UPI Transfer</option>
                <option value="cash">Petty Cash</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Invoice / Bill Reference (Optional)</label>
              <Input
                value={expRef}
                onChange={(e) => setExpRef(e.target.value)}
                placeholder="e.g. INV-CHEM-9921"
                className="text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowExpenseModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={isSubmittingExpense}>
                {isSubmittingExpense ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Expense"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
