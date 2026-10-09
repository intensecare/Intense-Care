"use client";

import React from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CUSTOMER_VISIBILITY_KEYS, CUSTOMER_VISIBILITY_LABELS, type CustomerVisibility } from "@/lib/types";

const INTERNAL = ["Internal notes", "Internal cost", "Profit / margin", "Internal QC comments", "Staff information", "Internal management comments"];

/**
 * What the customer sees on their QR page. Switches for the customer-facing
 * items; internal items are listed as never shown. The server enforces this —
 * hidden items are not sent to the customer at all.
 */
export function VisibilityEditor({
  value,
  defaults,
  onChange,
  showInternal = true,
}: {
  /** The effective settings (company default merged with overrides). */
  value: CustomerVisibility;
  /** For "Default" hints; omit when editing the company default itself. */
  defaults?: CustomerVisibility;
  onChange: (next: CustomerVisibility) => void;
  showInternal?: boolean;
}) {
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CUSTOMER_VISIBILITY_KEYS.map((k) => {
          const on = value[k];
          const changed = defaults && defaults[k] !== on;
          return (
            <li key={k}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onChange({ ...value, [k]: !on })}
                className={cn(
                  "w-full min-h-12 rounded-xl border px-3.5 py-2 flex items-center gap-3 text-left text-sm font-medium transition-colors",
                  on ? "border-emerald-200 bg-emerald-50/60 text-zinc-900" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                {on ? <Eye className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden /> : <EyeOff className="h-4 w-4 text-zinc-400 shrink-0" aria-hidden />}
                <span className="flex-1 min-w-0">{CUSTOMER_VISIBILITY_LABELS[k]}</span>
                <span className={cn("text-xs font-semibold", on ? "text-emerald-700" : "text-zinc-500")}>{on ? "Shown" : "Hidden"}</span>
                {changed && <span className="text-xs text-amber-700">· changed</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {showInternal && (
        <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
            <Lock className="h-4 w-4" aria-hidden /> Never shown to customers
          </div>
          <p className="mt-1 text-sm text-zinc-500">{INTERNAL.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
