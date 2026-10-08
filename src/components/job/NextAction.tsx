import React from "react";
import { ChevronRight, Clock } from "lucide-react";
import type { NextAction as NextActionModel } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * NEXT ACTION — the one thing to do now, derived from the job state by
 * getNextAction(). Shows a waiting state when it's someone else's turn.
 */
export function NextActionCard({
  action,
  onAction,
  busy,
  disabled,
  title = "Next action",
  className,
}: {
  action: NextActionModel | null;
  onAction?: () => void;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  if (!action) return null;
  const waiting = action.waiting || action.kind === "wait" || !onAction;
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-4",
        waiting ? "border-zinc-200 bg-white" : action.tone === "warning" ? "border-amber-300 bg-amber-50/60" : "border-rose-200 bg-rose-50/40",
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
        <div className="mt-1 text-lg font-semibold text-zinc-950 flex items-center gap-2">
          {waiting && <Clock className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />}
          {action.label}
        </div>
        <p className="text-sm text-zinc-600 mt-0.5">{action.hint}</p>
      </div>
      {!waiting && (
        <Button size="lg" loading={busy} disabled={disabled} onClick={onAction} variant={action.tone === "success" ? "success" : "default"} className="w-full sm:w-auto">
          {action.label} <ChevronRight className="h-5 w-5" aria-hidden />
        </Button>
      )}
    </section>
  );
}

/** The sticky bottom bar that holds a screen's ONE primary action on phones. */
export function StickyActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>
      <div className="max-w-md mx-auto">{children}</div>
    </div>
  );
}
