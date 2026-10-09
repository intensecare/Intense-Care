"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, FileSignature, Search } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { InvoiceTypeBadge } from "@/components/invoice/InvoiceDocument";
import { QuoteStatusBadge, QUOTE_STATUS_LABEL, useQuotes } from "@/components/quote/QuoteParts";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { QuoteStatus } from "@/lib/types";

const FILTERS: ("all" | QuoteStatus)[] = ["all", "draft", "sent", "accepted", "converted_to_job", "declined", "expired"];

/** Admin → Quotations: every quotation, by status; open one to print, share or convert it. */
export default function QuotationsPage() {
  const { quotes, error, reload } = useQuotes();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (quotes ?? []).filter(
      (x) => (filter === "all" || x.status === filter) && (!needle || [x.quoteNumber, x.customerName, x.propertyTitle].some((v) => v?.toLowerCase().includes(needle)))
    );
  }, [quotes, filter, q]);
  const count = (s: (typeof FILTERS)[number]) => (s === "all" ? quotes?.length ?? 0 : quotes?.filter((x) => x.status === s).length ?? 0);
  const open = (quotes ?? []).filter((x) => x.status === "sent" || x.status === "draft");

  return (
    <AdminLayout>
      <PageHeader
        title="Quotations"
        description="Price the work, share it with the customer, then convert it to a job or an invoice."
        actions={
          <Link href="/quotations/new" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800">
            <Plus className="h-4 w-4" aria-hidden /> New Quotation
          </Link>
        }
      />

      {quotes && quotes.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="text-sm text-zinc-500">Awaiting reply</div><div className="text-2xl font-semibold text-zinc-950 mt-1">{open.length}</div></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 min-w-0"><div className="text-sm text-zinc-500">Open value</div><div className="text-lg sm:text-2xl font-semibold text-zinc-950 mt-1 break-words">{formatMoney(open.reduce((a, x) => a + x.total, 0))}</div></div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4"><div className="text-sm text-emerald-800">Accepted</div><div className="text-2xl font-semibold text-emerald-700 mt-1">{count("accepted")}</div></div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer or property" aria-label="Search quotations" className="pl-10" />
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn("shrink-0 min-h-10 px-3.5 rounded-full border text-sm font-medium", filter === f ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}
          >
            {f === "all" ? "All" : QUOTE_STATUS_LABEL[f]} <span className={filter === f ? "text-zinc-300" : "text-zinc-400"}>{count(f)}</span>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !quotes ? (
        <SkeletonList rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={quotes.length ? "No quotations match" : "No quotations yet"}
          description={quotes.length ? "Try another status or search." : "Create a quotation, share it with the customer, and convert it to a job when they accept."}
        />
      ) : (
        <DataTable
          caption="Quotations"
          rows={rows}
          rowKey={(x) => x.id}
          href={(x) => `/quotations/${x.id}`}
          columns={[
            { key: "no", header: "Quotation", mobile: "title", cell: (x) => <span className="font-mono font-semibold text-zinc-950 break-all">{x.quoteNumber}</span> },
            { key: "customer", header: "Customer", mobile: "subtitle", cell: (x) => <span className="break-words">{x.customerName ?? "—"}{x.propertyTitle ? <span className="text-zinc-500"> · {x.propertyTitle}</span> : null}</span> },
            { key: "type", header: "Type", cell: (x) => <InvoiceTypeBadge type={x.quoteType} /> },
            { key: "total", header: "Total", align: "right", cell: (x) => <span className="font-semibold tabular-nums">{formatMoney(x.total)}</span> },
            { key: "valid", header: "Valid until", cell: (x) => formatDate(x.validUntil) },
            { key: "status", header: "Status", mobile: "badge", cell: (x) => <QuoteStatusBadge status={x.status} /> },
          ]}
        />
      )}
    </AdminLayout>
  );
}
