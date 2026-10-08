import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";
import { notifyReworkAssigned } from "@/lib/server/notify";
import { getSystemSettings } from "@/lib/server/settings";
import { effectiveVisibility, isVisible, type CustomerVisibilityKey } from "@/lib/visibility";
import { parseStoredLines } from "@/lib/documents";

/**
 * /customer/job/{token} API — THE customer journey, one link.
 *
 * The single customer link drives the whole service:
 *   GET    → the journey payload (status, checklist, photos, QC, approval).
 *   confirm    → customer confirms the team arrived (idempotent).
 *   approve    → final sign-off after QC pass (idempotent; name + checkbox).
 *   complaint  → report an issue (creates a complaint for ops).
 *   feedback   → rating 1-5 + Google review click (post-approval).
 *
 * Every action: token chain → stage gate → idempotent write → audit.
 * The customer NEVER sees internal notes, finance internals, or other jobs.
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

function hashIp(ip: string | null): string | undefined {
  if (!ip) return undefined;
  const salt = process.env.ERP_SESSION_SECRET || "portal-sign-ip";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

async function loadTeamNames(jobId: string): Promise<string[]> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { assignedStaffIds: true } });
  if (!job || job.assignedStaffIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: job.assignedStaffIds } }, select: { name: true } });
  return users.map((u) => u.name).filter(Boolean);
}

/**
 * GET — the customer journey payload, filtered by §6 CUSTOMER VISIBILITY.
 *
 * §8 SECURITY RULE: visibility is enforced HERE, not in the browser. A field
 * whose switch is off is absent from this JSON — it is never sent and then
 * hidden with CSS. Internal business information (internal notes, QC
 * findings, cost, margin, suppliers, other customers, internal reports) has
 * no switch at all and is never part of this response.
 */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`cjob:${clientIp(request)}`, 60, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const resolved = await resolveQrToken(params.token);
    if (!resolved.ok) {
      const status =
        resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { job } = resolved.data;

    const [checklist, photos, qc, team, complaintCount, jobRow, invoiceRow, quoteRow, serviceLines, settings] =
      await Promise.all([
        prisma.jobChecklistItem.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
        // Before/after only — QC and rework evidence is internal.
        prisma.jobPhoto.findMany({ where: { jobId: job.id, photoType: { in: ["before", "after"] } }, orderBy: { uploadedAt: "asc" } }),
        prisma.qualityCheck.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: "desc" } }),
        loadTeamNames(job.id),
        prisma.complaint.count({ where: { jobId: job.id } }),
        prisma.job.findUnique({
          where: { id: job.id },
          select: {
            arrivedAt: true,
            completedAt: true,
            customerConfirmedAt: true,
            approvedAt: true,
            approvedBy: true,
            approvalMethod: true,
            arrivalVerification: true,
            customerFeedbackRating: true,
            customerFeedbackAt: true,
            googleReviewClicked: true,
            jobSerial: true,
            serviceAddress: true,
            serviceLat: true,
            serviceLng: true,
            customerNotes: true,
            customerVisibility: true,
          },
        }),
        // This job's invoice (the customer's own document).
        prisma.invoice.findFirst({ where: { jobId: job.id, status: { not: "CANCELLED" } }, orderBy: { issuedAt: "desc" } }),
        // The quotation this job came from, when there was one.
        prisma.quote.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: "desc" } }),
        prisma.jobServiceLine.findMany({ where: { jobId: job.id }, orderBy: { position: "asc" } }),
        getSystemSettings(),
      ]);

    // §6 The effective configuration: this job's override over the company
    // default. Locked keys (Job ID, service name, status) are forced on.
    const visibility = effectiveVisibility(jobRow?.customerVisibility, settings.defaultCustomerVisibility);
    const show = (key: CustomerVisibilityKey) => isVisible(visibility, key);

    const isGst = invoiceRow?.invoiceType === "GST";
    const QC_PENDING = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];
    const QC_REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];
    const DONE = ["PASS", "CUSTOMER_APPROVAL", "COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
    // A simple, customer-facing QC result. Rework findings stay internal.
    const qualityResult = DONE.includes(job.status) || qc?.decision === "PASS"
      ? "passed"
      : QC_REWORK.includes(job.status)
      ? "improving"
      : QC_PENDING.includes(job.status)
      ? "checking"
      : null;

    const serviceName =
      (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service";
    const address = jobRow?.serviceAddress || job.propertyAddress || "";
    const hasPin = typeof jobRow?.serviceLat === "number" && typeof jobRow?.serviceLng === "number";

    return NextResponse.json({
      success: true,
      data: {
        job: {
          // Locked on: a service page must be able to say which job it is.
          id: jobRow?.jobSerial ?? job.id,
          status: job.status,
          serviceName,
          // Every service on the job, by name. Prices live on the documents.
          services: serviceLines.map((l) => ({
            name: l.name,
            description: l.description || undefined,
            quantity: l.quantity,
          })),
          ...(show("serviceDate")
            ? { scheduledDate: job.scheduledDate, scheduledTimeSlot: job.scheduledTimeSlot }
            : {}),
          arrivedAt: jobRow?.arrivedAt?.toISOString() ?? null,
          completedAt: jobRow?.completedAt?.toISOString() ?? null,
          customerConfirmedAt: jobRow?.customerConfirmedAt?.toISOString() ?? null,
          // That the team was verified on site, never HOW (GPS/QR/override).
          arrivalVerified: Boolean(jobRow?.arrivalVerification),
        },
        // §1 The service location, with a navigation link, when permitted.
        location: show("serviceLocation")
          ? {
              address,
              ...(hasPin ? { lat: jobRow!.serviceLat, lng: jobRow!.serviceLng } : {}),
              navigationUrl: hasPin
                ? `https://www.google.com/maps/dir/?api=1&destination=${jobRow!.serviceLat},${jobRow!.serviceLng}`
                : address
                ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
                : null,
            }
          : null,
        customer: { name: job.customerName, phoneMasked: `******${job.customerPhone.replace(/[^0-9]/g, "").slice(-4)}` },
        // First names only, and only when the switch is on.
        team: show("teamName") ? team : [],
        // Progress is counted from the checklist; the tasks themselves are
        // operational detail, so only the totals cross the boundary.
        checklist: checklist.map((c) => ({ id: c.id, area: c.area, task: c.task, completed: c.status === "completed" || c.status === "skipped" })),
        photos: photos
          .filter((p) => (p.photoType === "before" ? show("beforePhotos") : show("afterPhotos")))
          .map((p) => ({
            id: p.id,
            area: p.area,
            photoType: p.photoType,
            url: `/api/secure-photo/${p.id}?t=${encodeURIComponent(params.token)}`,
            caption: p.caption,
            uploadedAt: p.uploadedAt.toISOString(),
          })),
        // Only a PASS is customer-facing; rework details stay internal.
        qualityCheck: show("qcResult") && qc && qc.decision === "PASS" ? { passed: true } : null,
        qualityResult: show("qcResult") ? qualityResult : null,
        // The note written FOR the customer. Job.notes (internal work notes)
        // is never read here.
        serviceNotes: show("serviceNotes") ? jobRow?.customerNotes || null : null,
        invoice:
          show("invoice") && invoiceRow
            ? {
                invoiceNumber: invoiceRow.invoiceNumber,
                invoiceType: isGst ? "GST" : "NON_GST",
                issuedAt: invoiceRow.issuedAt.toISOString(),
                dueDate: invoiceRow.dueDate,
                subtotal: invoiceRow.subtotal,
                discount: invoiceRow.discount,
                taxable: Math.round((invoiceRow.subtotal - invoiceRow.discount) * 100) / 100,
                // GST fields only on a GST invoice — never on a Non-GST invoice.
                ...(isGst
                  ? {
                      gstRate: invoiceRow.gstRate,
                      cgst: invoiceRow.cgst,
                      sgst: invoiceRow.sgst,
                      igst: invoiceRow.igst,
                      totalGst: invoiceRow.tax,
                      customerGstin: invoiceRow.customerGstin ?? undefined,
                      companyGstin: invoiceRow.supplierGstin || settings.gstin || undefined,
                    }
                  : {}),
                total: invoiceRow.total,
                // The payment position is its own switch.
                ...(show("paymentStatus")
                  ? { amountPaid: invoiceRow.amountPaid, balanceDue: invoiceRow.balanceDue, status: invoiceRow.status }
                  : {}),
                lines: serviceLines.map((l) => ({
                  name: l.name,
                  description: l.description || undefined,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  amount: Math.round((l.quantity * l.unitPrice - l.discount) * 100) / 100,
                })),
                companyName: settings.companyName,
                companyAddress: settings.companyAddress,
                companyPhone: settings.companyPhone || undefined,
                companyEmail: settings.companyEmail || undefined,
                companyLogoUrl: settings.companyLogoUrl || undefined,
                paymentTerms: settings.paymentTerms || undefined,
                bankDetails: show("paymentStatus") ? settings.bankDetails || undefined : undefined,
                sacCode: isGst ? settings.sacCode || undefined : undefined,
              }
            : null,
        // §4 The quotation the customer accepted, when one exists.
        quotation:
          show("quotation") && quoteRow
            ? {
                quoteNumber: quoteRow.quoteNumber,
                invoiceType: quoteRow.invoiceType === "NON_GST" ? "NON_GST" : "GST",
                createdAt: quoteRow.createdAt.toISOString(),
                validUntil: quoteRow.validUntil,
                status: quoteRow.status,
                subtotal: quoteRow.subtotal,
                discount: quoteRow.discount,
                tax: quoteRow.tax,
                total: quoteRow.total,
                acceptedAt: quoteRow.acceptedAt?.toISOString() ?? null,
                items: parseStoredLines(quoteRow.items).map((l) => ({
                  name: l.name,
                  description: l.description || undefined,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  amount: Math.round((l.quantity * l.unitPrice - l.discount) * 100) / 100,
                })),
              }
            : null,
        // §6 Payment position on its own, for the portal summary row.
        payment:
          show("paymentStatus") && invoiceRow
            ? { status: invoiceRow.status, amountPaid: invoiceRow.amountPaid, balanceDue: invoiceRow.balanceDue }
            : null,
        approval: jobRow?.approvedAt
          ? { approvedAt: jobRow.approvedAt.toISOString(), approvedBy: jobRow.approvedBy, method: jobRow.approvalMethod }
          : null,
        feedback:
          show("customerFeedback") && jobRow?.customerFeedbackRating
            ? {
                rating: jobRow.customerFeedbackRating,
                feedbackAt: jobRow.customerFeedbackAt?.toISOString() ?? null,
                googleReviewClicked: jobRow.googleReviewClicked,
              }
            : null,
        complaintCount,
        // What this page is allowed to show, so the UI renders the right
        // sections. The data itself is already filtered above.
        visibility,
        company: {
          name: settings.companyName || process.env.APP_COMPANY_NAME || "Intense Care",
          googleReviewUrl: settings.googleBusinessReviewUrl || process.env.GOOGLE_BUSINESS_REVIEW_URL || "",
        },
      },
    });
  } catch (err) {
    logger.error("customer.job.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load your service page.", 500);
  }
}

