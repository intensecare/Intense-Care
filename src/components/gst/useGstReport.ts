"use client";

import { useCallback, useEffect, useState } from "react";

export interface GstBucket {
  month: string;
  invoices: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  grandTotal: number;
}

/** GST summary from GET /api/invoices/report (GST invoices only, server-side). */
export function useGstReport(from: string, to: string) {
  const [data, setData] = useState<{ months: GstBucket[]; totals: GstBucket } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    try {
      const res = await fetch(`/api/invoices/report?${p.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(json?.error || "Could not load the GST report.");
      else setData(json.data);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

/** Indian financial-year and calendar ranges as YYYY-MM-DD (IST). */
export function periodRange(period: "month" | "quarter" | "fy"): { from: string; to: string } {
  const now = new Date(Date.now() + 330 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(now);
  if (period === "month") return { from: iso(new Date(Date.UTC(y, m, 1))), to };
  if (period === "quarter") {
    // GST quarters follow the financial year: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
    const qStart = Math.floor(((m + 9) % 12) / 3) * 3; // months since April
    const startMonth = (qStart + 3) % 12;
    const startYear = startMonth > m ? y - 1 : y;
    return { from: iso(new Date(Date.UTC(startYear, startMonth, 1))), to };
  }
  const fyStart = m >= 3 ? y : y - 1;
  return { from: iso(new Date(Date.UTC(fyStart, 3, 1))), to };
}

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};
