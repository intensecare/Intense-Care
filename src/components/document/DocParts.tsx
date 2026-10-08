"use client";

import React, { useState } from "react";
import { Share2, Link2, MessageCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, amountInWords, buildWhatsAppShareUrl } from "@/lib/utils";
import type { QuoteLine } from "@/lib/types";

/** Company block printed on quotations and invoices (from Settings). */
export interface DocCompany {
  name: string;
  tagline?: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  sacCode: string;
  logo?: string;
  signature?: string;
  signatoryName?: string;
}

/** Logo + company details on the left, document title and chips on the right. */
export function DocHeader({ company, showGstin, title, chips }: { company: DocCompany; showGstin: boolean; title: string; chips?: React.ReactNode }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-zinc-200 pb-5">
      <div className="flex items-start gap-3 min-w-0">
        {company.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL from Settings
          <img src={company.logo} alt="" className="h-14 w-14 sm:h-16 sm:w-16 object-contain shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-lg font-semibold text-zinc-950">{company.name || "Intense Care"}</div>
          {company.tagline && <div className="text-sm text-zinc-500">{company.tagline}</div>}
          {company.address && <div className="text-sm text-zinc-600 whitespace-pre-line break-words">{company.address}</div>}
          {(company.phone || company.email) && <div className="text-sm text-zinc-600 break-words">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>}
          {showGstin && company.gstin && <div className="text-sm text-zinc-900 mt-1"><span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{company.gstin}</span></div>}
        </div>
      </div>
      <div className="sm:text-right shrink-0">
        <div className="text-xl font-semibold tracking-tight text-zinc-950">{title}</div>
        {chips && <div className="mt-1 flex sm:justify-end gap-2 flex-wrap">{chips}</div>}
      </div>
    </header>
  );
}

