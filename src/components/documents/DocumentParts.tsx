"use client";

import React from "react";
import { FileText, Receipt } from "lucide-react";
import { cn, formatDate, formatMoney } from "@/lib/utils";

/**
 * §4 / §5 The shared furniture of a business document.
 *
 * A quotation and an invoice are the same object seen at two moments, so they
 * share a letterhead, a party block, an item table, a totals ladder and a
 * terms footer. Both print on the same paper: `.doc-sheet` inside
 * `.doc-print-area` is what the print stylesheet keeps (see globals.css).
 */

export interface DocumentParty {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
}

export interface DocumentCompanyInfo extends DocumentParty {
  tagline?: string;
  logoUrl?: string;
  sacCode?: string;
}

export interface DocumentLineRow {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  amount: number;
  taxable?: boolean;
}

/** The paper. Everything inside prints; nothing outside does. */
export function DocumentSheet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="doc-print-area">
      <article
        className={cn(
          "doc-sheet mx-auto max-w-3xl rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 shadow-sm space-y-6",
          className
        )}
      >
        {children}
      </article>
    </div>
  );
}

/** GST / Non-GST chip — says it in words, never colour alone. */
export function TaxTypeBadge({ type, className }: { type: "GST" | "NON_GST"; className?: string }) {
  const gst = type === "GST";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        gst ? "border-info-200 bg-info-50 text-info-700" : "border-zinc-200 bg-zinc-100 text-zinc-700",
        className
      )}
    >
      {gst ? <Receipt className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
      {gst ? "GST" : "Non-GST"}
    </span>
  );
}

/**
 * The letterhead: logo and company identity on the left, the document title
 * and its status chips on the right.
 */
export function DocumentHeader({
  company,
  title,
  subtitle,
  badges,
}: {
  company: DocumentCompanyInfo;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-zinc-200">
      <div className="flex items-start gap-3 min-w-0">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={`${company.name || "Company"} logo`}
            className="h-14 w-14 rounded-xl object-contain border border-zinc-200 bg-white shrink-0"
          />
        ) : null}
        <div className="min-w-0">
          <div className="text-lg font-semibold text-zinc-950 break-words">{company.name || "Company name not set"}</div>
          {company.tagline && <div className="text-sm text-zinc-500">{company.tagline}</div>}
          {company.address && (
            <div className="text-sm text-zinc-600 whitespace-pre-line break-words mt-0.5">{company.address}</div>
          )}
          {(company.phone || company.email) && (
            <div className="text-sm text-zinc-600 break-words">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
          {company.gstin && (
            <div className="text-sm text-zinc-900 mt-1">
              <span className="text-zinc-500">GSTIN:</span>{" "}
              <span className="font-mono font-semibold">{company.gstin}</span>
            </div>
          )}
        </div>
      </div>
      <div className="sm:text-right shrink-0">
        <div className="text-xl font-semibold tracking-tight text-zinc-950">{title}</div>
        {subtitle && <div className="text-sm text-zinc-600">{subtitle}</div>}
        {badges && <div className="mt-1.5 flex sm:justify-end gap-2 flex-wrap">{badges}</div>}
      </div>
    </header>
  );
}

