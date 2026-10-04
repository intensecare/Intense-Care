import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  className?: string;
  onClick?: () => void;
}

/**
 * KPI card, number-first. Deliberately quiet: label, value, one footnote.
 * The icon renders as a plain glyph (no tinted circle) and the optional
 * `change` note is plain text — color only signals a negative delta.
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  change,
  changeType = "neutral",
  className,
  onClick,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 transition-colors flex flex-col justify-between min-h-[96px]",
        onClick && "cursor-pointer hover:shadow-xs",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500 line-clamp-1">
          {title}
        </span>
        {Icon && <Icon className="h-3.5 w-3.5 text-zinc-300 shrink-0 mt-0.5" />}
      </div>

      <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 leading-none">
        {value}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2 flex-wrap">
        {subtitle && (
          <p className="text-[11px] text-zinc-400 truncate">{subtitle}</p>
        )}
        {change && (
          <span
            className={cn(
              "text-[11px] font-medium shrink-0",
              changeType === "negative" && "text-red-600",
              changeType === "positive" && "text-zinc-500",
              changeType === "neutral" && "text-zinc-400"
            )}
          >
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
