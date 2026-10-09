import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, parsePaging } from "@/lib/server/biz";
import { LeadFields, actorOf, cleanLeadData, createLead, filtersFromUrl, hydrateLeads, leadStats, leadWhere, openDuplicates, validateRefs } from "@/lib/server/leads";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, phoneKey, type LeadSource, type LeadStatus } from "@/lib/leads";

/**
 * GET /api/leads — the pipeline (leads.view). Filters: q, from, to, source,
 * status, assignedUserId, followUp=today|overdue; page / pageSize, or
 * view=board for every lead (Kanban). Always returns the dashboard figures
 * for the same date / source / search filters.
 * ?format=csv exports the filtered list; ?format=ads-conversions exports WON
 * leads that carry a Google Ads click id, in Google Ads' offline-conversion
 * import layout.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("leads.view");
    const url = new URL(request.url);
    const f = filtersFromUrl(url);
    const where = leadWhere(f);
    const format = url.searchParams.get("format");
    const orderBy: Prisma.LeadOrderByWithRelationInput[] = url.searchParams.get("sort") === "followUp" ? [{ nextFollowUpDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }] : [{ createdAt: "desc" }];

    if (format === "csv") {
      const rows = await hydrateLeads(await prisma.lead.findMany({ where, orderBy, take: 10000 }));
      void recordAudit({ actor: user, action: "LEADS_EXPORTED", entityType: "lead", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse(
        `leads_${f.from ?? "all"}_${f.to ?? "all"}`,
        rows.map((r) => ({
          "Lead ID": r.leadNumber, Created: r.createdAt.slice(0, 10), Name: r.customerName, Phone: r.phone, Email: r.email ?? "",
          Source: LEAD_SOURCE_LABEL[r.source], "Source details": r.sourceDetails ?? "", Service: r.serviceName ?? r.serviceInterest ?? "",
          Location: [r.propertyAddress, r.locality, r.city, r.postalCode].filter(Boolean).join(", "), "Preferred date": r.preferredDate ?? "",
          "Estimated value": r.estimatedValue ?? "", Status: LEAD_STATUS_LABEL[r.status], "Lost reason": r.lostReason ?? "", "Assigned to": r.assignedUserName ?? "",
          "Next follow-up": r.nextFollowUpDate ?? "", "Last contacted": r.lastContactedAt?.slice(0, 16).replace("T", " ") ?? "", Quotation: r.quoteNumber ?? "", Job: r.convertedJobNumber ?? "",
          utm_source: r.utmSource ?? "", utm_medium: r.utmMedium ?? "", utm_campaign: r.utmCampaign ?? "",
        }))
      );
    }
    if (format === "ads-conversions") {
      const rows = await prisma.lead.findMany({ where: { AND: [where, { status: "WON", gclid: { not: null } }] }, orderBy: { convertedAt: "asc" } });
      const conversionName = process.env.GOOGLE_ADS_CONVERSION_NAME || "Lead won";
      return csvResponse(
        "google_ads_offline_conversions",
        rows.map((r) => ({
          "Google Click ID": r.gclid,
          "Conversion Name": conversionName,
          // Google Ads accepts "yyyy-mm-dd hh:mm:ss+zzzz".
          "Conversion Time": new Date((r.convertedAt ?? r.updatedAt).getTime() + 330 * 60000).toISOString().slice(0, 19).replace("T", " ") + "+0530",
          "Conversion Value": r.estimatedValue ?? "",
          "Conversion Currency": "INR",
        }))
      );
    }

    const board = url.searchParams.get("view") === "board";
    const { page, pageSize, skip, take } = parsePaging(url, 25, 200);
    const [rows, total, stats] = await Promise.all([
      prisma.lead.findMany({ where, orderBy, skip: board ? 0 : skip, take: board ? 1000 : take }),
      prisma.lead.count({ where }),
      // The cards count every status, so the status filter is not applied to them.
      leadStats(leadWhere(f, ["status", "followUp"])),
    ]);
    return ok({ rows: await hydrateLeads(rows), total, page, pageSize, stats });
  } catch (err) {
    return errorResponse(err, "leads.get.route_error");
  }
}

const CreateSchema = LeadFields.extend({
  /** Create even though an open lead with this phone exists (the user saw the warning). */
  allowDuplicate: z.boolean().optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP"]).optional(),
});

/** POST /api/leads — add a lead by hand (leads.manage). Warns about an open lead with the same phone. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("leads.manage");
    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid lead.", 400);
    const { allowDuplicate, status, ...d } = parsed.data;
    await validateRefs(d);
    const dupes = await openDuplicates(phoneKey(d.phone));
    if (dupes.length && !allowDuplicate) {
      return Response.json(
        { success: false, code: "DUPLICATE", error: `An open lead already exists for this phone: ${dupes.map((x) => `${x.leadNumber} (${x.customerName})`).join(", ")}. Open it, or save anyway.`, duplicates: dupes.map((x) => ({ id: x.id, leadNumber: x.leadNumber, status: x.status, customerName: x.customerName })) },
        { status: 409 }
      );
    }
    const data = cleanLeadData(d);
    const lead = await createLead(
      { ...data, customerName: d.customerName, phone: d.phone, source: d.source as LeadSource, status: (status ?? "NEW") as LeadStatus, lastContactedAt: status && status !== "NEW" ? new Date() : null },
      actorOf(user),
      { type: "CREATED", message: `Lead created by hand (${LEAD_SOURCE_LABEL[d.source as LeadSource]})${dupes.length ? ` — saved although ${dupes.map((x) => x.leadNumber).join(", ")} is open for the same phone` : ""}` }
    );
    void recordAudit({ actor: user, action: "LEAD_CREATED", entityType: "lead", entityId: lead.id, newState: lead.status, details: `${lead.leadNumber} source=${lead.source}`, request });
    return ok((await hydrateLeads([lead], { duplicates: true }))[0], 201);
  } catch (err) {
    return errorResponse(err, "leads.post.route_error");
  }
}
