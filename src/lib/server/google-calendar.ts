import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";

/**
 * §1 Google Calendar integration — env-gated, fire-and-forget.
 *
 * Every job gets one calendar event containing customer, service, time,
 * address, team, contact and the job id; job updates refresh the event and
 * cancellation cancels it (event status → cancelled, per the requirement to
 * cancel on cancel). Nothing here can break the job pipeline: callers use
 * `void syncJobEvent(...)` and every failure is logged and swallowed.
 *
 * Connection is established by placing OAuth credentials in the environment:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — OAuth client (Calendar API)
 *   GOOGLE_REFRESH_TOKEN — offline refresh token with calendar.events scope
 *   GOOGLE_CALENDAR_ID   — optional, defaults to "primary"
 * Settings → Integrations then reports Connected (or Not Connected).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_BASE = "https://www.googleapis.com/calendar/v3/calendars";

export function googleEnvConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
  );
}

export function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

/** Connected = credentials present AND the stored handshake succeeded. */
export async function getGoogleIntegrationStatus() {
  const envReady = googleEnvConfigured();
  const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const data = (settingsRow?.data ?? {}) as {
    googleCalendar?: { connected?: boolean; calendarEmail?: string; connectedAt?: string; lastSyncAt?: string };
  };
  const cal = data.googleCalendar ?? {};
  return {
    envConfigured: envReady,
    connected: envReady && cal.connected === true,
    calendarEmail: cal.calendarEmail ?? null,
    connectedAt: cal.connectedAt ?? null,
    lastSyncAt: cal.lastSyncAt ?? null,
  };
}

/** Persist the connection marker shown in Settings → Integrations. */
async function markConnectedState(patch: Record<string, unknown>) {
  try {
    const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
    const data = (settingsRow?.data ?? {}) as Record<string, unknown>;
    const next = { ...data, googleCalendar: { ...(data.googleCalendar ?? {}), ...patch } };
    await prisma.systemSettings.upsert({
      where: { id: "singleton" },
      update: { data: next as object },
      create: { id: "singleton", data: next as object },
    });
  } catch (e) {
    logger.warn("gcal.mark_state_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!googleEnvConfigured()) return null;
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.token;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      logger.warn("gcal.token_exchange_failed", { status: res.status });
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return cachedToken.token;
  } catch (e) {
    logger.warn("gcal.token_exchange_error", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** One calendar event per job: customer, service, time, address, team, contact, job id. */
async function buildEventPayload(jobId: string): Promise<{
  payload: Record<string, unknown> | null;
  cancelled: boolean;
  existingEventId: string | null;
}> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      customer: { select: { name: true, phone: true } },
      property: { select: { title: true, address: true } },
      service: { select: { name: true, estimatedDurationHours: true } },
    },
  });
  if (!job) return { payload: null, cancelled: false, existingEventId: null };

  const team = job.assignedStaffIds.length
    ? await prisma.user.findMany({ where: { id: { in: job.assignedStaffIds } }, select: { name: true } })
    : [];
  const teamNames = team.map((t) => t.name).join(", ");

  const start = `${job.scheduledDate}T09:00:00`;
  const durationH = 3; // slot-agnostic reminder block
  const end = `${job.scheduledDate}T${String(9 + durationH).padStart(2, "0")}:00:00`;

  const description = [
    `Job ID: ${job.id}`,
    `Customer: ${job.customer?.name ?? "—"}`,
    `Contact: ${job.customer?.phone ?? "—"}`,
    `Service: ${job.service?.name ?? "Deep Cleaning"}`,
    `Address: ${job.property?.address ?? "—"}`,
    `Team: ${teamNames || "Not yet assigned"}`,
  ].join("\n");

  const payload = {
    summary: `Intense Care · ${job.service?.name ?? "Deep Cleaning"} — ${job.customer?.name ?? job.id}`,
    description,
    location: job.property?.address ?? undefined,
    status: job.status === "CANCELLED" ? ("cancelled" as const) : ("confirmed" as const),
    start: { dateTime: start, timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata" },
    end: { dateTime: end, timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata" },
    extendedProperties: { private: { jobId: job.id } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 120 }] },
  };

  return { payload, cancelled: job.status === "CANCELLED", existingEventId: job.googleEventId ?? null };
}

async function upsertEvent(jobId: string): Promise<void> {
  const { payload, existingEventId } = await buildEventPayload(jobId);
  if (!payload) return;
  const token = await getAccessToken();
  if (!token) return;

  const base = `${EVENTS_BASE}/${encodeURIComponent(calendarId())}/events`;
  try {
    if (existingEventId) {
      const res = await fetch(`${base}/${encodeURIComponent(existingEventId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 404 || res.status === 410) {
        // Event vanished (expired/deleted) — recreate to keep the calendar true.
        await createEvent(jobId, payload, base, token);
      } else if (!res.ok) {
        logger.warn("gcal.event_update_failed", { jobId, status: res.status });
        return;
      }
    } else {
      await createEvent(jobId, payload, base, token);
    }
    await markConnectedState({ connected: true, lastSyncAt: new Date().toISOString() });
  } catch (e) {
    logger.warn("gcal.upsert_error", { jobId, error: e instanceof Error ? e.message : String(e) });
  }
}

async function createEvent(jobId: string, payload: Record<string, unknown>, base: string, token: string) {
  const res = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    logger.warn("gcal.event_create_failed", { jobId, status: res.status });
    return;
  }
  const created = (await res.json()) as { id?: string };
  if (created.id) {
    // Idempotent: duplicate calendar events are prevented by storing the id —
    // every later sync PATCHes the same event instead of creating another.
    await prisma.job.update({ where: { id: jobId }, data: { googleEventId: created.id } });
  }
}

/** Fire-and-forget sync — safe to call after any job create/update. */
export async function syncJobEvent(jobId: string): Promise<void> {
  if (!googleEnvConfigured()) return;
  await upsertEvent(jobId);
}

/** Cancel the calendar event when a job is cancelled (status → cancelled). */
export async function cancelJobEvent(jobId: string): Promise<void> {
  if (!googleEnvConfigured()) return;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { googleEventId: true } });
  if (!job?.googleEventId) return;
  const token = await getAccessToken();
  if (!token) return;
  try {
    // Per Calendar API semantics the event is cancelled (kept for record), not deleted.
    const res = await fetch(
      `${EVENTS_BASE}/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(job.googleEventId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      }
    );
    if (!res.ok) logger.warn("gcal.cancel_failed", { jobId, status: res.status });
  } catch (e) {
    logger.warn("gcal.cancel_error", { jobId, error: e instanceof Error ? e.message : String(e) });
  }
}
