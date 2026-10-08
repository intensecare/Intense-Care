/**
 * §6 / §8 CUSTOMER VISIBILITY — the one place that decides what a customer
 * may see about their own job.
 *
 * Two hard rules:
 *
 *  1. **The server decides, not the UI.** Every customer-facing response is
 *     built by filtering through `visibleFields()`. Hidden data is never sent
 *     to the browser and then hidden with CSS — if a flag is off, the field is
 *     absent from the JSON (see `src/app/api/customer/job/[token]/route.ts`).
 *
 *  2. **Internal business information is never configurable.** The keys in
 *     `NEVER_CUSTOMER_VISIBLE` (internal notes, internal QC comments, cost,
 *     salary, margin, suppliers, management comments, other customers,
 *     internal reports) have no switch anywhere in the product. There is no
 *     payload, query string or settings value that can turn them on.
 *
 * Admin configures the switchable fields per job (New Job → step 7) over the
 * company default stored in SystemSettings.defaultCustomerVisibility.
 */

/** Fields Admin can show or hide on the customer portal. */
export const CUSTOMER_VISIBILITY_KEYS = [
  "jobId",
  "serviceName",
  "serviceDate",
  "serviceLocation",
  "teamName",
  "jobStatus",
  "beforePhotos",
  "afterPhotos",
  "qcResult",
  "invoice",
  "quotation",
  "paymentStatus",
  "serviceNotes",
  "customerFeedback",
] as const;

export type CustomerVisibilityKey = (typeof CUSTOMER_VISIBILITY_KEYS)[number];

export type CustomerVisibility = Record<CustomerVisibilityKey, boolean>;

export interface VisibilityFieldSpec {
  key: CustomerVisibilityKey;
  label: string;
  /** Grouping for the Admin editor. */
  group: "Service" | "Progress" | "Documents";
  /** Short help text shown under the switch. */
  hint?: string;
  /** Fields the portal cannot work without — shown but not switchable. */
  locked?: boolean;
}

/**
 * The Admin-facing list. `jobId`, `serviceName` and `jobStatus` are locked on:
 * a service page that cannot say which job it is, what was done or where it
 * stands is not a service page. Everything else is a real choice.
 */
export const CUSTOMER_VISIBILITY_FIELDS: VisibilityFieldSpec[] = [
  { key: "jobId", label: "Job ID", group: "Service", locked: true, hint: "The customer needs it to talk to you about the job." },
  { key: "serviceName", label: "Service name", group: "Service", locked: true },
  { key: "jobStatus", label: "Job status", group: "Progress", locked: true },
  { key: "serviceDate", label: "Service date", group: "Service" },
  { key: "serviceLocation", label: "Service location", group: "Service", hint: "Address and map/navigation link." },
  { key: "teamName", label: "Assigned team name", group: "Service", hint: "First names of the crew on site." },
  { key: "beforePhotos", label: "Before photos", group: "Progress" },
  { key: "afterPhotos", label: "After photos", group: "Progress" },
  { key: "qcResult", label: "QC result", group: "Progress", hint: "Pass / being checked only — never QC findings." },
  { key: "serviceNotes", label: "Service notes", group: "Progress", hint: "Only notes written for the customer." },
  { key: "customerFeedback", label: "Customer feedback", group: "Progress", hint: "Their own rating, back on the page." },
  { key: "quotation", label: "Quotation", group: "Documents" },
  { key: "invoice", label: "Invoice", group: "Documents" },
  { key: "paymentStatus", label: "Payment status", group: "Documents" },
];

/**
 * Information that is NEVER sent to a customer, by any flag, for any job.
 * Listed so the rule is reviewable in one place and testable.
 */
export const NEVER_CUSTOMER_VISIBLE = [
  "internalStaffNotes",
  "internalQcComments",
  "internalCost",
  "staffSalary",
  "internalProfitMargin",
  "supplierInformation",
  "internalOperationalNotes",
  "internalManagementComments",
  "otherCustomers",
  "internalReports",
] as const;

export type NeverVisibleKey = (typeof NEVER_CUSTOMER_VISIBLE)[number];

/** Keys that stay on whatever is configured. */
export const LOCKED_VISIBILITY_KEYS: CustomerVisibilityKey[] = CUSTOMER_VISIBILITY_FIELDS.filter(
  (f) => f.locked
).map((f) => f.key);

/**
 * The company default — a complete, open-but-safe service page. Every
 * switchable field is on; nothing internal is in this object at all.
 */
export const DEFAULT_CUSTOMER_VISIBILITY: CustomerVisibility = Object.freeze(
  Object.fromEntries(CUSTOMER_VISIBILITY_KEYS.map((k) => [k, true]))
) as CustomerVisibility;

/**
 * Coerces anything (a JSON column, a request body, a settings blob) into a
 * complete visibility record. Unknown keys are dropped, missing keys fall
 * back to `base`, and locked keys are forced on — so a malformed or hostile
 * payload can never widen OR break the portal.
 */
export function normalizeVisibility(
  raw: unknown,
  base: CustomerVisibility = DEFAULT_CUSTOMER_VISIBILITY
): CustomerVisibility {
  const out = { ...base } as CustomerVisibility;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const src = raw as Record<string, unknown>;
    for (const key of CUSTOMER_VISIBILITY_KEYS) {
      if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
    }
  }
  for (const key of LOCKED_VISIBILITY_KEYS) out[key] = true;
  return out;
}

/**
 * The effective visibility for one job: the job's own override (if any) over
 * the company default (if any) over the product default.
 */
export function effectiveVisibility(
  jobOverride: unknown,
  companyDefault?: unknown
): CustomerVisibility {
  const company = normalizeVisibility(companyDefault, DEFAULT_CUSTOMER_VISIBILITY);
  return normalizeVisibility(jobOverride, company);
}

/** True when the customer portal may show `key` for this job. */
export function isVisible(visibility: CustomerVisibility, key: CustomerVisibilityKey): boolean {
  return visibility[key] === true;
}

/**
 * Drops every key whose flag is off. Used to build customer payloads: the
 * hidden keys are absent from the response, not merely unrendered.
 */
export function pickVisible<T extends Partial<Record<CustomerVisibilityKey, unknown>>>(
  visibility: CustomerVisibility,
  fields: T
): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(fields) as [CustomerVisibilityKey, T[CustomerVisibilityKey]][]) {
    if (isVisible(visibility, k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** How many switchable fields are hidden — shown on the Admin job screen. */
export function hiddenCount(visibility: CustomerVisibility): number {
  return CUSTOMER_VISIBILITY_FIELDS.filter((f) => !f.locked && !visibility[f.key]).length;
}
