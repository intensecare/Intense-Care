/**
 * Server-side system settings stored in the SystemSettings singleton table.
 * Falls back to structural defaults when unset (a fresh deployment has no
 * settings row — the company configures everything through the Settings page).
 */
import { prisma } from "./prisma";
import type { SystemSettings } from "@/lib/types";

export const SETTINGS_ID = "singleton";

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  nextDayDispatchTime: "20:00",
  googleBusinessReviewUrl: "",
  currency: "INR",
  taxRatePercent: 18,
  taxLabel: "GST",
  gstin: "",
  sacCode: "",
  otpExpiryMinutes: 15,
  otpMaxRetries: 3,
  resendCooldownSeconds: 60,
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
