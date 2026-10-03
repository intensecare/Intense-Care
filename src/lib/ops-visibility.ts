import { Job, SystemSettings } from "./types";

/**
 * Ops Manager scheduling visibility rules.
 *
 * The Ops Manager assigns ready jobs to field workers; they do not create or
 * schedule bookings. Their planning window is intentionally restricted:
 *
 *   - days before today   → visible (historical work)
 *   - today               → visible (today's work)
 *   - tomorrow            → visible ONLY at/after the dispatch cutoff
 *                           (default 20:00 = 8:00 PM) on today's clock
 *   - beyond tomorrow     → never visible
 *
 * All date math runs on the BUSINESS wall clock (IST, UTC+5:30 — no DST),
 * NOT the host clock: the API and this UI must agree even though the deployed
 * server runs in UTC and the browser runs in the user's local timezone.
 * Previously `now.getHours()` was used directly, so a 9:00 PM IST user saw an
 * "unlocked" banner while the UTC server still filtered tomorrow's jobs out.
 * The cutoff hour/minute comes from SystemSettings.nextDayDispatchTime ("20:00").
 */

/** Business timezone offset from UTC in minutes (IST = +5:30 = 330). */
const BUSINESS_TZ_OFFSET_MINUTES = 330;

/**
 * Shifts an instant so plain local getters (getHours/getDate/…) read the
 * BUSINESS wall clock regardless of the machine's own timezone.
 * Exported for deterministic testing of the host-independence invariant.
 */
export function toBusinessWallClock(now: Date): Date {
  return new Date(now.getTime() + (BUSINESS_TZ_OFFSET_MINUTES + now.getTimezoneOffset()) * 60_000);
}

export interface OpsDateVisibility {
  today: string; // YYYY-MM-DD local
  tomorrow: string; // YYYY-MM-DD local
  cutoffTime: string; // "HH:MM" as configured
  isAfterCutoff: boolean;
  /** Latest date (YYYY-MM-DD) the Ops Manager may currently see. */
  maxVisibleDate: string; // tomorrow if after cutoff, else today
  /** True when a date string is within the Ops Manager's permitted window. */
  isDateVisible: (dateStr: string) => boolean;
}

function parseCutoff(cutoff: string): { hour: number; minute: number } {
  const [h, m] = (cutoff || "20:00").split(":").map((n) => Number.parseInt(n, 10));
  const hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 20;
  const minute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  return { hour, minute };
}

/** YYYY-MM-DD of N days from today (local calendar). */
function localDateOffset(days: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Computes the current Ops Manager visibility window.
 * `now` and `settings` are injectable for deterministic testing.
 */
export function getOpsDateVisibility(
  now: Date = new Date(),
  settings?: Partial<Pick<SystemSettings, "nextDayDispatchTime">>
): OpsDateVisibility {
  const cutoffTime = settings?.nextDayDispatchTime || "20:00";
  const { hour, minute } = parseCutoff(cutoffTime);

  // Evaluate everything on the business wall clock (see doc comment above):
  // identical result in the IST browser and on a UTC server.
  const wall = toBusinessWallClock(now);

  const today = localDateOffset(0, wall);
  const tomorrow = localDateOffset(1, wall);

  const currentMinutes = wall.getHours() * 60 + wall.getMinutes();
  const cutoffMinutes = hour * 60 + minute;
  const isAfterCutoff = currentMinutes >= cutoffMinutes;

  const maxVisibleDate = isAfterCutoff ? tomorrow : today;

  return {
    today,
    tomorrow,
    cutoffTime,
    isAfterCutoff,
    maxVisibleDate,
    isDateVisible: (dateStr: string) => {
      if (!dateStr) return true; // undated/legacy jobs remain visible
      // Visible when strictly before tomorrow... or (after cutoff) <= tomorrow.
      return dateStr <= maxVisibleDate;
    },
  };
}

/** Filters a job list down to what the Ops Manager may see. */
export function filterJobsForOpsManager<T extends Pick<Job, "scheduledDate">>(
  jobs: T[],
  visibility: OpsDateVisibility
): T[] {
  return jobs.filter((j) => visibility.isDateVisible(j.scheduledDate));
}
