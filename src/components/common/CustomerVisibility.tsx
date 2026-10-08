"use client";

import React from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import {
  CUSTOMER_VISIBILITY_FIELDS,
  NEVER_CUSTOMER_VISIBLE,
  DEFAULT_CUSTOMER_VISIBILITY,
  normalizeVisibility,
  hiddenCount,
  type CustomerVisibility,
  type CustomerVisibilityKey,
} from "@/lib/visibility";
import { cn } from "@/lib/utils";

/**
 * §6 CUSTOMER VISIBILITY — the Admin control for what the customer sees.
 *
 * The switches here are a convenience, not the guard: the server filters every
 * customer-facing response through the same configuration (§8). The panel also
 * states plainly what has no switch at all, so nobody goes looking for one.
 */

const GROUP_ORDER = ["Service", "Progress", "Documents"] as const;

/** Internal information, spelled out. There is no switch for these. */
const NEVER_LABELS: Record<(typeof NEVER_CUSTOMER_VISIBLE)[number], string> = {
  internalStaffNotes: "Internal staff notes",
  internalQcComments: "Internal QC comments",
  internalCost: "Internal cost",
  staffSalary: "Staff salary",
  internalProfitMargin: "Internal profit / margin",
  supplierInformation: "Supplier information",
  internalOperationalNotes: "Internal operational notes",
  internalManagementComments: "Internal management comments",
  otherCustomers: "Other customers",
  internalReports: "Internal reports",
};

export function CustomerVisibilityEditor({
  value,
  onChange,
  disabled,
  className,
}: {
  value: CustomerVisibility;
  onChange: (next: CustomerVisibility) => void;
  disabled?: boolean;
  className?: string;
}) {
  const toggle = (key: CustomerVisibilityKey) =>
    onChange(normalizeVisibility({ ...value, [key]: !value[key] }, value));
  const hidden = hiddenCount(value);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start gap-3 rounded-xl border border-info-200 bg-info-50 px-3.5 py-3">
        <ShieldCheck className="h-5 w-5 text-info-700 mt-0.5 shrink-0" aria-hidden />
        <p className="text-sm text-info-700">
          {hidden === 0
            ? "The customer sees their whole service: status, photos, QC result and their own documents."
            : `${hidden} field${hidden === 1 ? "" : "s"} hidden from the customer. The server never sends what is switched off.`}
        </p>
      </div>

      {GROUP_ORDER.map((group) => {
        const fields = CUSTOMER_VISIBILITY_FIELDS.filter((f) => f.group === group);
        if (fields.length === 0) return null;
        return (
          <fieldset key={group} className="space-y-1.5">
            <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
              {group}
            </legend>
            {fields.map((f) => {
              const on = value[f.key];
              return (
                <label
                  key={f.key}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3.5 py-3 min-h-[52px] transition-colors",
                    f.locked
                      ? "border-zinc-200 bg-zinc-50 cursor-default"
                      : on
                      ? "border-emerald-200 bg-emerald-50/60 cursor-pointer"
                      : "border-zinc-200 bg-white cursor-pointer"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled || f.locked}
                    onChange={() => toggle(f.key)}
                    className="mt-0.5 h-5 w-5 accent-emerald-600 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                      {f.label}
                      {f.locked && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
                          <Lock className="h-3 w-3" aria-hidden /> always shown
                        </span>
                      )}
                    </span>
                    {f.hint && <span className="block text-xs text-zinc-500 mt-0.5">{f.hint}</span>}
                  </span>
                  {!f.locked && (
                    <span className="shrink-0 pt-0.5" aria-hidden>
                      {on ? (
                        <Eye className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-zinc-400" />
                      )}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Never visible to any customer
        </h4>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {NEVER_CUSTOMER_VISIBLE.map((k) => (
            <li key={k} className="text-sm text-zinc-600 flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden />
              {NEVER_LABELS[k]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          These have no switch anywhere in the product and are never sent to a customer.
        </p>
      </div>
    </div>
  );
}

/** Compact summary for a job screen: what this customer can and cannot see. */
export function CustomerVisibilitySummary({
  value,
  onEdit,
  className,
}: {
  value: CustomerVisibility;
  onEdit?: () => void;
  className?: string;
}) {
  const hidden = CUSTOMER_VISIBILITY_FIELDS.filter((f) => !f.locked && !value[f.key]);
  return (
    <section className={cn("rounded-2xl border border-zinc-200 bg-white p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Customer visibility</h3>
          <p className="text-sm font-medium text-zinc-950 mt-0.5">
            {hidden.length === 0 ? "Everything shareable is visible" : `${hidden.length} hidden`}
          </p>
          {hidden.length > 0 && (
            <p className="text-sm text-zinc-600 mt-1">
              Hidden: {hidden.map((f) => f.label).join(", ")}
            </p>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-sm font-semibold text-rose-600 underline-offset-4 hover:underline shrink-0"
          >
            Change
          </button>
        )}
      </div>
    </section>
  );
}

export { DEFAULT_CUSTOMER_VISIBILITY };
