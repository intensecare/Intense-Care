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

/** Shown until Settings has a logo uploaded — the app's own mark, never a blank slot. */
const FALLBACK_LOGO = "/intense-logo-black.png";

/** The ruled lines of the printed sheet — a classic bordered tax-invoice look. */
const RULE = "border-zinc-800";
const SUBRULE = "divide-zinc-300";
/** Shared cell borders for a plain ledger-style table (th/td get the same rule). */
const CELL_TABLE =
  "w-full border-collapse text-sm [&_th]:border [&_td]:border [&_th]:border-zinc-300 [&_td]:border-zinc-300 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2";

/**
 * The outer sheet: a bordered frame with a centered title band (TAX INVOICE /
 * QUOTATION) and its status chips, echoing the classic ruled-ledger GST
 * invoice. Children are bordered rows that make up the body — each draws its
 * own bottom rule, so the whole thing reads as one continuous table.
 */
export function DocFrame({ title, chips, children }: { title: string; chips?: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className={cn("invoice-doc overflow-hidden rounded-md border-2 bg-white shadow-sm print:shadow-none", RULE)}>
      <header className={cn("space-y-1.5 border-b-2 bg-zinc-50 px-4 py-3 text-center print:bg-white", RULE)}>
        <h1 className="text-lg font-bold uppercase tracking-wide text-zinc-950">{title}</h1>
        {chips && <div className="flex flex-wrap justify-center gap-2">{chips}</div>}
      </header>
      {children}
    </article>
  );
}

