import { prisma } from "./prisma";
import { logger, maskPhone } from "./logger";

/**
 * §26 — outbound customer/staff notifications with SECURE LINKS.
 *
 * Delivery is env-gated like every external channel: the message body and its
 * deep link are always composed and audited (SmsLog), but the actual SMS/
 * WhatsApp dispatch only happens when a provider is configured. The link —
 * never phone numbers, amounts, or internal data — is the only sensitive-ish
 * payload, and it is a hashed, revocable, expiring token.
 */

export interface NotifyResult {
  queued: boolean;
  provider: string;
  reason?: string;
}

function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel && !vercel.startsWith("localhost")) {
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  return "http://localhost:3000";
}

async function auditAndMaybeSend(params: {
  jobId: string;
  phone: string;
  purpose: string;
  body: string;
}): Promise<NotifyResult> {
  const providerConfigured = Boolean(process.env.TWOFACTOR_API_KEY);
  const waConfigured = Boolean(process.env.WHATSAPP_API_URL);
  const provider = waConfigured ? "whatsapp" : providerConfigured ? "2factor" : "none";

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
    // Transactional dispatch is env-gated: WHATSAPP_API_URL (future WhatsApp
    // BSP webhook) takes priority, else 2Factor DLT transactional route.
    if (waConfigured) {
      await fetch(process.env.WHATSAPP_API_URL as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.WHATSAPP_API_TOKEN ? { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: params.phone, body: params.body, jobId: params.jobId, purpose: params.purpose }),
      });
    } else if (providerConfigured) {
      // 2Factor transactional fallback: dedicated route replaced by their
      // DLT SMS API. Errors are logged, never thrown into the job flow.
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

/** Notification dedup: skip when the same purpose fired for the job recently. */
async function recentlySent(jobId: string, purpose: string, withinMs = 5 * 60 * 1000): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinMs);
  const row = await prisma.smsLog.findFirst({
    where: { jobId, purpose, status: { not: "FAILED" }, createdAt: { gt: cutoff } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function notifyCustomerArrived(jobId: string, link: string): Promise<NotifyResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { customer: true } });
  if (!job?.customer) return { queued: false, provider: "none", reason: "no_customer" };
  if (await recentlySent(jobId, "CUSTOMER_ARRIVED")) return { queued: false, provider: "deduped" };
  const company = process.env.APP_COMPANY_NAME || "Intense Care";
  const body = `${company}: Your service team has arrived at ${job.propertyId ? "your property" : "the property"}. Review and confirm: ${link}`;
  return auditAndMaybeSend({ jobId, phone: job.customer.phone, purpose: "CUSTOMER_ARRIVED", body });
}

export async function notifyQcReady(jobId: string, link?: string): Promise<NotifyResult> {
  // QC notification goes to ops managers (staff with QC role). We audit the
  // dispatch; the QC desk also sees a live badge. The QC link is minted for
  // the inspector by the admin panel when needed — the notification carries
  // the job reference, not a blanket public link, unless a link was provided.
  const ops = await prisma.user.findFirst({ where: { role: "ops_manager", active: true }, orderBy: { createdAt: "asc" } });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!ops || !job) return { queued: false, provider: "none", reason: "no_ops_manager" };
  if (await recentlySent(jobId, "QC_READY")) return { queued: false, provider: "deduped" };
  const company = process.env.APP_COMPANY_NAME || "Intense Care";
  const body = `${company}: New quality check ready for job ${job.id}.${link ? ` Open QC: ${link}` : ""}`;
  return auditAndMaybeSend({ jobId, phone: ops.phone, purpose: "QC_READY", body });
}

export async function notifyReworkAssigned(jobId: string, link?: string): Promise<NotifyResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { queued: false, provider: "none", reason: "no_job" };
  const lead = job.assignedStaffIds[0];
  if (!lead) return { queued: false, provider: "none", reason: "no_lead" };
  const staff = await prisma.user.findUnique({ where: { id: lead } });
  if (!staff) return { queued: false, provider: "none", reason: "no_staff" };
  if (await recentlySent(jobId, "REWORK_ASSIGNED")) return { queued: false, provider: "deduped" };
  const company = process.env.APP_COMPANY_NAME || "Intense Care";
  const body = `${company}: Rework assigned on job ${job.id}.${link ? ` Open rework: ${link}` : " Check the field app."}`;
  return auditAndMaybeSend({ jobId, phone: staff.phone, purpose: "REWORK_ASSIGNED", body });
}

export async function notifyCustomerCompleted(jobId: string, link: string): Promise<NotifyResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { customer: true } });
  if (!job?.customer) return { queued: false, provider: "none", reason: "no_customer" };
  if (await recentlySent(jobId, "CUSTOMER_COMPLETED")) return { queued: false, provider: "deduped" };
  const company = process.env.APP_COMPANY_NAME || "Intense Care";
  const body = `${company}: Your service has been completed and quality checked. Review & approve: ${link}`;
  return auditAndMaybeSend({ jobId, phone: job.customer.phone, purpose: "CUSTOMER_COMPLETED", body });
}