/** The reference strip: number, date, validity / job id. */
export function DocumentMeta({ items }: { items: { label: string; value: React.ReactNode; mono?: boolean }[] }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-3 text-sm", items.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      {items.map((it) => (
        <div key={it.label} className="rounded-xl bg-zinc-50 px-4 py-3">
          <dt className="text-zinc-500">{it.label}</dt>
          <dd className={cn("font-semibold text-zinc-950 break-all", it.mono && "font-mono")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Who it is for, and where the work happens. */
export function DocumentParties({
  customer,
  showGstin,
  billingLabel = "Bill to",
  serviceAddress,
  serviceLabel = "Service address",
  extra,
}: {
  customer: DocumentParty;
  showGstin?: boolean;
  billingLabel?: string;
  serviceAddress?: string;
  serviceLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 doc-keep">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{billingLabel}</h3>
        <div className="mt-1 text-base font-semibold text-zinc-950 break-words">{customer.name}</div>
        {customer.address && <div className="text-sm text-zinc-600 break-words">{customer.address}</div>}
        {customer.phone && <div className="text-sm text-zinc-600">{customer.phone}</div>}
        {customer.email && <div className="text-sm text-zinc-600 break-words">{customer.email}</div>}
        {showGstin && (
          <div className="text-sm text-zinc-900 mt-1">
            <span className="text-zinc-500">GSTIN:</span>{" "}
            <span className="font-mono font-semibold">{customer.gstin || "Unregistered"}</span>
          </div>
        )}
      </div>
      <div>
        {serviceAddress && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{serviceLabel}</h3>
            <div className="mt-1 text-sm text-zinc-700 break-words">{serviceAddress}</div>
          </>
        )}
        {extra}
      </div>
    </section>
  );
}

/**
 * The item table: Service · Description · Qty · Unit price · Discount · Tax ·
 * Total. A table on any width — on phones it scrolls sideways inside its own
 * box rather than squeezing numbers into unreadable columns.
 */
export function DocumentLineTable({
  lines,
  gst,
  gstRate,
  showTaxColumn = true,
}: {
  lines: DocumentLineRow[];
  gst: boolean;
  gstRate?: number;
  showTaxColumn?: boolean;
}) {
  const anyDiscount = lines.some((l) => (l.discount ?? 0) > 0);
  const taxColumn = showTaxColumn && gst;
  return (
    <div className="-mx-5 sm:mx-0 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-y border-zinc-200 bg-zinc-50 text-left">
            <th scope="col" className="px-4 py-2.5 font-semibold text-zinc-700">Service</th>
            <th scope="col" className="px-2 py-2.5 font-semibold text-zinc-700 text-right whitespace-nowrap">Qty</th>
            <th scope="col" className="px-2 py-2.5 font-semibold text-zinc-700 text-right whitespace-nowrap">Unit price</th>
            {anyDiscount && (
              <th scope="col" className="px-2 py-2.5 font-semibold text-zinc-700 text-right whitespace-nowrap">Discount</th>
            )}
            {taxColumn && (
              <th scope="col" className="px-2 py-2.5 font-semibold text-zinc-700 text-right whitespace-nowrap">Tax</th>
            )}
            <th scope="col" className="px-4 py-2.5 font-semibold text-zinc-700 text-right whitespace-nowrap">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.name}-${i}`} className="border-b border-zinc-100 align-top">
              <td className="px-4 py-3">
                <div className="font-medium text-zinc-950 break-words">{l.name}</div>
                {l.description && <div className="text-xs text-zinc-500 break-words mt-0.5">{l.description}</div>}
              </td>
              <td className="px-2 py-3 text-right tabular-nums text-zinc-700">{l.quantity}</td>
              <td className="px-2 py-3 text-right tabular-nums text-zinc-700">{formatMoney(l.unitPrice)}</td>
              {anyDiscount && (
                <td className="px-2 py-3 text-right tabular-nums text-zinc-700">
                  {(l.discount ?? 0) > 0 ? `− ${formatMoney(l.discount!)}` : "—"}
                </td>
              )}
              {taxColumn && (
                <td className="px-2 py-3 text-right tabular-nums text-zinc-700 whitespace-nowrap">
                  {l.taxable === false ? "Exempt" : `${gstRate ?? 0}%`}
                </td>
              )}
              <td className="px-4 py-3 text-right tabular-nums font-medium text-zinc-950">{formatMoney(l.amount)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                No services on this document.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TotalsRow({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-4 py-2.5", strong && "bg-zinc-50")}>
      <dt className={cn("text-sm", strong ? "font-semibold text-zinc-950" : muted ? "text-zinc-400" : "text-zinc-600")}>
        {label}
      </dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          strong ? "text-lg font-semibold text-zinc-950" : "text-sm font-medium text-zinc-900"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The totals ladder. On a GST document: Subtotal → Discount → Taxable →
 * CGST/SGST or IGST → Total GST → Grand total. On a Non-GST document every
 * GST row is absent — not zeroed, absent.
 */
export function DocumentTotals({
  gst,
  subtotal,
  discount,
  taxable,
  exempt,
  gstRate,
  cgst,
  sgst,
  igst,
  totalGst,
  total,
  interState,
  children,
}: {
  gst: boolean;
  subtotal: number;
  discount: number;
  taxable: number;
  exempt?: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  total: number;
  interState?: boolean;
  children?: React.ReactNode;
}) {
  const half = Math.round((gstRate / 2) * 100) / 100;
  return (
    <dl className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden doc-keep">
      <TotalsRow label="Subtotal" value={formatMoney(subtotal)} />
      {discount > 0 && <TotalsRow label="Discount" value={`− ${formatMoney(discount)}`} />}
      {gst ? (
        <>
          <TotalsRow label="Taxable amount" value={formatMoney(taxable)} />
          {(exempt ?? 0) > 0 && <TotalsRow label="GST-exempt services" value={formatMoney(exempt!)} />}
          {interState ? (
            <TotalsRow label={`IGST @ ${gstRate}%`} value={formatMoney(igst)} />
          ) : (
            <>
              <TotalsRow label={`CGST @ ${half}%`} value={formatMoney(cgst)} />
              <TotalsRow label={`SGST @ ${half}%`} value={formatMoney(sgst)} />
            </>
          )}
          <TotalsRow label="Total GST" value={formatMoney(totalGst)} />
        </>
      ) : null}
      <TotalsRow label="Grand total" value={formatMoney(total)} strong />
      {children}
    </dl>
  );
}

/** Payment terms, service terms and notes, in one readable block. */
export function DocumentTerms({
  items,
}: {
  items: { label: string; body?: string | null }[];
}) {
  const present = items.filter((i) => i.body && i.body.trim().length > 0);
  if (present.length === 0) return null;
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 doc-keep">
      {present.map((i) => (
        <div key={i.label}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{i.label}</h3>
          <p className="mt-1 text-sm text-zinc-700 whitespace-pre-line break-words">{i.body}</p>
        </div>
      ))}
    </section>
  );
}

/** The authorised-signature area printed at the foot of an invoice. */
export function SignatureArea({ companyName, label = "Authorised signatory" }: { companyName: string; label?: string }) {
  return (
    <section className="flex justify-end doc-keep">
      <div className="w-56 text-center">
        <div className="h-16" />
        <div className="border-t border-zinc-400 pt-1.5 text-sm font-medium text-zinc-800">{label}</div>
        <div className="text-xs text-zinc-500">{companyName}</div>
      </div>
    </section>
  );
}

/** Small date helper so documents print dates identically everywhere. */
export function docDate(value?: string | null): string {
  return value ? formatDate(value) : "—";
}
