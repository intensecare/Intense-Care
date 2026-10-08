import { Check } from "lucide-react";
import { cn } from "@/lib/format";
import { CUSTOMER_STEPS, customerStepIndex, type OrderStatus } from "@/lib/workflow";

/** The order journey: Created → Picked Up → Processing → Quality Check → Ready → Out for Delivery → Delivered. */
export function Progress({ status, vertical = false, times }: { status: OrderStatus; vertical?: boolean; times?: (string | null)[] }) {
  const current = customerStepIndex(status);
  if (status === "CANCELLED") {
    return <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">This order was cancelled.</div>;
  }
  const reworking = status === "QC_FAILED" || status === "REWORK";

  if (vertical) {
    return (
      <ol className="relative">
        {CUSTOMER_STEPS.map((label, i) => {
          const done = i < current || (i === current && status === "DELIVERED");
          const now = i === current && status !== "DELIVERED";
          return (
            <li key={label} className="relative flex gap-4 pb-6 last:pb-0">
              {i < CUSTOMER_STEPS.length - 1 && (
                <span className={cn("absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5", i < current ? "bg-brand-600" : "bg-slate-200")} />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                  done ? "border-brand-600 bg-brand-600 text-white" : now ? "border-brand-600 bg-white text-brand-700" : "border-slate-200 bg-white text-slate-400"
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <div className="pt-1">
                <div className={cn("text-base", done || now ? "font-semibold text-slate-900" : "text-slate-400")}>{label}</div>
                {now && <div className="text-sm text-brand-700">{reworking && i === 3 ? "Being re-done to meet our quality standard" : "In progress"}</div>}
                {times?.[i] && (done || now) && <div className="text-xs text-slate-500">{times[i]}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className="grid grid-cols-7 gap-1">
      {CUSTOMER_STEPS.map((label, i) => {
        const done = i < current || status === "DELIVERED";
        const now = i === current && status !== "DELIVERED";
        return (
          <li key={label} className="flex flex-col items-center gap-1.5 text-center">
            <span className={cn("h-2 w-full rounded-full", done ? "bg-brand-600" : now ? (reworking ? "bg-red-400" : "bg-brand-300") : "bg-slate-200")} />
            <span className={cn("hidden text-[11px] leading-tight sm:block", now ? "font-semibold text-slate-900" : done ? "text-slate-600" : "text-slate-400")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
