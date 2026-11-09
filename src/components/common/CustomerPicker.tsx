"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, UserPlus, X, Clock } from "lucide-react";
import { Input, Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import type { Customer } from "@/lib/types";

/** What the form should send: an existing customer, or the typed details of a new one (matched on phone by the server). */
export type CustomerChoice =
  | { kind: "existing"; customerId: string }
  | { kind: "new"; name: string; phone: string; email: string; address: string }
  | { kind: "none" };

const RECENT_KEY = "ic.recentCustomers";
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};
/** Remember a customer as recently used (called by the forms after a successful save). */
export function rememberCustomer(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* storage unavailable — recents just fall back to the newest customers */
  }
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Search by name or phone (any format), recently used customers first, and "new customer" typed inline — no page change. */
export function CustomerPicker({ value, onChange, autoFocus }: { value: CustomerChoice; onChange: (v: CustomerChoice) => void; autoFocus?: boolean }) {
  const { customers } = useApp();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setRecent(readRecent()), []);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const chosen = value.kind === "existing" ? customers.find((c) => c.id === value.customerId) : undefined;
  const results = useMemo<Customer[]>(() => {
    const t = q.trim().toLowerCase();
    const d = digits(q);
    if (!t) {
      const byId = new Map(customers.map((c) => [c.id, c]));
      const r = recent.map((x) => byId.get(x)).filter((c): c is Customer => !!c);
      const fill = [...customers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((c) => !r.includes(c));
      return [...r, ...fill].slice(0, 6);
    }
    return customers.filter((c) => c.name.toLowerCase().includes(t) || (d.length >= 3 && digits(c.phone).includes(d)) || c.email.toLowerCase().includes(t)).slice(0, 8);
  }, [q, customers, recent]);

  const pick = (c: Customer) => {
    onChange({ kind: "existing", customerId: c.id });
    setOpen(false);
    setQ("");
  };
  const startNew = () => {
    const d = digits(q);
    onChange({ kind: "new", name: d.length >= 5 ? "" : q.trim(), phone: d.length >= 5 ? q.trim() : "", email: "", address: "" });
    setOpen(false);
    setQ("");
  };

  if (value.kind === "new") {
    const set = (p: Partial<typeof value>) => onChange({ ...value, ...p });
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-zinc-800 inline-flex items-center gap-2"><UserPlus className="h-4 w-4" aria-hidden /> New customer</span>
          <button type="button" onClick={() => onChange({ kind: "none" })} className="text-sm font-semibold text-rose-700 min-h-10 px-2">Pick an existing one</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" required htmlFor={`${id}-n`}><Input id={`${id}-n`} autoFocus value={value.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" maxLength={160} /></Field>
          <Field label="Phone" htmlFor={`${id}-p`} hint="Optional — a number we already know is reused, not duplicated"><Input id={`${id}-p`} inputMode="tel" value={value.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" maxLength={32} /></Field>
          <Field label="Email" htmlFor={`${id}-e`}><Input id={`${id}-e`} type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" maxLength={200} /></Field>
          <Field label="Customer address" htmlFor={`${id}-a`}><Input id={`${id}-a`} value={value.address} onChange={(e) => set({ address: e.target.value })} autoComplete="off" maxLength={500} /></Field>
        </div>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      {chosen ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-white px-3.5 min-h-12 py-2">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-950 truncate">{chosen.name}</span>
            <span className="block text-xs text-zinc-500 truncate">{[chosen.phone, chosen.email].filter(Boolean).join(" · ") || "No phone on file"}</span>
          </span>
          <button type="button" aria-label="Change customer" onClick={() => { onChange({ kind: "none" }); setOpen(true); }} className="min-h-10 min-w-10 grid place-items-center text-zinc-500"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden />
            <Input
              role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label="Search customer by name or phone"
              autoFocus={autoFocus} placeholder="Search customer by name or phone" value={q} autoComplete="off" className="pl-10"
              onFocus={() => setOpen(true)}
              onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === "Enter" && open) { e.preventDefault(); if (active < results.length) pick(results[active]); else startNew(); }
                else if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          {open && (
            <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
              {!q.trim() && recent.length > 0 && <li className="px-3.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden /> Recent</li>}
              {results.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === active}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(c)} className={cn("w-full text-left px-3.5 py-2.5 min-h-12", i === active && "bg-rose-50")}>
                    <span className="block text-sm font-medium text-zinc-950 truncate">{c.name}</span>
                    <span className="block text-xs text-zinc-500 truncate">{c.phone}{c.address ? ` · ${c.address}` : ""}</span>
                  </button>
                </li>
              ))}
              <li role="option" aria-selected={active === results.length}>
                <button type="button" onMouseEnter={() => setActive(results.length)} onClick={startNew} className={cn("w-full text-left px-3.5 py-3 min-h-12 border-t border-zinc-100 text-sm font-semibold text-rose-700 inline-flex items-center gap-2", active === results.length && "bg-rose-50")}>
                  <UserPlus className="h-4 w-4" aria-hidden /> {q.trim() ? `New customer “${q.trim()}”` : "New customer"}
                </button>
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
