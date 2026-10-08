"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InvoiceList, type InvoiceRow } from "@/components/invoice/InvoiceList";
import { RecordPaymentDialog } from "@/components/invoice/RecordPaymentDialog";
import { useApp } from "@/lib/app-context";
import { formatDateTime, formatMoney } from "@/lib/utils";

const METHOD: Record<string, string> = { upi: "UPI", card: "Card", bank_transfer: "Bank transfer", cash: "Cash", online_link: "Online" };

/** Admin → Invoices: GST and Non-GST invoices kept apart by one filter, plus payments. */
export default function InvoicesPage() {
  const { payments, jobs } = useApp();
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [summary, setSummary] = useState<{ count: number; total: number; due: number } | null>(null);
  const jobNo = (id: string) => jobs.find((j) => j.id === id)?.jobNumber ?? "Job";

  return (
    <AdminLayout>
      <PageHeader title="Invoices" description="GST and Non-GST invoices, kept separate. Open one to print it or record a payment." />

      {summary && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="text-sm text-zinc-500">Invoices</div><div className="text-2xl font-semibold text-zinc-950 mt-1">{summary.count}</div></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 min-w-0"><div className="text-sm text-zinc-500">Billed</div><div className="text-lg sm:text-2xl font-semibold text-zinc-950 mt-1 break-words">{formatMoney(summary.total)}</div></div>
          <div className="rounded-2xl border border-amber-200 bg-white p-4 min-w-0"><div className="text-sm text-amber-800">To collect</div><div className="text-lg sm:text-2xl font-semibold text-amber-700 mt-1 break-words">{formatMoney(summary.due)}</div></div>
        </div>
      )}

      <Tabs defaultValue="invoices" className="space-y-4">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <InvoiceList
            basePath="/invoices"
            showTypeFilter
            reloadKey={reloadKey}
            onLoaded={(rows) => setSummary({ count: rows.length, total: rows.reduce((a, r) => a + r.total, 0), due: rows.reduce((a, r) => a + r.balanceDue, 0) })}
            actions={(r) => (r.balanceDue > 0 ? <Button size="sm" variant="outline" onClick={() => setPaying(r)}>Record payment</Button> : null)}
          />
        </TabsContent>
        <TabsContent value="payments">
          {payments.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments yet" description="Payments you record against invoices appear here." />
          ) : (
            <DataTable
              caption="Payments"
              rows={payments}
              rowKey={(p) => p.id}
              columns={[
                { key: "amount", header: "Amount", mobile: "title", cell: (p) => <span className="font-semibold text-emerald-700">{formatMoney(p.amount)}</span> },
                { key: "date", header: "Date", mobile: "subtitle", cell: (p) => formatDateTime(p.paidAt) },
                { key: "job", header: "Job", cell: (p) => <Link href={`/jobs/${p.jobId}`} className="text-rose-600 font-medium break-all">{jobNo(p.jobId)}</Link> },
                { key: "method", header: "Method", cell: (p) => METHOD[p.paymentMethod] ?? p.paymentMethod },
                { key: "ref", header: "Reference", cell: (p) => <span className="break-all">{p.transactionReference || "—"}</span> },
              ]}
            />
          )}
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => setReloadKey((k) => k + 1)} />
    </AdminLayout>
  );
}
