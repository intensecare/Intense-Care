import { getSystemSettings } from "./settings";
import type { NotificationSettings } from "@/lib/types";
import { prisma } from "./prisma";
import { logger, maskPhone } from "./logger";
import { deepLinkFor, ROLES, scopeOf, type Permission } from "@/lib/rbac";
import { resolveBaseUrl } from "./policy";

/**
 * §24/§26 — outbound notifications with ROLE-SPECIFIC DEEP LINKS.
 *
 * Every message carries the one link that opens the right action page for
 * the recipient's role (field app job, QC inspect screen, customer secure
 * link, finance payment) — never a generic dashboard. Delivery is env-gated
 * like every external channel: the body is always composed and audited
 * (SmsLog); the actual SMS/WhatsApp dispatch happens only when a provider is
 * configured.
 */

export interface NotifyResult {
  queued: boolean;
  provider: string;
  reason?: string;
}

function absolute(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${resolveBaseUrl(null)}${path}`;
}

function company(): string {
  return process.env.APP_COMPANY_NAME || "Intense Care";
}

async function auditAndMaybeSend(params: { jobId: string; phone: string; purpose: string; body: string }): Promise<NotifyResult> {
  const providerConfigured = Boolean(process.env.TWOFACTOR_API_KEY);
  const waCloud = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  const waConfigured = waCloud || Boolean(process.env.WHATSAPP_API_URL);
  const provider = waConfigured ? "whatsapp" : providerConfigured ? "2factor" : "none";

  if (!params.phone) return { queued: false, provider: "none", reason: "no_phone" };

  const log = await prisma.smsLog.create({
    data: {
      jobId: params.jobId,
      phone: params.phone,
      phoneLast4: params.phone.replace(/[^0-9]/g, "").slice(-4),
      purpose: params.purpose,
      provider,
      status: provider === "none" ? "FAILED" : "QUEUED",
      errorMessage: provider === "none" ? "provider_not_configured" : null,
    },
  });

  if (provider === "none") {
    logger.info("notify.audited_only", { jobId: params.jobId, purpose: params.purpose, phone: maskPhone(params.phone) });
    return { queued: false, provider, reason: "provider_not_configured" };
  }

  try {
    if (waCloud) {
      await sendWhatsAppCloud(params.phone, params.body);
    } else if (waConfigured) {
      await fetch(process.env.WHATSAPP_API_URL as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.WHATSAPP_API_TOKEN ? { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: params.phone, body: params.body, jobId: params.jobId, purpose: params.purpose }),
      });
    } else if (providerConfigured) {
      const url = `https://2factor.in/API/V1/${process.env.TWOFACTOR_API_KEY}/ADDON_SERVICES/SEND/TSMS`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ From: process.env.TWOFACTOR_SMS_SENDER || "INTCARE", To: params.phone, Msg: params.body }),
      });
    }
    await prisma.smsLog.update({ where: { id: log.id }, data: { status: "SENT" } });
    logger.info("notify.sent", { jobId: params.jobId, purpose: params.purpose, provider });
    return { queued: true, provider };
  } catch (e) {
    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e) },
    });
    logger.warn("notify.send_failed", { jobId: params.jobId, purpose: params.purpose, error: e instanceof Error ? e.message : String(e) });
    return { queued: false, provider, reason: "send_failed" };
  }
}

/**
 * WhatsApp Cloud API delivery (WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID).
 * With WHATSAPP_TEMPLATE_NAME the message goes out as that approved template
 * with the composed text as its one body variable ({{1}}) — required for
 * business-initiated messages; otherwise as a plain text message.
 */
