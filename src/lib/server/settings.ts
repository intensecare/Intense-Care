/**
 * Server-side system settings stored in the SystemSettings singleton table.
 * Falls back to structural defaults when unset (a fresh deployment has no
 * settings row — the company configures everything through the Settings page).
 */
import { prisma } from "./prisma";
import type { SystemSettings } from "@/lib/types";
import { DEFAULT_CUSTOMER_VISIBILITY } from "@/lib/visibility";

export const SETTINGS_ID = "singleton";

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  nextDayDispatchTime: "20:00",
  googleBusinessReviewUrl: "",
  currency: "INR",
  // Company identity printed on invoices/statements. Empty until configured on
  // the Settings page — documents render only real, configured values.
  companyName: "Intense Care",
  companyTagline: "Deep Cleaning Field Services",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  taxRatePercent: 18,
  taxLabel: "GST",
  gstin: "",
  sacCode: "",
  resendCooldownSeconds: 60,
  refundApprovalLimit: 5000,
  discountApprovalLimitPercent: 10,
  // §4/§5 Document identity. Empty until configured on the Settings page —
  // the quotation/invoice prints only real, configured values.
  companyLogoUrl: "",
  paymentTerms: "Payment due on completion of the service.",
  serviceTerms:
    "Prices are valid for the quoted scope only. Any additional work is quoted separately before it starts.",
  bankDetails: "",
  quotationValidityDays: 15,
  // §6 Company default for the customer portal; per-job overrides win.
  defaultCustomerVisibility: { ...DEFAULT_CUSTOMER_VISIBILITY },
};

/** Loads settings from the DB, merged over structural defaults. */
export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row || typeof row.data !== "object" || row.data === null) {
      return { ...DEFAULT_SYSTEM_SETTINGS };
    }
    return { ...DEFAULT_SYSTEM_SETTINGS, ...(row.data as Partial<SystemSettings>) };
  } catch {
    return { ...DEFAULT_SYSTEM_SETTINGS };
  }
}

/** Persists a settings patch and returns the merged result. */
export async function updateSystemSettings(
  patch: Partial<SystemSettings>
): Promise<SystemSettings> {
  const current = await getSystemSettings();
  const merged = { ...current, ...patch };
  await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, data: merged },
    update: { data: merged },
  });
  return merged;
}
