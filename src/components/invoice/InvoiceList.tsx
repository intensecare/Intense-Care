"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { EmptyState } from "@/components/common/EmptyState";
import { PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { InvoiceTypeBadge } from "./InvoiceDocument";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { Invoice } from "@/lib/types";

export type InvoiceRow = Invoice & { jobNumber: string; customerName: string };
export type InvoiceTypeFilter = "ALL" | "GST" | "NON_GST";

/**
 * Invoice list with filters, loaded from GET /api/invoices (the server applies
 * the role rule: a Tax Officer only ever receives GST invoices).
 *   showTypeFilter — Admin: All / GST Invoices / Non-GST Invoices
 *   gstColumns     — show the CGST/SGST/IGST breakdown (GST views)
 */
export function InvoiceList({
  basePath,
  showTypeFilter = false,
  fixedType,
  gstColumns = false,
  actions,
  reloadKey = 0,
  onLoaded,
}: {
  basePath: string;
  showTypeFilter?: boolean;
  fixedType?: InvoiceTypeFilter;
  gstColumns?: boolean;
  actions?: (row: InvoiceRow) => React.ReactNode;
  reloadKey?: number;
  onLoaded?: (rows: InvoiceRow[]) => void;
}) {
  const [type, setType] = useState<InvoiceTypeFilter>(fixedType ?? "ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const p = new URLSearchParams({ type: fixedType ?? type });
    if (query) p.set("q", query);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (customerId) p.set("customerId", customerId);
    try {
      const res = await fetch(`/api/invoices?${p.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "Could not load invoices.");
        return;
      }
      setRows(json.data.invoices);
      setCustomers(json.data.customers);
      onLoaded?.(json.data.invoices);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
    // onLoaded is a callback from the parent; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, fixedType, query, from, to, customerId, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filtersOn = Boolean(query || from || to || customerId);
  const clear = () => {
    setQ("");
    setQuery("");
    setFrom("");
    setTo("");
    setCustomerId("");
  };

  return (
    <div className="space-y-4">
      {showTypeFilter && !fixedType && (
        <div className="flex rounded-xl bg-zinc-100 p-1 w-full sm:w-auto sm:inline-flex" role="radiogroup" aria-label="Invoice type">
          {([["ALL", "All"], ["GST", "GST Invoices"], ["NON_GST", "Non-GST Invoices"]] as const).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={type === k}
              onClick={() => setType(k)}
              className={cn("flex-1 sm:flex-none min-h-10 px-3 sm:px-4 rounded-lg text-sm font-medium", type === k ? "bg-white shadow-sm font-semibold text-zinc-950" : "text-zinc-600")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no., Job ID, customer, GSTIN" aria-label="Search invoices" className="pl-10" />
        </div>
        <SearchableSelect
          value={customerId}
          onChange={setCustomerId}
          options={[{ value: "", label: "All customers" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
          placeholder="All customers"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <span className="w-12 shrink-0">From</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <span className="w-12 shrink-0">To</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
      </div>
      {filtersOn && (
        <button onClick={clear} className="h-10 px-3 rounded-xl text-sm font-semibold text-rose-600 inline-flex items-center gap-1.5 hover:bg-rose-50">
          <X className="h-4 w-4" aria-hidden /> Clear filters
        </button>
      )}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <SkeletonList rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={filtersOn ? "No invoices match these filters" : "No invoices yet"}
          description={filtersOn ? "Try a different date range, customer or search." : "Invoices are created when a job is booked."}
          actionLabel={filtersOn ? "Clear filters" : undefined}
          onAction={filtersOn ? clear : undefined}
        />
      ) : (
        <DataTable
          caption="Invoices"
          rows={rows}
          rowKey={(r) => r.id}
          href={(r) => `${basePath}/${r.id}`}
          actions={actions}
          columns={[
            { key: "no", header: "Invoice", mobile: "title", cell: (r) => <span className="font-mono font-semibold break-all">{r.invoiceNumber}</span> },
            { key: "cust", header: "Customer", mobile: "subtitle", cell: (r) => r.customerName },
            { key: "type", header: "Type", mobile: "badge", cell: (r) => <InvoiceTypeBadge type={r.invoiceType} /> },
            { key: "date", header: "Date", cell: (r) => formatDate(r.issuedAt) },
            ...(gstColumns
              ? [
                  { key: "taxable", header: "Taxable", align: "right" as const, cell: (r: InvoiceRow) => formatMoney(r.subtotal - r.discount) },
                  { key: "gst", header: "GST", align: "right" as const, cell: (r: InvoiceRow) => formatMoney(r.tax) },
                ]
              : [{ key: "status", header: "Status", cell: (r: InvoiceRow) => <PaymentStatusBadge status={r.status} /> }]),
            { key: "total", header: "Grand total", align: "right", cell: (r) => <span className="font-semibold">{formatMoney(r.total)}</span> },
          ]}
        />
      )}
    </div>
  );
}
