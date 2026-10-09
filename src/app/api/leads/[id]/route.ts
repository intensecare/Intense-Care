import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { getSystemSettings } from "@/lib/server/settings";
import { createJobWithInvoice, afterJobCreated, validateCrew } from "@/lib/server/job-create";
import {
  LeadFields,
  LinkCustomerSchema,
  actorOf,
  addActivity,
  cleanLeadData,
  customersWithPhone,
  ensureCustomerAndProperty,
  hydrateLeads,
  serializeActivity,
  validateRefs,
} from "@/lib/server/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, OPEN_LEAD_STATUSES, type LeadStatus } from "@/lib/leads";

async function loadLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new HttpError(404, "Lead not found.");
  return lead;
}

async function respond(id: string, status = 200) {
  const [lead, activity] = await Promise.all([prisma.lead.findUniqueOrThrow({ where: { id } }), prisma.leadActivity.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 200 })]);
  const [row] = await hydrateLeads([lead], { duplicates: true });
  const matches = lead.convertedCustomerId ? [] : await customersWithPhone(lead.phoneKey);
  return ok({ lead: row, activity: activity.map(serializeActivity), matchingCustomers: matches }, status);
}

/** GET /api/leads/[id] — the lead, its full history, duplicates and customers with the same phone. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("leads.view");
    await loadLead(params.id);
    return respond(params.id);
  } catch (err) {
    return errorResponse(err, "leads.get_one.route_error");
  }
}

const PatchSchema = LeadFields.partial().extend({
  status: z.enum(LEAD_STATUSES).optional(),
  lostReason: z.string().trim().max(300).nullable().optional(),
  /** Optimistic concurrency: the updatedAt the editor loaded. */
  expectedUpdatedAt: z.string().optional(),
});

