import { prisma } from "./prisma";
import { logger } from "./logger";
import { dayKey, messages, pushToUsers, userIdsWithRole } from "./push";
import { purgeExpiredContacts } from "./contact-sync";
import { OPEN_LEAD_STATUSES, todayIST } from "@/lib/leads";
import { slotStartMinutes } from "@/lib/schedule-slot";

/** Field Managers get one reminder for each of today's jobs that starts within the next hour. */
export async function sendJobReminders(now = new Date(), windowMinutes = 75): Promise<number> {
  const ist = new Date(now.getTime() + 330 * 60000);
  const today = ist.toISOString().slice(0, 10);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const jobs = await prisma.job.findMany({
    where: { scheduledDate: today, status: { in: ["SCHEDULED", "ASSIGNED"] } },
    select: { id: true, scheduledTimeSlot: true, assignedManagerId: true, assignedStaffIds: true },
  });
  let sent = 0;
  for (const j of jobs) {
    const start = slotStartMinutes(j.scheduledTimeSlot);
    if (start === null || start < nowMin || start - nowMin > windowMinutes) continue;
    const crew = Array.from(new Set([...(j.assignedManagerId ? [j.assignedManagerId] : []), ...j.assignedStaffIds]));
    const r = await pushToUsers(crew, messages.jobReminder(j.id), (u) => `job-reminder:${j.id}:${u}:${today}`);
    sent += r.SENT;
  }
  return sent;
}

/** From 09:00 IST, each person with lead follow-ups due or overdue gets ONE push that day. */
export async function sendFollowUpAlerts(now = new Date()): Promise<number> {
  const ist = new Date(now.getTime() + 330 * 60000);
  if (ist.getUTCHours() < 9) return 0;
  const today = todayIST(now.getTime());
  const due = await prisma.lead.findMany({ where: { status: { in: OPEN_LEAD_STATUSES }, nextFollowUpDate: { lte: today, not: null } }, select: { assignedUserId: true } });
  if (!due.length) return 0;
  const admins = await userIdsWithRole(["admin"]);
  const perUser = new Map<string, number>();
  for (const l of due) for (const u of l.assignedUserId ? [l.assignedUserId] : admins) perUser.set(u, (perUser.get(u) ?? 0) + 1);
  let sent = 0;
  for (const [user, count] of Array.from(perUser)) {
    const r = await pushToUsers([user], messages.followUps(count), () => `lead-followups:${dayKey(now.getTime())}`);
    sent += r.SENT;
  }
  return sent;
}

export async function runMaintenance(now = new Date()) {
  const out = { reminders: 0, followUps: 0, purged: { contacts: 0, batches: 0, runs: 0 }, pushLedger: 0, errors: [] as string[] };
  const step = async (name: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      out.errors.push(name);
      logger.error("maintenance.step_failed", { step: name, error: e instanceof Error ? e.message : String(e) });
    }
  };
  await step("reminders", async () => void (out.reminders = await sendJobReminders(now)));
  await step("followUps", async () => void (out.followUps = await sendFollowUpAlerts(now)));
  await step("purge", async () => void (out.purged = await purgeExpiredContacts()));
  await step("pushLedger", async () => void (out.pushLedger = (await prisma.pushNotification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } })).count));
  return out;
}

export { slotStartMinutes } from "@/lib/schedule-slot";
