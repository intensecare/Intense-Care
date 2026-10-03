"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { QuoteFormDialog } from "@/components/common/QuoteFormDialog";
import { QuotePreviewModal } from "@/components/common/QuotePreviewModal";
import { ConvertQuoteDialog } from "@/components/common/ConvertQuoteDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { Quote } from "@/lib/types";
import { formatCurrency, formatDate, toLocalDateString } from "@/lib/utils";
import {
  Receipt,
  Plus,
  Printer,
  Trash2,
  CalendarClock,
  CheckCircle2,
  FileText,
  Search,
  IndianRupee,
  AlertTriangle,
} from "lucide-react";

/**
 * Quotations workspace — the single place to raise, price, share and convert
 * pre-sale quotations. Shares the exact same store and dialogs as the Finance
 * page's Quotations tab and the customer 360 Quotations tab: create / convert
 * / delete here is reflected everywhere instantly (write-through store).
 *
 * Financial data (quotes come from /api/finance) — super_admin only.
 */

const OPEN_STATUSES = new Set(["draft", "sent", "accepted", "declined"]);

function QuoteStatusBadge({ status }: { status: Quote["status"] }) {
  const map: Record<Quote["status"], { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
    sent: { label: "Open", cls: "bg-blue-50 text-blue-700 border border-blue-200" },
    accepted: { label: "Accepted", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
    declined: { label: "Declined", cls: "bg-rose-50 text-rose-700 border border-rose-200" },
    converted_to_job: { label: "Converted", cls: "bg-zinc-900 text-white" },
  };
  const s = map[status] ?? map.sent;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function QuotationsPage() {
  const { quotes, customers, properties, services, systemSettings, createQuote, convertQuoteToInvoice, deleteQuote } =
    useApp();

  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [convertTarget, setConvertTarget] = useState<Quote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "converted">("all");
  const [search, setSearch] = useState("");

  // /quotations?raise=true (e.g. from the dashboard CTA) opens the form once.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("raise") === "true") {
      setQuoteFormOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const today = toLocalDateString();
  const in7Days = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const openQuotes = quotes.filter((q) => OPEN_STATUSES.has(q.status));
  const convertedQuotes = quotes.filter((q) => q.status === "converted_to_job");
  const pipelineValue = openQuotes.reduce((acc, q) => acc + q.total, 0);
  const wonValue = convertedQuotes.reduce((acc, q) => acc + q.total, 0);
  const conversionRate = quotes.length > 0 ? Math.round((convertedQuotes.length / quotes.length) * 100) : 0;
  const expiringSoon = openQuotes.filter((q) => q.validUntil >= today && q.validUntil <= in7Days);
  const expiredOpen = openQuotes.filter((q) => q.validUntil < today);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotes
      .filter((q) => {
        if (statusFilter === "open" && !OPEN_STATUSES.has(q.status)) return false;
        if (statusFilter === "converted" && q.status !== "converted_to_job") return false;
        if (!term) return true;
        const customer = customers.find((c) => c.id === q.customerId)?.name ?? "";
        return (
          q.quoteNumber.toLowerCase().includes(term) ||
          customer.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [quotes, statusFilter, search, customers]);

  const itemCount = (q: Quote) => (q.items.length > 0 ? `${q.items.length} line item${q.items.length === 1 ? "" : "s"}` : "Single-price quote");

  return (
    <AdminLayout>
      <PageHeader
        title="Quotations"
        description="Raise, price and share pre-sale quotations — accepted ones convert into confirmed bookings with a tax invoice."
        breadcrumbs={[{ label: "Operations", href: "/" }, { label: "Quotations" }]}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setActionError("");
              setQuoteFormOpen(true);
            }}
            className="h-9 gap-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-800 font-medium shadow-xs"
          >
            <Plus className="h-3.5 w-3.5 text-rose-400" />
            Raise Quotation
          </Button>
        }
      />

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Open Quotations
          </div>
          <div className="text-2xl font-bold text-blue-900 mt-2">{openQuotes.length}</div>
          <div className="text-xs text-blue-600 mt-1">Awaiting customer decision</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <IndianRupee className="h-3.5 w-3.5" />
            Pipeline Value
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{formatCurrency(pipelineValue)}</div>
          <div className="text-xs text-slate-400 mt-1">Open quotes, incl. tax</div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Converted
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">{convertedQuotes.length}</div>
          <div className="text-xs text-emerald-600 mt-1">
            {formatCurrency(wonValue)} won · {conversionRate}% hit rate
          </div>
        </div>

        <div
          className={`rounded-lg border p-4 shadow-xs ${
            expiredOpen.length > 0 ? "border-rose-200 bg-rose-50/40" : "border-amber-200 bg-amber-50/40"
          }`}
        >
          <div
            className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
              expiredOpen.length > 0 ? "text-rose-800" : "text-amber-800"
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Validity Watch
          </div>
          <div className={`text-2xl font-bold mt-2 ${expiredOpen.length > 0 ? "text-rose-700" : "text-amber-700"}`}>
            {expiringSoon.length}
          </div>
          <div className={`text-xs mt-1 ${expiredOpen.length > 0 ? "text-rose-600" : "text-amber-600"}`}>
            {expiredOpen.length > 0
              ? `${expiredOpen.length} past validity — follow up`
              : "Expiring within 7 days"}
          </div>
        </div>
      </div>

      {/* Filter + search bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          {(
            [
              { key: "all", label: "All", count: quotes.length },
              { key: "open", label: "Open", count: openQuotes.length },
              { key: "converted", label: "Converted", count: convertedQuotes.length },
            ] as const
          ).map((chip) => (
            <button
              key={chip.key}
              onClick={() => setStatusFilter(chip.key)}
              className={`px-3 h-8 rounded text-xs font-medium transition-colors border ${
                statusFilter === chip.key
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-600 border-slate-200 hover:border-zinc-300 hover:text-zinc-900"
              }`}
            >
              {chip.label} ({chip.count})
            </button>
          ))}
        </div>

        <div className="relative sm:w-72">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quote number or customer…"
            className="h-9 pl-8 text-xs bg-white"
          />
        </div>
      </div>

      {/* Quotation list */}
      {quotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No quotations raised yet"
          description="Create a priced quotation with line items, share it with the client, and convert accepted ones into bookings."
          actionLabel="Raise First Quotation"
          onAction={() => {
            setActionError("");
            setQuoteFormOpen(true);
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No quotations match"
          description="Try a different status filter or clear the search to see the full pipeline."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filtered.map((q) => {
              const customer = customers.find((c) => c.id === q.customerId);
              const property = properties.find((p) => p.id === q.propertyId);
              const service = services.find((s) => s.id === q.serviceId);
              const isOpen = OPEN_STATUSES.has(q.status);
              const overdue = isOpen && q.validUntil < today;
              const previewItems =
                q.items.length > 2
                  ? `${q.items
                      .slice(0, 2)
                      .map((it) => it.description)
                      .join(" · ")} +${q.items.length - 2} more`
                  : q.items.map((it) => it.description).join(" · ");

              return (
                <div
                  key={q.id}
                  className="p-4 hover:bg-slate-50/60 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-slate-900">{q.quoteNumber}</span>
                      <QuoteStatusBadge status={q.status} />
                      {overdue && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded">
                          <AlertTriangle className="h-3 w-3" />
                          Expired
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-medium text-slate-900 truncate">
                      {customer ? (
                        <Link href={`/customers/${customer.id}`} className="hover:underline">
                          {customer.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {property && <span className="text-slate-500 font-normal"> • {property.title}</span>}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                      <span className="text-slate-600">{service ? service.name : "Custom package"}</span>
                      <span>•</span>
                      <span>{itemCount(q)}</span>
                      {previewItems && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[280px]" title={previewItems}>
                            {previewItems}
                          </span>
                        </>
                      )}
                    </div>

                    <div className={`text-[11px] flex items-center gap-1 ${overdue ? "text-rose-600 font-medium" : "text-slate-500"}`}>
                      <CalendarClock className="h-3 w-3" />
                      {overdue ? "Validity ended" : "Valid until"} {formatDate(q.validUntil)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-3 lg:gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-base font-bold text-slate-900">{formatCurrency(q.total)}</div>
                      <div className="text-[11px] text-slate-400">
                        {formatCurrency(q.subtotal)} + {formatCurrency(q.tax)} tax
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewQuote(q)}
                        className="text-xs h-8 gap-1"
                        title="Print / share the quotation with the client"
                      >
                        <Printer className="h-3 w-3" />
                        View / Print
                      </Button>

                      {isOpen && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setActionError("");
                            setConvertTarget(q);
                          }}
                          className="text-xs h-8 bg-zinc-900 text-white hover:bg-zinc-800"
                          title="Schedule a booking and issue the tax invoice"
                        >
                          Convert to Booking
                        </Button>
                      )}

                      {q.status === "sent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActionError("");
                            setDeleteTarget({ id: q.id, label: q.quoteNumber });
                          }}
                          className="text-xs h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
                          title="Delete open quotation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {actionError && (
        <p className="mt-3 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
          {actionError}
        </p>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setActionError("");
          const result = await deleteQuote(deleteTarget.id);
          if (!result.success) setActionError(result.message);
        }}
        title="Delete Quotation"
        description={`Delete open quotation ${deleteTarget?.label ?? ""}? Converted quotations cannot be deleted.`}
        confirmText="Delete"
      />

      {/* Raise Quotation */}
      <QuoteFormDialog
        open={quoteFormOpen}
        onOpenChange={setQuoteFormOpen}
        customers={customers}
        properties={properties}
        services={services}
        systemSettings={systemSettings}
        onSubmit={async (payload) => createQuote(payload)}
      />

      {/* Convert to Booking */}
      <ConvertQuoteDialog
        isOpen={convertTarget !== null}
        onClose={() => setConvertTarget(null)}
        quote={convertTarget}
        property={properties.find((p) => p.id === convertTarget?.propertyId)}
        onConfirm={async (q, schedule) => convertQuoteToInvoice(q.id, schedule)}
      />

      {/* Quotation document (print / WhatsApp share) */}
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
    </AdminLayout>
  );
}