async function sendWhatsAppCloud(phone: string, body: string): Promise<void> {
  const to = phone.replace(/[^0-9]/g, "");
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const payload = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}`);
}

/** Settings → Notifications: each automatic message can be switched off. */
async function notificationOn(key: keyof NotificationSettings): Promise<boolean> {
  const settings = await getSystemSettings();
  return settings.notifications?.[key] !== false;
}

/** Notification dedup: skip when the same purpose fired for the job recently. */
async function recentlySent(jobId: string, purpose: string, withinMs = 5 * 60 * 1000): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinMs);
  const row = await prisma.smsLog.findFirst({
    where: { jobId, purpose, status: { not: "FAILED" }, createdAt: { gt: cutoff } },
    select: { id: true },
  });
  return Boolean(row);
}

/** Active users whose role holds the permission (resolved from the matrix, not role names). */
async function usersWith(permission: Permission): Promise<{ id: string; name: string; phone: string; role: string }[]> {
  const roles = ROLES.filter((r) => scopeOf(r, permission) !== "NONE" && r !== "admin" && r !== "customer");
  const rows = await prisma.user.findMany({
    where: { role: { in: roles }, active: true },
    select: { id: true, name: true, phone: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length > 0) return rows;
  // Fall back to the first admin so the message is never lost.
  return prisma.user.findMany({ where: { role: "admin", active: true }, select: { id: true, name: true, phone: true, role: true }, take: 1 });
}

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

export async function notifyCustomerArrived(jobId: string, link: string): Promise<NotifyResult> {
  if (!(await notificationOn("customerArrived"))) return { queued: false, provider: "none", reason: "disabled_in_settings" };
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { customer: true } });
  if (!job?.customer) return { queued: false, provider: "none", reason: "no_customer" };
  if (await recentlySent(jobId, "CUSTOMER_ARRIVED")) return { queued: false, provider: "deduped" };
  const dl = deepLinkFor("customer", "team_arrived", { jobId, customerLink: link });
  const body = `${company()}: ${dl.message} ${dl.cta}: ${dl.path}`;
  return auditAndMaybeSend({ jobId, phone: job.customer.phone, purpose: "CUSTOMER_ARRIVED", body });
}

export async function notifyCustomerCompleted(jobId: string, link: string): Promise<NotifyResult> {
  if (!(await notificationOn("customerCompleted"))) return { queued: false, provider: "none", reason: "disabled_in_settings" };
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { customer: true } });
  if (!job?.customer) return { queued: false, provider: "none", reason: "no_customer" };
  if (await recentlySent(jobId, "CUSTOMER_COMPLETED")) return { queued: false, provider: "deduped" };
  const dl = deepLinkFor("customer", "qc_passed", { jobId, customerLink: link });
  const body = `${company()}: ${dl.message} ${dl.cta}: ${dl.path}`;
  return auditAndMaybeSend({ jobId, phone: job.customer.phone, purpose: "CUSTOMER_COMPLETED", body });
}

/* -------------------------------------------------------------------------- */
/* Field roles                                                                */
/* -------------------------------------------------------------------------- */

export async function notifyJobAssigned(jobId: string): Promise<NotifyResult> {
  if (!(await notificationOn("fieldManagerAssigned"))) return { queued: false, provider: "none", reason: "disabled_in_settings" };
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { queued: false, provider: "none", reason: "no_job" };
  if (await recentlySent(jobId, "JOB_ASSIGNED")) return { queued: false, provider: "deduped" };
  const crewIds = Array.from(new Set([...(job.assignedManagerId ? [job.assignedManagerId] : []), ...job.assignedStaffIds]));
  if (crewIds.length === 0) return { queued: false, provider: "none", reason: "no_crew" };
  const crew = await prisma.user.findMany({ where: { id: { in: crewIds }, active: true }, select: { id: true, phone: true, role: true } });
  let last: NotifyResult = { queued: false, provider: "none", reason: "no_crew" };
  for (const member of crew) {
    const dl = deepLinkFor(member.role, "job_assigned", { jobId });
    const body = `${company()}: ${dl.message} ${job.scheduledDate} ${job.scheduledTimeSlot}. ${dl.cta}: ${absolute(dl.path)}`;
    last = await auditAndMaybeSend({ jobId, phone: member.phone, purpose: "JOB_ASSIGNED", body });
  }
  return last;
}

export async function notifyReworkAssigned(jobId: string, link?: string): Promise<NotifyResult> {
  if (!(await notificationOn("reworkAssigned"))) return { queued: false, provider: "none", reason: "disabled_in_settings" };
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { queued: false, provider: "none", reason: "no_job" };
  const lead = job.assignedManagerId ?? job.assignedStaffIds[0];
  if (!lead) return { queued: false, provider: "none", reason: "no_lead" };
  const staff = await prisma.user.findUnique({ where: { id: lead } });
  if (!staff) return { queued: false, provider: "none", reason: "no_staff" };
  if (await recentlySent(jobId, "REWORK_ASSIGNED")) return { queued: false, provider: "deduped" };
  const dl = deepLinkFor(staff.role, "rework_assigned", { jobId });
  const body = `${company()}: ${dl.message} ${dl.cta}: ${link ?? absolute(dl.path)}`;
  return auditAndMaybeSend({ jobId, phone: staff.phone, purpose: "REWORK_ASSIGNED", body });
}

/* -------------------------------------------------------------------------- */
/* QC                                                                         */
/* -------------------------------------------------------------------------- */

export async function notifyQcReady(jobId: string, link?: string, mode: "inspection" | "reinspection" = "inspection"): Promise<NotifyResult> {
  if (!(await notificationOn("qcReady"))) return { queued: false, provider: "none", reason: "disabled_in_settings" };
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) return { queued: false, provider: "none", reason: "no_job" };
  const purpose = mode === "reinspection" ? "QC_REINSPECT" : "QC_READY";
  if (await recentlySent(jobId, purpose)) return { queued: false, provider: "deduped" };
  const inspectors = await usersWith("qc.inspect");
  if (inspectors.length === 0) return { queued: false, provider: "none", reason: "no_inspector" };
  let last: NotifyResult = { queued: false, provider: "none" };
  for (const inspector of inspectors) {
    const dl = deepLinkFor(inspector.role, "qc_ready", { jobId });
    const body = `${company()}: ${mode === "reinspection" ? "Rework completed — ready for reinspection." : dl.message} ${dl.cta}: ${link ?? absolute(dl.path)}`;
    last = await auditAndMaybeSend({ jobId, phone: inspector.phone, purpose, body });
  }
  return last;
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function notifyAccountsBillable(jobId: string): Promise<NotifyResult> {
  if (await recentlySent(jobId, "BILLABLE")) return { queued: false, provider: "deduped" };
  const accounts = await usersWith("invoice.finalize");
  let last: NotifyResult = { queued: false, provider: "none", reason: "no_accounts" };
  for (const a of accounts) {
    const dl = deepLinkFor(a.role, "customer_approved", { jobId });
    const body = `${company()}: ${dl.message} ${dl.cta}: ${absolute(dl.path)}`;
    last = await auditAndMaybeSend({ jobId, phone: a.phone, purpose: "BILLABLE", body });
  }
  return last;
}
