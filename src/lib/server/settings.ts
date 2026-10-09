/**
 * Server-side system settings stored in the SystemSettings singleton table.
 * Falls back to structural defaults when unset (a fresh deployment has no
 * settings row — the company configures everything through the Settings page).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { SystemSettings, CustomerVisibility } from "@/lib/types";
import { DEFAULT_SYSTEM_SETTINGS } from "@/lib/initial-config";
import { CUSTOMER_VISIBILITY_KEYS } from "@/lib/types";

export const SETTINGS_ID = "singleton";

export { DEFAULT_SYSTEM_SETTINGS };

/** Loads settings from the DB, merged over structural defaults. */
export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row || typeof row.data !== "object" || row.data === null) {
      return { ...DEFAULT_SYSTEM_SETTINGS };
    }
    const data = row.data as Partial<SystemSettings>;
    return {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...data,
      // Nested groups merge key by key so new options get their defaults.
      customerVisibility: { ...DEFAULT_SYSTEM_SETTINGS.customerVisibility, ...(data.customerVisibility ?? {}) },
      notifications: { ...DEFAULT_SYSTEM_SETTINGS.notifications, ...(data.notifications ?? {}) },
      referralRules: { ...DEFAULT_SYSTEM_SETTINGS.referralRules, ...(data.referralRules ?? {}) },
      jobStartVerification: { ...DEFAULT_SYSTEM_SETTINGS.jobStartVerification, ...(data.jobStartVerification ?? {}) },
    };
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
  const data = merged as unknown as Prisma.InputJsonObject;
  await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, data },
    update: { data },
  });
  return merged;
}

/** The effective customer visibility of a job: company default + the job's own choices. */
export function resolveVisibility(defaults: CustomerVisibility, override: unknown): CustomerVisibility {
  const out = { ...defaults };
  if (override && typeof override === "object") {
    for (const k of CUSTOMER_VISIBILITY_KEYS) {
      const v = (override as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}
