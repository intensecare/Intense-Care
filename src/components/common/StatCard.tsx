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
        "rounded-xl border border-zinc-200/90 bg-white p-4 shadow-xs hover:border-zinc-300 transition-all flex flex-col justify-between min-h-[118px]",
        onClick && "cursor-pointer hover:shadow-sm",
        className
      )}
    >
      {/* Title & Icon Header */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 line-clamp-1">
          {title}
        </span>
        {Icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100/80 text-zinc-600 border border-zinc-200/70">
            <Icon className="h-3.5 w-3.5 text-zinc-700" />
          </div>
        )}
      </div>

      {/* Value & Change Badge */}
      <div className="mt-2 flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 leading-none">
          {value}
        </div>
        {change && (
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold border shrink-0",
              changeType === "positive" && "bg-emerald-50 text-emerald-800 border-emerald-200/90",
              changeType === "negative" && "bg-rose-50 text-rose-800 border-rose-200/90 font-bold",
              changeType === "neutral" && "bg-zinc-100 text-zinc-700 border-zinc-200/90"
            )}
          >
            {change}
          </span>
        )}
      </div>

      {/* Subtitle Footer */}
      {subtitle && (
        <p className="mt-2 text-xs text-zinc-500 font-normal truncate border-t border-zinc-100 pt-2">
          {subtitle}
        </p>
      )}
    </div>
  );
}

