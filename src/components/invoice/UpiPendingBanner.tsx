"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { callApi } from "@/components/biz/Bits";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/utils";

interface Row { id: string; amount: number; customerName: string | null; invoice: { id: string; number: string } | null }

/** Admin invoices page: customer UPI payments waiting to be checked against the bank. */
export function UpiPendingBanner() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!can("payment.record")) return;
    void callApi<Row[]>("/api/payments/upi?status=SUBMITTED").then((r) => r.data && setRows(r.data));
  }, [can]);
  if (!rows.length) return null;
  return (
    <div role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div className="font-semibold">{rows.length} UPI payment{rows.length === 1 ? "" : "s"} waiting to be checked against the bank</div>
      <ul className="mt-1 space-y-0.5">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>{r.invoice ? <Link className="underline font-medium" href={`/invoices/${r.invoice.id}`}>{r.invoice.number}</Link> : "Invoice"} · {formatMoney(r.amount)}{r.customerName ? ` · ${r.customerName}` : ""}</li>
        ))}
      </ul>
    </div>
  );
}