const ConfirmSchema = z.object({ action: z.literal("confirm") });
const ApproveSchema = z.object({
  action: z.literal("approve"),
  signatoryName: z.string().min(2).max(120),
  confirmChecked: z.boolean(),
});
const ComplaintSchema = z.object({
  action: z.literal("complaint"),
  category: z.enum(["missed_area", "quality", "damage", "staff_behavior", "other"]),
  description: z.string().min(5).max(2000),
  signatoryName: z.string().max(120).optional(),
});
const FeedbackSchema = z.object({
  action: z.literal("feedback"),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  googleReviewClicked: z.boolean().default(false),
});

/** POST — idempotent customer actions on the ONE link. */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`cjob-post:${clientIp(request)}`, 20, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    const resolved = await resolveQrToken(params.token);
    if (!resolved.ok) {
      const status =
        resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;
    const customerName = job.customerName || "Customer";

    /* ---------------- CONFIRM ARRIVAL (idempotent) ---------------- */
    if (action === "confirm") {
      const parsed = ConfirmSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, customerConfirmedAt: true } });
      if (!jobRow) return fail("Job not found.", 404);

      // Idempotency — already verified: same success state.
      if (["CUSTOMER_VERIFIED", "IN_PROGRESS", "WORK_COMPLETED"].includes(jobRow.status) || jobRow.customerConfirmedAt) {
        return NextResponse.json({ success: true, data: { alreadyConfirmed: true, status: jobRow.status } });
      }
      // Confirmation follows the team's verified arrival — never before it.
      if (jobRow.status !== "ARRIVED") {
        return fail("You can confirm once your team has arrived. This page will update when they do.", 409);
      }

      const now = new Date();
      const moved = await prisma.job.updateMany({
        where: { id: job.id, status: "ARRIVED" },
        data: { status: "CUSTOMER_VERIFIED", customerConfirmedAt: now, updatedAt: now },
      });
      if (moved.count === 0) return NextResponse.json({ success: true, data: { alreadyConfirmed: true, status: "CUSTOMER_VERIFIED" } });
      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: `Customer confirmed team arrival via secure link${customerName ? ` — ${customerName}` : ""}`,
        actor: { name: customerName, role: "customer" },
      });
      void import("@/lib/server/audit").then(({ recordAudit }) =>
        recordAudit({
          actor: { name: customerName, role: "customer" },
          action: "CUSTOMER_CONFIRMED_ARRIVAL",
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          previousState: jobRow.status,
          newState: "CUSTOMER_VERIFIED",
          request,
        })
      );
      logger.info("customer.confirmed", { jobId: job.id, tokenId: tokenRow.id });
      return NextResponse.json({ success: true, data: { alreadyConfirmed: false, status: "CUSTOMER_VERIFIED" } });
    }

    /* ---------------- FINAL APPROVAL (idempotent) ---------------- */
    if (action === "approve") {
      const parsed = ApproveSchema.safeParse(body);
      if (!parsed.success) return fail("Please enter your name and tick the confirmation checkbox.", 400);
      if (!parsed.data.confirmChecked) return fail("Please tick the confirmation checkbox to approve.", 400);

      const jobRow = await prisma.job.findUnique({
        where: { id: job.id },
        select: { status: true, approvedAt: true },
      });
      if (!jobRow) return fail("Job not found.", 404);

      // Idempotency — already approved: same success, no duplicate record.
      if (jobRow.approvedAt) {
        return NextResponse.json({
          success: true,
          data: { alreadyApproved: true, approvedAt: jobRow.approvedAt.toISOString(), status: jobRow.status },
        });
      }
      if (!["PASS", "CUSTOMER_APPROVAL"].includes(jobRow.status)) {
        return fail(`Approval is open only after QC passes (current: ${jobRow.status}).`, 409);
      }

      const now = new Date();
      const moved = await prisma.job.updateMany({
        where: { id: job.id, status: jobRow.status, approvedAt: null },
        data: {
          status: "COMPLETED",
          approvedAt: now,
          approvedBy: `${tokenRow.id}:${parsed.data.signatoryName}`,
          approvalMethod: "secure_link",
          completedAt: jobRow.status === "PASS" ? now : undefined,
          updatedAt: now,
        },
      });
      if (moved.count === 0) {
        return NextResponse.json({ success: true, data: { alreadyApproved: true, status: "COMPLETED" } });
      }

      await recordActivity({
        jobId: job.id,
        type: "CUSTOMER_SIGNED",
        message: `Customer approved completion via secure link — ${parsed.data.signatoryName}`,
        actor: { name: parsed.data.signatoryName, role: "customer" },
      });
      logger.info("approval.granted", { jobId: job.id, tokenId: tokenRow.id });
      // Billing is now open: Accounts gets its deep link; referral commissions settle.
      try {
        const [{ notifyAccountsBillable }, { recordAudit }] = await Promise.all([
          import("@/lib/server/notify"),
          import("@/lib/server/audit"),
        ]);
        void notifyAccountsBillable(job.id).catch(() => {});
        void recordAudit({
          actor: { name: parsed.data.signatoryName, role: "customer" },
          action: "CUSTOMER_APPROVED",
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          previousState: jobRow.status,
          newState: "COMPLETED",
          request,
        });
        const full = await prisma.job.findUnique({ where: { id: job.id }, select: { referralPartnerId: true } });
        if (full?.referralPartnerId) {
          const { settleCommissionForJob } = await import("@/lib/server/commission");
          await settleCommissionForJob(job.id);
        }
      } catch (e) {
        logger.warn("approval.side_effects_failed", { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
      }

      return NextResponse.json({
        success: true,
        data: { alreadyApproved: false, approvedAt: now.toISOString(), status: "COMPLETED" },
      });
    }

    /* ---------------- REPORT AN ISSUE ---------------- */
    if (action === "complaint") {
      const parsed = ComplaintSchema.safeParse(body);
      if (!parsed.success) return fail("Please describe the issue (at least 5 characters).", 400);

      const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, customerId: true, assignedStaffIds: true } });
      if (!jobRow) return fail("Job not found.", 404);

      // Gate: an issue can be raised at any point BEFORE final approval —
      // the customer must always have a say before signing off. After the
      // approval the complaint is still recorded for ops, but it no longer
      // re-opens the (already accepted, commission-settled) pipeline.
      const preApproval = !["COMPLETED", "CLOSED", "CANCELLED"].includes(jobRow.status);
      if (jobRow.status === "CANCELLED" || jobRow.status === "CLOSED") {
        return fail("This job is closed — please contact support to raise an issue.", 409);
      }

      // Customer issues are owned by the Admin desk.
      const opsManager = await prisma.user.findFirst({
        where: { role: "admin", active: true },
        orderBy: { createdAt: "asc" },
      });

      const complaint = await prisma.complaint.create({
        data: {
          jobId: job.id,
          customerId: jobRow.customerId,
          category: parsed.data.category,
          severity: "high",
          description: parsed.data.description,
          assignedOwnerId: opsManager?.id ?? null,
          assignedOwnerName: opsManager?.name ?? "Operations",
        },
      });

      let reopened = false;
      if (preApproval && !jobRow.status.startsWith("REWORK")) {
        // The customer's issue BECOMES a rework task on the lead worker and
        // re-drives the full loop: REWORK_REQUIRED → (field app fixes it) →
        // REWORK_COMPLETED → reinspection → PASS → approval on this same link.
        const leadWorker = jobRow.assignedStaffIds[0] ?? "";
        const attentionIssue = await prisma.qualityIssue.create({
          data: {
            qualityCheckId: null,
            jobId: job.id,
            area: parsed.data.category.replace("_", " ").toUpperCase(),
            itemDescription: parsed.data.description,
            severity: "critical",
            notes: `Customer reported via secure link: ${parsed.data.description}`,
            assignedStaffId: leadWorker,
            reworkInstructions: parsed.data.description,
          },
        });
        await prisma.reworkTask.create({
          data: {
            qualityIssueId: attentionIssue.id,
            jobId: job.id,
            assignedStaffId: leadWorker,
            instructions: `Customer reported: ${parsed.data.description}`,
          },
        });
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "REWORK_REQUIRED", updatedAt: new Date() },
        });
        reopened = true;
      }

      await recordActivity({
        jobId: job.id,
        type: "ATTENTION_REQUESTED",
        message: `Customer reported an issue via secure link (${parsed.data.category.replace("_", " ")}): ${parsed.data.description}${reopened ? " — job re-opened for rework" : ""}`,
        actor: { name: parsed.data.signatoryName || customerName, role: "customer" },
      });
      void notifyReworkAssigned(job.id).catch(() => {});
      logger.info("approval.complaint_created", { jobId: job.id, complaintId: complaint.id, reopened });

      return NextResponse.json(
        { success: true, data: { complaintId: complaint.id, status: "open", reopened } },
        { status: 201 }
      );
    }

    /* ---------------- FEEDBACK (rating + Google review) ---------------- */
    if (action === "feedback") {
      const parsed = FeedbackSchema.safeParse(body);
      if (!parsed.success) return fail("A rating (1-5) is required.", 400);

      const jobRow = await prisma.job.findUnique({
        where: { id: job.id },
        select: { approvedAt: true, customerFeedbackAt: true },
      });
      if (!jobRow) return fail("Job not found.", 404);
      if (!jobRow.approvedAt) {
        return fail("Feedback opens after you approve the completed service.", 409);
      }

      const updated = await prisma.job.update({
        where: { id: job.id },
        data: {
          customerFeedbackRating: parsed.data.rating,
          googleReviewClicked: parsed.data.googleReviewClicked,
          customerFeedbackAt: jobRow.customerFeedbackAt ?? new Date(),
        },
      });

      logger.info("feedback.recorded", { jobId: job.id, rating: parsed.data.rating });
      await recordActivity({
        jobId: job.id,
        type: "FEEDBACK_RECORDED",
        message: `Customer rated the service ${parsed.data.rating}/5${parsed.data.comment ? ` — “${parsed.data.comment}”` : ""}`,
        actor: { name: customerName, role: "customer" },
      });
      if (parsed.data.googleReviewClicked) {
        await recordActivity({
          jobId: job.id,
          type: "GOOGLE_REVIEW_CLICKED",
          message: "Customer clicked through to Google Business review",
          actor: { name: customerName, role: "customer" },
        });
      }

      return NextResponse.json({ success: true, data: { feedbackAt: updated.customerFeedbackAt?.toISOString() ?? null } });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("customer.job.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
