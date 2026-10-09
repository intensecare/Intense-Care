import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { actorOf, addActivity, createLead, hydrateLeads, openDuplicates } from "@/lib/server/leads";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, isPlausiblePhone, phoneKey, type CallOutcome } from "@/lib/leads";

/**
 * POST /api/leads/log-call — the quick "Log Call" form for calls on the
 * office's normal mobile SIM. Calls are NOT detected automatically (that needs
 * a telephony provider); someone records each call here. An open lead with the
 * same phone gets the call added to its history; otherwise a PHONE_CALL lead is
 * created.
 */
const Schema = z.object({
  phone: z.string().trim().min(6).max(24).refine(isPlausiblePhone, "Enter a valid phone number"),
  callerName: z.string().trim().max(120).optional(),
  direction: z.enum(["INCOMING", "OUTGOING"]).default("INCOMING"),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(2000).optional(),
  serviceInterest: z.string().trim().max(200).optional(),
  nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Add to this lead instead of looking it up by phone. */
  leadId: z.string().max(64).optional(),
});

const REACHED: CallOutcome[] = ["INTERESTED", "CALL_BACK", "QUOTE_REQUESTED", "BOOKED", "NOT_INTERESTED", "ENQUIRY_ONLY"];

export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("leads.manage");
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid call log.", 400);
    const d = parsed.data;
    const actor = actorOf(user);
    const reached = REACHED.includes(d.outcome);
    const summary = `${d.direction === "INCOMING" ? "Incoming" : "Outgoing"} call — ${CALL_OUTCOME_LABEL[d.outcome]}${d.notes ? `: ${d.notes}` : ""}${d.nextFollowUpDate ? ` · follow-up ${d.nextFollowUpDate}` : ""}`;

    let lead = d.leadId ? await prisma.lead.findUnique({ where: { id: d.leadId } }) : null;
    if (d.leadId && !lead) return fail("Lead not found.", 404);
    if (!lead) {
      const open = await openDuplicates(phoneKey(d.phone));
      lead = open.length ? await prisma.lead.findUnique({ where: { id: open[0].id } }) : null;
    }

    let created = false;
    if (lead) {
      const nextStatus = lead.status === "NEW" && reached ? "CONTACTED" : undefined;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(reached ? { lastContactedAt: new Date() } : {}),
          ...(d.nextFollowUpDate !== undefined ? { nextFollowUpDate: d.nextFollowUpDate } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(d.serviceInterest && !lead.serviceInterest ? { serviceInterest: d.serviceInterest } : {}),
        },
      });
      await addActivity(lead.id, { type: "CALL_LOGGED", message: summary, outcome: d.outcome, ...actor });
    } else {
      if (d.outcome === "WRONG_NUMBER") return fail("Wrong-number calls aren't saved as leads.", 400);
      lead = await createLead(
        {
          customerName: d.callerName?.trim() || `Caller ${d.phone.replace(/\D/g, "").slice(-4)}`,
          phone: d.phone,
          source: "PHONE_CALL",
          sourceDetails: `${d.direction === "INCOMING" ? "Incoming" : "Outgoing"} call on the office mobile (logged by ${user.name})`,
          serviceInterest: d.serviceInterest || null,
          status: reached ? "CONTACTED" : "NEW",
          lastContactedAt: reached ? new Date() : null,
          nextFollowUpDate: d.nextFollowUpDate ?? null,
          notes: d.notes || null,
        },
        actor,
        { type: "CALL_LOGGED", message: summary, outcome: d.outcome }
      );
      created = true;
    }
    void recordAudit({ actor: user, action: "LEAD_CALL_LOGGED", entityType: "lead", entityId: lead.id, details: `${d.direction} ${d.outcome}${created ? " (new lead)" : ""}`, request });
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    return ok({ lead: (await hydrateLeads([fresh]))[0], created }, created ? 201 : 200);
  } catch (err) {
    return errorResponse(err, "leads.log_call.route_error");
  }
}
