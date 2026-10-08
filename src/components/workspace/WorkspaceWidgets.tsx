"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NextAction } from "@/lib/rbac";

/** Number-first tile. Click-through optional. */
export function StatTile({
  label,
  value,
  href,
  tone = "neutral",
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: "neutral" | "alert" | "warning" | "success";
  hint?: string;
  icon?: React.ReactNode;
}) {
  const body = (
    <div
      className={cn(
        "group rounded-2xl border bg-white p-5 min-h-[116px] flex flex-col justify-between shadow-sm transition-all duration-200",
        tone === "alert" && "border-red-200",
        tone === "warning" && "border-amber-200",
        tone === "success" && "border-emerald-200",
        tone === "neutral" && "border-zinc-200",
        href && "hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
      )}
    >
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-500">
        {label}
        {icon && <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center", tone === "alert" ? "bg-red-50 text-red-600" : tone === "warning" ? "bg-amber-50 text-amber-700" : tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500")}>{icon}</span>}
      </span>
      <span
        className={cn(
          "text-4xl font-semibold tracking-tight leading-none mt-2",
          tone === "alert" ? "text-red-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-zinc-950"
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-zinc-400 mt-2">{hint}</span>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** "Attention Required" — one row per job that needs someone to act, each deep-linked. */
export function AttentionPanel({
  items,
  title = "Attention Required",
  emptyLabel = "All clear — nothing needs your attention right now.",
}: {
  items: { key: string; title: string; reason: string; href: string; tone: "alert" | "warning" }[];
  title?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
          <AlertTriangle className={cn("h-5 w-5", items.length ? "text-amber-500" : "text-zinc-300")} />
          {title}
        </h2>
        {items.length > 0 && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-zinc-500 flex flex-col items-center gap-2">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" /> {emptyLabel}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="flex items-center gap-3 px-5 py-4 hover:bg-zinc-50 transition-colors">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", it.tone === "alert" ? "bg-red-500" : "bg-amber-500")} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900 truncate">{it.title}</span>
                  <span className={cn("block text-sm", it.tone === "alert" ? "text-red-700" : "text-amber-800")}>{it.reason}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-zinc-300 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The ONE next-action chip for a queue row. */
export function NextActionChip({ action }: { action: NextAction | null }) {
  if (!action) return null;
  const waiting = action.waiting || action.kind === "wait";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border whitespace-nowrap",
        waiting
          ? "bg-zinc-50 text-zinc-500 border-zinc-200"
          : action.tone === "warning"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : action.tone === "success"
          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
          : "bg-rose-50 text-rose-700 border-rose-200"
      )}
    >
      {waiting ? <Clock className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
      {action.label}
    </span>
  );
}

/** Large, thumb-reach primary button for the field + portal shells (≥ 44px). */
export function PrimaryAction({
  label,
  onClick,
  disabled,
  busy,
  tone = "primary",
  icon,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "success" | "warning" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "w-full h-14 rounded-xl text-base font-semibold shadow-sm inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-60",
        tone === "primary" && "bg-rose-500 text-white hover:bg-rose-600 active:bg-rose-700",
        tone === "success" && "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
        tone === "warning" && "bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700",
        tone === "neutral" && "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
      )}
    >
      {busy ? <Clock className="h-5 w-5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

/** Waiting state card ("Waiting for QC") for the field shell. */
export function WaitingCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-center gap-2 font-semibold text-base">
        <Clock className="h-5 w-5" /> {title}
      </div>
      <p className="text-sm mt-1 text-amber-800">{hint}</p>
    </div>
  );
}
