"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSignature, Plus, Search } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Notice, SkeletonList } from "@/components/ui/states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuoteStatusBadge } from "@/components/documents/QuoteDocument";
import { ServiceSelector, toServicePayload, type ServiceDraft } from "@/components/common/ServiceSelector";
import { useApp } from "@/lib/app-context";
import { cn, formatDate, formatMoney, toLocalDateOffset } from "@/lib/utils";
import type { Quote } from "@/lib/types";

/**
 * §4 Admin → Quotations.
 *
 * Raise a professional quotation for one or many services (catalog or
 * custom), send it, record the customer acceptance, and convert it into a
 * job + invoice that inherit the quoted figures exactly.
 */
export default function QuotesPage() {
  const { customers, properties, services, systemSettings } = useApp();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/quotes", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(json?.error || "Could not load quotations.");
      else setQuotes(json.data as Quote[]);
    } catch {
      setError("You are offline. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customerName = useCallback(
    (id: string) => customers.find((c) => c.id === id)?.name ?? "Customer",
    [customers]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (quotes ?? []).filter((row) => {
      const matchesStatus = statusFilter === "ALL" || row.status === statusFilter;
      const matchesQuery =
        !q ||
        row.quoteNumber.toLowerCase().includes(q) ||
        customerName(row.customerId).toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [quotes, query, statusFilter, customerName]);

  return (
    <AdminLayout>
      <PageHeader
        title="Quotations"
        description="Price one or many services, send a professional quotation, and convert it into a job."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New quotation
          </Button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by quotation number or customer"
            className="pl-9"
            aria-label="Search quotations"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="h-11 rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-900 sm:w-56"
        >
          <option value="ALL">All quotations</option>
          <option value="sent">Awaiting acceptance</option>
          <option value="accepted">Accepted</option>
          <option value="converted_to_job">Booked as a job</option>
          <option value="declined">Declined</option>
        </select>
      </div>

      {quotes === null ? (
        <SkeletonList rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={quotes.length === 0 ? "No quotations yet" : "No quotations match"}
          description={
            quotes.length === 0
              ? "Raise a quotation to price a job before it is booked."
              : "Try a different search or status."
          }
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((q) => (
            <li key={q.id}>
              <Link
                href={`/quotes/${q.id}`}
                className="block rounded-2xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-zinc-950 break-all">{q.quoteNumber}</div>
                    <div className="text-sm text-zinc-700 mt-0.5 break-words">{customerName(q.customerId)}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {q.items.length} service{q.items.length === 1 ? "" : "s"} · raised {formatDate(q.createdAt)} · valid
                      until {formatDate(q.validUntil)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-semibold text-zinc-950 tabular-nums">{formatMoney(q.total)}</div>
                    <div className="mt-1">
                      <QuoteStatusBadge status={q.status} />
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewQuotationDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          void load();
        }}
        customers={customers}
        properties={properties}
        services={services}
        taxRatePercent={systemSettings.taxRatePercent}
        validityDays={systemSettings.quotationValidityDays}
      />
    </AdminLayout>
  );
}

function NewQuotationDialog({
  open,
  onClose,
  onCreated,
  customers,
  properties,
  services,
  taxRatePercent,
  validityDays,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  customers: ReturnType<typeof useApp>["customers"];
  properties: ReturnType<typeof useApp>["properties"];
  services: ReturnType<typeof useApp>["services"];
  taxRatePercent: number;
  validityDays: number;
}) {
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [lines, setLines] = useState<ServiceDraft[]>([]);
  const [invoiceType, setInvoiceType] = useState<"GST" | "NON_GST">("GST");
  const [interState, setInterState] = useState(false);
  const [validUntil, setValidUntil] = useState(toLocalDateOffset(validityDays || 15));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const customerProperties = useMemo(
    () => properties.filter((p) => p.customerId === customerId),
    [properties, customerId]
  );

  useEffect(() => {
    setPropertyId(customerProperties[0]?.id ?? "");
  }, [customerProperties]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!customerId) return setFormError("Choose the customer this quotation is for.");
    if (!propertyId) return setFormError("Choose the property the service is for.");
    if (lines.length === 0) return setFormError("Add at least one service to the quotation.");

    setBusy(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          propertyId,
          services: toServicePayload(lines),
          invoiceType,
          interState: invoiceType === "GST" ? interState : false,
          validUntil,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setFormError(json?.error || "Could not raise the quotation.");
        return;
      }
      setLines([]);
      setNotes("");
      onCreated();
    } catch {
      setFormError("You are offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
          <DialogDescription>Price the work before it is booked. The job inherits these figures.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {formError && <Notice tone="error">{formError}</Notice>}

          <Field label="Customer" required>
            <SearchableSelect
              options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search customers"
            />
          </Field>

          <Field
            label="Property"
            required
            hint={customerId && customerProperties.length === 0 ? "This customer has no property yet — add one on the Properties page." : undefined}
          >
            <SearchableSelect
              options={customerProperties.map((p) => ({ value: p.id, label: `${p.title} - ${p.address}` }))}
              value={propertyId}
              onChange={setPropertyId}
              placeholder="Select the property"
            />
          </Field>

          <ServiceSelector
            services={services}
            value={lines}
            onChange={setLines}
            gst={invoiceType === "GST"}
            taxRatePercent={taxRatePercent}
            interState={interState}
          />

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-800">Quotation type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["GST", "NON_GST"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={invoiceType === t}
                  onClick={() => setInvoiceType(t)}
                  className={cn(
                    "min-h-12 rounded-xl border-2 px-3 text-sm font-semibold",
                    invoiceType === t ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 bg-white text-zinc-700"
                  )}
                >
                  {t === "GST" ? "GST quotation" : "Non-GST quotation"}
                </button>
              ))}
            </div>
          </fieldset>

          {invoiceType === "GST" && (
            <label className="flex items-center gap-2.5 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={interState}
                onChange={(e) => setInterState(e.target.checked)}
                className="h-5 w-5 accent-rose-500"
              />
              Customer is in another state (IGST instead of CGST + SGST)
            </label>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Valid until" required>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
            <Field label="Notes" hint="Printed on the quotation.">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the customer should know" />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Raise quotation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