/** Small labelled facts: number, date, Job ID … */
export function DocFacts({ facts }: { facts: { label: string; value: React.ReactNode; mono?: boolean }[] }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-3 text-sm", facts.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {facts.map((f) => (
        <div key={f.label} className="rounded-xl bg-zinc-50 px-4 py-3 min-w-0">
          <dt className="text-zinc-500">{f.label}</dt>
          <dd className={cn("font-semibold text-zinc-950 break-all", f.mono && "font-mono")}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocParty({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h3>
      <div className="mt-1 space-y-0.5 text-sm text-zinc-600 break-words">{children}</div>
    </div>
  );
}

/** The service table — a real table on paper and wide screens, stacked rows on a phone. */
export function ItemsTable({ items }: { items: QuoteLine[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm hidden sm:table print:table">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold w-10">#</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold">Service</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Qty</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Rate</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map((l, i) => (
            <tr key={i}>
              <td className="px-4 py-2.5 text-zinc-500">{i + 1}</td>
              <td className="px-4 py-2.5 text-zinc-900 break-words">{l.description}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{l.quantity}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.rate)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="sm:hidden print:hidden divide-y divide-zinc-100">
        {items.map((l, i) => (
          <li key={i} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-900 break-words">{l.description}</div>
              <div className="text-xs text-zinc-500 tabular-nums">{l.quantity} × {formatMoney(l.rate)}</div>
            </div>
            <div className="text-sm font-semibold tabular-nums shrink-0">{formatMoney(l.amount)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Row = ({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) => (
  <div className={cn("flex items-baseline justify-between gap-4 px-4 py-2.5", strong && "bg-zinc-50")}>
    <dt className={cn("text-sm", strong ? "font-semibold text-zinc-950" : "text-zinc-600")}>{label}</dt>
    <dd className={cn("text-right tabular-nums", strong ? "text-lg font-semibold text-zinc-950" : "text-sm font-medium text-zinc-900")}>{value}</dd>
  </div>
);

/**
 * Subtotal → discount → (GST only) taxable, CGST/SGST or IGST → total.
 * A Non-GST document shows no GST rows at all.
 */
export function TotalsTable({
  gst,
  subtotal,
  discount,
  gstRate,
  interState,
  cgst,
  sgst,
  igst,
  tax,
  total,
  extra,
}: {
  gst: boolean;
  subtotal: number;
  discount: number;
  gstRate: number;
  interState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  extra?: React.ReactNode;
}) {
  const taxable = Math.round((subtotal - discount) * 100) / 100;
  return (
    <div className="sm:ml-auto sm:max-w-sm w-full break-inside-avoid">
      <dl className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
        <Row label="Subtotal" value={formatMoney(subtotal)} />
        {discount > 0 && <Row label="Discount" value={`− ${formatMoney(discount)}`} />}
        {gst && (
          <>
            <Row label="Taxable amount" value={formatMoney(taxable)} />
            {interState ? (
              <Row label={`IGST @ ${gstRate}%`} value={formatMoney(igst)} />
            ) : (
              <>
                <Row label={`CGST @ ${gstRate / 2}%`} value={formatMoney(cgst)} />
                <Row label={`SGST @ ${gstRate / 2}%`} value={formatMoney(sgst)} />
              </>
            )}
            <Row label="Total GST" value={formatMoney(tax)} />
          </>
        )}
        <Row label="Total" value={formatMoney(total)} strong />
        {extra}
      </dl>
      {amountInWords(total) && <p className="mt-2 text-xs text-zinc-500 sm:text-right">Rupees {amountInWords(total)} only</p>}
    </div>
  );
}
export { Row as TotalsRow };

/** Payment terms, notes and terms & conditions. Empty blocks are left out. */
export function DocTerms({ blocks }: { blocks: { heading: string; text?: string | null }[] }) {
  const shown = blocks.filter((b) => b.text && b.text.trim());
  if (!shown.length) return null;
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 break-inside-avoid">
      {shown.map((b) => (
        <div key={b.heading} className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{b.heading}</h3>
          <p className="mt-1 text-sm text-zinc-700 whitespace-pre-line break-words">{b.text}</p>
        </div>
      ))}
    </section>
  );
}

/** "For <company>" + signature image + name — the authorized signature. */
export function DocSignature({ company }: { company: DocCompany }) {
  return (
    <div className="flex justify-end break-inside-avoid">
      <div className="text-center min-w-[12rem]">
        <div className="text-sm text-zinc-600">For {company.name || "Intense Care"}</div>
        <div className="h-16 flex items-end justify-center">
          {company.signature && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL from Settings
            <img src={company.signature} alt="Authorized signature" className="max-h-16 object-contain" />
          )}
        </div>
        <div className="border-t border-zinc-300 pt-1 text-sm font-semibold text-zinc-900">{company.signatoryName || "Authorized signatory"}</div>
      </div>
    </div>
  );
}

/**
 * Share a link: the phone's share sheet when there is one, WhatsApp, or copy.
 * `getUrl` may create the link on first use.
 */
export function ShareButtons({ getUrl, message, phone }: { getUrl: () => Promise<string | null>; message: (url: string) => string; phone?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = async (how: "share" | "whatsapp" | "copy") => {
    setBusy(true);
    const url = await getUrl();
    setBusy(false);
    if (!url) return;
    const text = message(url);
    if (how === "share" && typeof navigator !== "undefined" && "share" in navigator) {
      await navigator.share({ text, url }).catch(() => {});
    } else if (how === "whatsapp" || how === "share") {
      window.open(buildWhatsAppShareUrl(phone, text), "_blank", "noopener,noreferrer");
    } else {
      await navigator.clipboard?.writeText(url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => void run("share")} loading={busy}><Share2 className="h-4 w-4" aria-hidden /> Share</Button>
      <Button variant="outline" onClick={() => void run("whatsapp")}><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp</Button>
      <Button variant="outline" onClick={() => void run("copy")}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
      </Button>
    </>
  );
}
