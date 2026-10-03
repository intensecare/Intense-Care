"use client";

import React from "react";
import { Invoice, Payment } from "@/lib/types";

interface RevenueTrendChartProps {
  invoices: Invoice[];
  payments: Payment[];
  weeks?: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return d;
}

function compactMoney(v: number): string {
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${Math.round(v / 1000)}k`;
  return `₹${Math.round(v)}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Billed vs Collected revenue over the last N calendar weeks (Mon–Sun),
 * rendered as a dependency-free inline SVG. Billed = tax invoices issued in
 * the week; Collected = payments actually received (excludes failed/refunded).
 * super_admin-only by construction — the dashboard renders it inside the
 * finance branch only.
 */
export function RevenueTrendChart({ invoices, payments, weeks = 8 }: RevenueTrendChartProps) {
  const buckets = React.useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const windows: { start: Date; end: Date }[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      windows.push({ start, end });
    }

    return windows.map(({ start, end }) => {
      const from = start.getTime();
      const to = end.getTime();
      const billed = invoices.reduce((acc, inv) => {
        const t = new Date(inv.issuedAt).getTime();
        return t >= from && t < to ? acc + inv.total : acc;
      }, 0);
      const collected = payments.reduce((acc, p) => {
        if (p.status === "failed" || p.status === "refunded") return acc;
        const t = new Date(p.paidAt).getTime();
        return t >= from && t < to ? acc + p.amount : acc;
      }, 0);
      return { start, billed, collected };
    });
  }, [invoices, payments, weeks]);

  const max = Math.max(1, ...buckets.map((b) => Math.max(b.billed, b.collected)));
  const totalBilled = buckets.reduce((a, b) => a + b.billed, 0);
  const totalCollected = buckets.reduce((a, b) => a + b.collected, 0);
  const isEmpty = totalBilled === 0 && totalCollected === 0;

  // SVG geometry (fixed viewBox, scales responsively)
  const W = 640;
  const H = 200;
  const padL = 40;
  const padR = 10;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const px = (i: number) => padL + (plotW * i) / Math.max(1, buckets.length - 1);
  const py = (v: number) => padT + plotH * (1 - v / max);

  const billedLine = buckets.map((b, i) => `${px(i)},${py(b.billed)}`).join(" ");
  const collectedLine = buckets.map((b, i) => `${px(i)},${py(b.collected)}`).join(" ");
  const collectedArea = `${px(0)},${py(0)} ${collectedLine} ${px(buckets.length - 1)},${py(0)}`;
  const gridFractions = [1, 0.5, 0];

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-xs mb-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 font-sans">
            Business Trend — Billed vs Collected
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Weekly invoicing against verified receipts · last {weeks} weeks (Mon–Sun)
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium shrink-0 pt-0.5">
          <span className="flex items-center gap-1.5 text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Billed {compactMoney(totalBilled)}
          </span>
          <span className="flex items-center gap-1.5 text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Collected {compactMoney(totalCollected)}
          </span>
        </div>
      </div>

      {isEmpty ? (
        <div className="h-40 flex items-center justify-center">
          <p className="text-xs text-zinc-400">
            No invoicing activity in this window yet — raise a quotation or schedule a job to see the trend.
          </p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label="Billed versus collected revenue, weekly">
          <defs>
            <linearGradient id="rtcCollectedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines + axis labels */}
          {gridFractions.map((f) => {
            const gy = py(max * f);
            return (
              <g key={f}>
                <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={f === 0 ? "0" : "3 4"} />
                <text x={padL - 6} y={gy + 3} textAnchor="end" className="fill-slate-400" fontSize="9">
                  {compactMoney(max * f)}
                </text>
              </g>
            );
          })}

          {/* Collected area + lines */}
          <polygon points={collectedArea} fill="url(#rtcCollectedFill)" />
          <polyline points={billedLine} fill="none" stroke="#94a3b8" strokeWidth="1.75" strokeLinejoin="round" />
          <polyline points={collectedLine} fill="none" stroke="#059669" strokeWidth="2.25" strokeLinejoin="round" />

          {/* Point markers */}
          {buckets.map((b, i) => (
            <g key={i}>
              <circle cx={px(i)} cy={py(b.billed)} r="2.5" fill="#94a3b8" />
              <circle cx={px(i)} cy={py(b.collected)} r="3" fill="#059669" stroke="#ffffff" strokeWidth="1" />
            </g>
          ))}

          {/* Week labels */}
          {buckets.map((b, i) => (
            <text key={i} x={px(i)} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize="9">
              {shortDate(b.start)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