/** PATCH /api/leads/[id] — edit details and/or move the status (LOST needs a reason). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("leads.manage");
    const parsed = PatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid update.", 400);
    const { status, lostReason, expectedUpdatedAt, ...fields } = parsed.data;
    const lead = await loadLead(params.id);
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== lead.updatedAt.getTime()) {
      return fail("Someone else changed this lead. Reload it and try again.", 409);
    }
    await validateRefs(fields);
    const data: Record<string, unknown> = cleanLeadData(fields);
    const notes: string[] = [];

    if (status && status !== lead.status) {
      if (lead.convertedJobId) return fail("This lead is already a job — its status can't change.", 409);
      if (status === "LOST") {
        if (!lostReason || lostReason.trim().length < 3) return fail("Give the reason this lead was lost.", 400);
        data.lostReason = lostReason.trim();
      } else data.lostReason = null;
      data.status = status;
      if (status !== "NEW" && lead.status === "NEW") data.lastContactedAt = lead.lastContactedAt ?? new Date();
      notes.push(`Status ${LEAD_STATUS_LABEL[lead.status as LeadStatus]} → ${LEAD_STATUS_LABEL[status]}${status === "LOST" ? ` — ${data.lostReason}` : ""}`);
    } else if (lostReason !== undefined && lead.status === "LOST") {
      if (!lostReason || lostReason.trim().length < 3) return fail("Give the reason this lead was lost.", 400);
      data.lostReason = lostReason.trim();
    }
    if (fields.assignedUserId !== undefined && fields.assignedUserId !== lead.assignedUserId) {
      const who = fields.assignedUserId ? (await prisma.user.findUnique({ where: { id: fields.assignedUserId }, select: { name: true } }))?.name : null;
      notes.push(who ? `Assigned to ${who}` : "Unassigned");
    }
    if (fields.nextFollowUpDate !== undefined && (fields.nextFollowUpDate || null) !== lead.nextFollowUpDate) {
      notes.push(fields.nextFollowUpDate ? `Follow-up set for ${fields.nextFollowUpDate}` : "Follow-up cleared");
    }
    if (!Object.keys(data).length) return respond(params.id);

    // Compare-and-set on the version we read, so two editors can't silently overwrite each other.
    const r = await prisma.lead.updateMany({ where: { id: lead.id, updatedAt: lead.updatedAt }, data });
    if (r.count === 0) return fail("Someone else changed this lead. Reload it and try again.", 409);
    const changed = Object.keys(data).filter((k) => !["phoneKey", "lostReason", "lastContactedAt"].includes(k));
    await addActivity(lead.id, {
      type: status && status !== lead.status ? "STATUS_CHANGED" : "UPDATED",
      message: notes.length ? notes.join(" · ") : `Updated: ${changed.join(", ")}`,
      ...actorOf(user),
    });
    void recordAudit({ actor: user, action: status && status !== lead.status ? "LEAD_STATUS_CHANGED" : "LEAD_UPDATED", entityType: "lead", entityId: lead.id, previousState: lead.status, newState: (data.status as string) ?? lead.status, reason: (data.lostReason as string) ?? undefined, details: changed.join(","), request });
    return respond(params.id);
  } catch (err) {
    return errorResponse(err, "leads.patch.route_error");
  }
}

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("note"), message: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("follow-up"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("follow-up-done"), note: z.string().trim().max(1000).optional(), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
  z.object({ action: z.literal("link-quote"), quoteId: z.string().min(1).max(64).nullable() }),
  LinkCustomerSchema.extend({ action: z.literal("link-customer") }),
  LinkCustomerSchema.extend({
    action: z.literal("convert"),
    serviceId: z.string().min(1).max(64),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledTimeSlot: z.string().min(1).max(80).regex(/^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/, "Time window like 09:00 - 13:00"),
    assignedManagerId: z.string().max(64).optional(),
    invoiceType: z.enum(["GST", "NON_GST"]).optional(),
    notes: z.string().max(2000).optional(),
  }),
]);

/** POST /api/leads/[id] — note, follow-up, link a quotation, link / create the customer, convert to customer & job. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("leads.manage");
    const parsed = ActionSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid request.", 400);
    const body = parsed.data;
    const lead = await loadLead(params.id);
    const actor = actorOf(user);

    if (body.action === "note") {
      await addActivity(lead.id, { type: "NOTE", message: body.message, ...actor });
      await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
      return respond(lead.id);
    }

    if (body.action === "follow-up") {
      await prisma.lead.update({ where: { id: lead.id }, data: { nextFollowUpDate: body.date } });
      await addActivity(lead.id, { type: "FOLLOW_UP_SET", message: `${body.date ? `Follow-up set for ${body.date}` : "Follow-up cleared"}${body.note ? ` — ${body.note}` : ""}`, ...actor });
      return respond(lead.id);
    }

    if (body.action === "follow-up-done") {
      await prisma.lead.update({ where: { id: lead.id }, data: { nextFollowUpDate: body.nextDate ?? null, lastContactedAt: new Date(), ...(lead.status === "NEW" ? { status: "CONTACTED" } : {}) } });
      await addActivity(lead.id, { type: "FOLLOW_UP_DONE", message: `Follow-up done${lead.nextFollowUpDate ? ` (was due ${lead.nextFollowUpDate})` : ""}${body.note ? ` — ${body.note}` : ""}${body.nextDate ? ` · next follow-up ${body.nextDate}` : ""}`, ...actor });
      return respond(lead.id);
    }

    if (body.action === "link-quote") {
      if (body.quoteId) {
        const q = await prisma.quote.findUnique({ where: { id: body.quoteId }, select: { id: true, customerId: true, quoteNumber: true, jobId: true } });
        if (!q) return fail("Quotation not found.", 404);
        if (!lead.convertedCustomerId || q.customerId !== lead.convertedCustomerId) return fail("That quotation is for a different customer. Link the lead to the customer first.", 400);
        const advance = OPEN_LEAD_STATUSES.includes(lead.status as LeadStatus) && ["NEW", "CONTACTED", "QUALIFIED"].includes(lead.status);
        await prisma.lead.update({ where: { id: lead.id }, data: { quoteId: q.id, ...(advance ? { status: "QUOTATION_SENT" } : {}), ...(q.jobId && !lead.convertedJobId ? { convertedJobId: q.jobId, convertedAt: new Date(), convertedBy: user.id, status: "WON" } : {}) } });
        await addActivity(lead.id, { type: "QUOTE_LINKED", message: `Quotation ${q.quoteNumber} linked${advance ? " — status Quotation sent" : ""}${q.jobId ? " (already converted to a job)" : ""}`, ...actor });
      } else {
        await prisma.lead.update({ where: { id: lead.id }, data: { quoteId: null } });
        await addActivity(lead.id, { type: "QUOTE_LINKED", message: "Quotation unlinked", ...actor });
      }
      return respond(lead.id);
    }

    if (body.action === "link-customer") {
      if (lead.status === "LOST") return fail("Reopen the lead before linking a customer.", 409);
      const res = await ensureCustomerAndProperty(lead, body, user);
      void recordAudit({ actor: user, action: "LEAD_CUSTOMER_LINKED", entityType: "lead", entityId: lead.id, details: `customer=${res.customerId} property=${res.propertyId} reused=${res.customerReused}`, request });
      return respond(lead.id);
    }

    // ------------------------------------------------------------- convert
    if (lead.convertedJobId) return fail("This lead has already been converted to a job.", 409);
    if (lead.status !== "WON") return fail("Mark the lead as Won before converting it.", 409);
    if (lead.quoteId) {
      const q = await prisma.quote.findUnique({ where: { id: lead.quoteId }, select: { quoteNumber: true, jobId: true } });
      if (q && !q.jobId) return fail(`This lead has quotation ${q.quoteNumber}. Convert the quotation to a job (its prices carry over) — the lead is linked automatically.`, 409);
    }
    const service = await prisma.service.findUnique({ where: { id: body.serviceId }, select: { id: true, active: true, gstTreatment: true } });
    if (!service || !service.active) return fail("Choose an active service.", 400);
    const crew = await validateCrew(user, { assignedManagerId: body.assignedManagerId, scheduledDate: body.scheduledDate, scheduledTimeSlot: body.scheduledTimeSlot });

    // Claim the conversion first: a double click or a second user gets a clean 409, never a second job.
    const claim = await prisma.lead.updateMany({ where: { id: lead.id, convertedJobId: null, convertedAt: null }, data: { convertedAt: new Date(), convertedBy: user.id } });
    if (claim.count === 0) return fail("This lead is already being converted. Refresh in a moment.", 409);
    try {
      const { customerId, propertyId, customerReused } = await ensureCustomerAndProperty(lead, body, user);
      const settings = await getSystemSettings();
      const { job } = await createJobWithInvoice(
        {
          customerId,
          propertyId,
          serviceId: service.id,
          scheduledDate: body.scheduledDate,
          scheduledTimeSlot: body.scheduledTimeSlot.replace(/\s*[-–]\s*/, " - "),
          assignedManagerId: crew.assignedManagerId,
          assignedStaffIds: [],
          notes: [`From lead ${lead.leadNumber}`, body.notes?.trim()].filter(Boolean).join(" — "),
          invoice: { type: body.invoiceType ?? (service.gstTreatment === "NON_GST" ? "NON_GST" : "GST"), interState: false },
        },
        settings
      );
      await prisma.lead.update({ where: { id: lead.id }, data: { convertedJobId: job.id, convertedCustomerId: customerId, convertedPropertyId: propertyId } });
      await addActivity(lead.id, { type: "CONVERTED", message: `Converted to job ${job.jobSerial} (${customerReused ? "existing" : "new"} customer)`, ...actor });
      afterJobCreated(job.id, user);
      void recordAudit({ actor: user, action: "LEAD_CONVERTED", entityType: "lead", entityId: lead.id, jobId: job.id, newState: "WON", details: `${lead.leadNumber} → ${job.jobSerial}`, request });
      return respond(lead.id, 201);
    } catch (e) {
      // Release the claim so the user can fix the problem and try again (linked customer/property are kept).
      await prisma.lead.updateMany({ where: { id: lead.id, convertedJobId: null }, data: { convertedAt: null, convertedBy: null } });
      throw e;
    }
  } catch (err) {
    return errorResponse(err, "leads.action.route_error");
  }
}