/** Logo + company identity (left) and the document's key facts (right), in one ruled row. */
export function DocCompanyMeta({
  company,
  showGstin,
  meta,
}: {
  company: DocCompany;
  showGstin: boolean;
  meta: { label: string; value: React.ReactNode; mono?: boolean }[];
}) {
  return (
    <div className={cn("grid grid-cols-1 divide-y border-b-2 sm:grid-cols-[1fr_auto] sm:divide-x sm:divide-y-0", RULE, SUBRULE)}>
      <div className="flex items-start gap-3 p-4 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Settings, or the app's own mark */}
        <img src={company.logo || FALLBACK_LOGO} alt="" className="h-14 max-w-[140px] w-auto shrink-0 object-contain object-left" />
        <div className="min-w-0">
          <div className="text-lg font-semibold text-zinc-950">{company.name || "Intense Care"}</div>
          {company.tagline && <div className="text-sm text-zinc-500">{company.tagline}</div>}
          {company.address && <div className="text-sm text-zinc-600 whitespace-pre-line break-words">{company.address}</div>}
          {(company.phone || company.email) && (
            <div className="text-sm text-zinc-600 break-words">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
          )}
          {showGstin && company.gstin && (
            <div className="text-sm text-zinc-900 mt-1">
              <span className="text-zinc-500">GSTIN:</span> <span className="font-mono font-semibold">{company.gstin}</span>
            </div>
          )}
        </div>
      </div>
      <dl className={cn("divide-y sm:w-72", SUBRULE)}>
        {meta.map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
            <dt className="text-zinc-500">{m.label}</dt>
            <dd className={cn("font-semibold text-zinc-950 text-right break-all", m.mono && "font-mono")}>{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One labelled block — bill-to, service address, property … — plain content, no border of its own. */
export function DocParty({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h3>
      <div className="mt-1 space-y-0.5 text-sm text-zinc-700 break-words">{children}</div>
    </div>
  );
}

/** Wraps one or two <DocParty> blocks in a single ruled row (side by side from sm:). */
export function DocParties({ children }: { children: React.ReactNode }) {
  const many = React.Children.count(children) > 1;
  return (
    <div className={cn("grid grid-cols-1 divide-y border-b-2", RULE, SUBRULE, many && "sm:grid-cols-2 sm:divide-x sm:divide-y-0")}>
      {React.Children.map(children, (child) => (
        <div className="p-4 min-w-0">{child}</div>
      ))}
    </div>
  );
}

/** The service table — Sl No, service, SAC (GST only), qty, GST% (GST only), rate, amount. */
export function ItemsTable({ items, gst, gstRate, sacCode }: { items: QuoteLine[]; gst: boolean; gstRate?: number; sacCode?: string }) {
  const showSac = gst && !!sacCode;
  return (
    <div className={cn("border-b-2 overflow-x-auto", RULE)}>
      <table className={cn("hidden sm:table print:table", CELL_TABLE)}>
        <thead className="bg-zinc-50 text-zinc-700">
          <tr>
            <th scope="col" className="text-left font-semibold w-10">#</th>
            <th scope="col" className="text-left font-semibold">Service</th>
            {showSac && <th scope="col" className="text-left font-semibold whitespace-nowrap">SAC</th>}
            <th scope="col" className="text-right font-semibold">Qty</th>
            {gst && <th scope="col" className="text-right font-semibold whitespace-nowrap">GST %</th>}
            <th scope="col" className="text-right font-semibold">Rate</th>
            <th scope="col" className="text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={i}>
              <td className="text-zinc-500">{i + 1}</td>
              <td className="text-zinc-900 break-words">{l.description}</td>
              {showSac && <td className="text-zinc-600 font-mono whitespace-nowrap">{sacCode}</td>}
              <td className="text-right tabular-nums">{l.quantity}</td>
              {gst && <td className="text-right tabular-nums whitespace-nowrap">{gstRate}%</td>}
              <td className="text-right tabular-nums">{formatMoney(l.rate)}</td>
              <td className="text-right tabular-nums font-medium">{formatMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="sm:hidden print:hidden divide-y divide-zinc-300">
        {items.map((l, i) => (
          <li key={i} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-900 break-words">{l.description}</div>
              <div className="text-xs text-zinc-500 tabular-nums">
                {l.quantity} × {formatMoney(l.rate)}
                {gst && ` · GST ${gstRate}%`}
              </div>
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
export { Row as TotalsRow };

/**
 * The GST breakup (left) and the totals ribbon (right), in one ruled row —
 * the ledger-style footer of a classic tax invoice. A Non-GST document shows
 * no GST figures at all, just the subtotal/discount/grand total on the right.
 */
export function TotalsBand({
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
  const half = gstRate / 2;
  return (
    <div className={cn("grid grid-cols-1 divide-y border-b-2 sm:grid-cols-2 sm:divide-x sm:divide-y-0", RULE, SUBRULE)}>
      <div className="min-w-0">
        {gst ? (
          <table className={cn(CELL_TABLE, "text-right [&_th:first-child]:text-left [&_td:first-child]:text-left")}>
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th scope="col" className="font-semibold">Taxable value</th>
                {interState ? (
                  <th scope="col" className="font-semibold whitespace-nowrap">IGST @ {gstRate}%</th>
                ) : (
                  <>
                    <th scope="col" className="font-semibold whitespace-nowrap">CGST @ {half}%</th>
                    <th scope="col" className="font-semibold whitespace-nowrap">SGST @ {half}%</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tabular-nums">{formatMoney(taxable)}</td>
                {interState ? (
                  <td className="tabular-nums">{formatMoney(igst)}</td>
                ) : (
                  <>
                    <td className="tabular-nums">{formatMoney(cgst)}</td>
                    <td className="tabular-nums">{formatMoney(sgst)}</td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm text-zinc-500">No GST is charged on this document.</p>
        )}
      </div>
      <dl className="divide-y divide-zinc-300">
        <Row label="Subtotal" value={formatMoney(subtotal)} />
        {discount > 0 && <Row label="Discount" value={`− ${formatMoney(discount)}`} />}
        {gst && <Row label="Total GST" value={formatMoney(tax)} />}
        <Row label="Grand total" value={formatMoney(total)} strong />
        {extra}
      </dl>
    </div>
  );
}

/** "Amount in words" — its own full-width ruled line, the way a printed invoice states it. */
export function AmountInWordsBand({ total }: { total: number }) {
  const words = amountInWords(total);
  if (!words) return null;
  return (
    <div className={cn("border-b-2 px-4 py-2.5 text-sm text-zinc-700", RULE)}>
      <span className="font-semibold text-zinc-600">Amount in words: </span>
      Rupees {words} only
    </div>
  );
}

/** Payment terms, notes and terms & conditions. Empty blocks are left out; nothing to show renders nothing. */
export function DocTerms({ blocks }: { blocks: { heading: string; text?: string | null }[] }) {
  const shown = blocks.filter((b) => b.text && b.text.trim());
  if (!shown.length) return null;
  return (
    <>
      {shown.map((b) => (
        <div key={b.heading} className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{b.heading}</h3>
          <p className="mt-1 text-sm text-zinc-700 whitespace-pre-line break-words">{b.text}</p>
        </div>
      ))}
    </>
  );
}

/** "For <company>" + signature image + name — the authorized signature. */
export function DocSignature({ company }: { company: DocCompany }) {
  return (
    <div className="ml-auto min-w-[10rem] text-center">
      <div className="text-sm text-zinc-600">For {company.name || "Intense Care"}</div>
      <div className="h-16 flex items-end justify-center">
        {company.signature && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL from Settings
          <img src={company.signature} alt="Authorized signature" className="max-h-16 object-contain" />
        )}
      </div>
      <div className="border-t border-zinc-400 pt-1 text-sm font-semibold text-zinc-900">{company.signatoryName || "Authorized signatory"}</div>
    </div>
  );
}

/**
 * A generic two-column ruled row — terms on the left, a signature or
 * acceptance block on the right. Pass `last` on the row that closes the
 * sheet so it doesn't draw a bottom rule flush against the frame's own edge.
 */
export function TwoColRow({ left, right, last }: { left: React.ReactNode; right: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0", RULE, SUBRULE, !last && "border-b-2")}>
      <div className="p-4 min-w-0 space-y-3">{left}</div>
      <div className="p-4 min-w-0 flex flex-col justify-end">{right}</div>
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
