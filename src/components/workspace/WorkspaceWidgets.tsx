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
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: "neutral" | "alert" | "warning" | "success";
  hint?: string;
}) {
  const body = (
    <div
      className={cn(
        "rounded-lg border bg-white p-4 min-h-[88px] flex flex-col justify-between transition-colors",
        tone === "alert" && "border-red-200",
        tone === "warning" && "border-amber-200",
        tone === "success" && "border-emerald-200",
        tone === "neutral" && "border-zinc-200",
        href && "hover:border-zinc-400 cursor-pointer"
      )}
    >
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tracking-tight leading-none mt-1",
          tone === "alert" ? "text-red-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-zinc-950"
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[11px] text-zinc-400 mt-1.5">{hint}</span>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** "What needs my attention?" — every row deep-links to the place to act. */
export function AttentionPanel({
  items,
  title = "Attention required",
  emptyLabel = "Nothing needs your attention right now.",
}: {
  items: { key: string; label: string; count: number; href: string }[];
  title?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
          <AlertTriangle className={cn("h-4 w-4", items.length ? "text-amber-500" : "text-zinc-300")} />
          {title}
        </h3>
        {items.length > 0 && <span className="text-[11px] text-zinc-400">{items.length} item{items.length === 1 ? "" : "s"}</span>}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {emptyLabel}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors">
                <span className="text-sm text-zinc-800">{it.label}</span>
                <span className="flex items-center gap-2">
                  <span className="min-w-[1.75rem] text-center px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    {it.count}
                  </span>
                  <ArrowRight className="h-4 w-4 text-zinc-300" />
                </span>
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
