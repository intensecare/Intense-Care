import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { rateLimit, clientIp } from "@/lib/server/qr-service";
import { addActivity, createLead, openDuplicates } from "@/lib/server/leads";
import { attributeWebsiteLead, isPlausiblePhone, phoneKey } from "@/lib/leads";

/**
 * POST /api/public/enquiry — the website enquiry form. No sign-in; protected by:
 *   - an origin allowlist (LEAD_FORM_ALLOWED_ORIGINS + APP_BASE_URL) for browsers,
 *   - a hidden honeypot field and a minimum fill time (bots fill instantly),
 *   - rate limits per IP and per phone, strict validation and a link limit,
 *   - duplicate merge: an open lead with the same phone gets the enquiry added
 *     to its history instead of a second lead.
 * The reply never says whether a lead already existed (no data leaks).
 * Only what the visitor typed plus the page's UTM tags / Google Ads click id /
 * referrer are stored — no tracking beyond what the browser sent.
 */

const s = (max: number) => z.string().trim().max(max).optional().nullable();
const Schema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(120),
  phone: z.string().trim().min(6).max(24).refine(isPlausiblePhone, "Please enter a valid phone number"),
  email: z.string().trim().email("Please enter a valid email").max(160).optional().or(z.literal("")),
  service: s(200),
  location: s(300),
  postalCode: s(16),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  message: s(2000),
  // Attribution captured by the page.
  utm_source: s(120),
  utm_medium: s(120),
  utm_campaign: s(200),
  utm_term: s(200),
  utm_content: s(200),
  gclid: s(300),
  landingPage: s(500),
  referrer: s(500),
  // Spam controls.
  company_website: z.string().max(200).optional(), // honeypot — must stay empty
  startedAt: z.number().int().optional(), // ms timestamp when the form was shown
});

function allowedOrigins(): string[] {
  const list = (process.env.LEAD_FORM_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (base) {
    try {
      list.push(new URL(base).origin);
    } catch {}
  }
  return list;
}

function cors(origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const h = cors(origin);
  return new NextResponse(null, { status: h["Access-Control-Allow-Origin"] ? 204 : 403, headers: h });
}

const THANKS = "Thank you! We've received your enquiry and will call you shortly.";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });
  try {
    // A browser on a site that isn't on the list is refused.
    // Same site = the browser's Origin host equals the host it sent the request to
    // (request.url can carry the bind address, e.g. 0.0.0.0, behind a proxy).
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let sameSite = false;
    try {
      sameSite = !!origin && !!host && new URL(origin).host === host;
    } catch {}
    if (origin && !sameSite && !headers["Access-Control-Allow-Origin"]) return reply({ success: false, error: "Enquiries from this website aren't accepted." }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 20_000) return reply({ success: false, error: "That message is too long." }, 413);

    const ip = clientIp(request);
    if (!rateLimit(`enquiry-ip:${ip}`, 5, 10 * 60 * 1000).ok) return reply({ success: false, error: "Too many enquiries from this connection. Please call us or try again later." }, 429);

    const parsed = Schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply({ success: false, error: parsed.error.issues[0]?.message || "Please check the form." }, 400);
    const d = parsed.data;

    // Spam signals: honeypot filled, submitted impossibly fast (or a stale form), too many links.
    const age = typeof d.startedAt === "number" ? Date.now() - d.startedAt : null;
    const links = `${d.message ?? ""} ${d.name}`.match(/https?:\/\/|www\./gi)?.length ?? 0;
    if (d.company_website || age === null || age < 3000 || age > 24 * 3600 * 1000 || links > 1) {
      logger.warn("enquiry.spam_dropped", { ip, honeypot: !!d.company_website, age, links });
      return reply({ success: true, message: THANKS }); // looks accepted to a bot; nothing is stored
    }
    const key = phoneKey(d.phone);
    if (!rateLimit(`enquiry-phone:${key}`, 3, 60 * 60 * 1000).ok) return reply({ success: true, message: THANKS });

    const attribution = attributeWebsiteLead({ utmSource: d.utm_source, utmMedium: d.utm_medium, utmCampaign: d.utm_campaign, gclid: d.gclid, referrerUrl: d.referrer });
    const summary = [`Website enquiry${d.service ? ` for ${d.service}` : ""}`, d.preferredDate ? `preferred date ${d.preferredDate}` : null, d.location ? `at ${d.location}` : null, d.message ? `“${d.message}”` : null].filter(Boolean).join(" · ");
    const actor = { actorId: null, actorName: "Website form" };

    const open = await openDuplicates(key);
    if (open.length) {
      const lead = open[0];
      await addActivity(lead.id, { type: "WEBSITE_ENQUIRY", message: `Repeat enquiry — ${summary} (${attribution.details})`, ...actor });
      await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
      return reply({ success: true, message: THANKS });
    }
    await createLead(
      {
        customerName: d.name,
        phone: d.phone,
        email: d.email ? d.email.toLowerCase() : null,
        source: attribution.source,
        sourceDetails: attribution.details,
        serviceInterest: d.service || null,
        propertyAddress: d.location || null,
        postalCode: d.postalCode || null,
        preferredDate: d.preferredDate || null,
        notes: d.message || null,
        utmSource: d.utm_source || null,
        utmMedium: d.utm_medium || null,
        utmCampaign: d.utm_campaign || null,
        utmTerm: d.utm_term || null,
        utmContent: d.utm_content || null,
        gclid: d.gclid || null,
        landingPage: d.landingPage || null,
        referrerUrl: d.referrer || null,
      },
      actor,
      { type: "WEBSITE_ENQUIRY", message: summary }
    );
    return reply({ success: true, message: THANKS }, 201);
  } catch (err) {
    logger.error("enquiry.failed", { error: err instanceof Error ? err.message : String(err) });
    return reply({ success: false, error: "Something went wrong. Please call us instead." }, 500);
  }
}
