"use client";

import React from "react";
import { Play, MapPin, QrCode, ShieldCheck, Check, type LucideIcon } from "lucide-react";
import { START_MODES, START_MODE_INFO, type StartMode } from "@/lib/start-verification";
import { cn } from "@/lib/utils";

const ICON: Record<StartMode, LucideIcon> = {
  DIRECT: Play,
  GPS: MapPin,
  QR: QrCode,
  GPS_QR: ShieldCheck,
};

/**
 * The four job-start verification options as selectable cards (icon, title, short
 * description) — used wherever Admin picks the mode: Settings (company default),
 * New job (per-job override) and the job details page (change for this job).
 */
export function VerificationModeCards({
  value,
  onChange,
  modes = START_MODES,
  name,
}: {
  value: StartMode | null;
  onChange: (mode: StartMode) => void;
  /** Restrict to a subset (rare) — defaults to all four. */
  modes?: readonly StartMode[];
  name: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Job start verification mode">
      {modes.map((m) => {
        const info = START_MODE_INFO[m];
        const Icon = ICON[m];
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            name={name}
            onClick={() => onChange(m)}
            className={cn(
              "min-h-[88px] rounded-2xl border-2 p-4 text-left flex items-start gap-3 transition-colors",
              selected ? "border-rose-500 bg-rose-50/60" : "border-zinc-200 bg-white hover:border-zinc-300"
            )}
          >
            <span className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", selected ? "bg-rose-500 text-white" : "bg-zinc-100 text-zinc-600")}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block text-sm font-semibold text-zinc-950">{info.label}</span>
                {selected && <Check className="h-4 w-4 text-rose-600 shrink-0" aria-hidden />}
              </span>
              <span className="block text-xs text-zinc-500 mt-0.5">{info.short}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
