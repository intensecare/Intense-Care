import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ensureCustomerLink } from "@/lib/server/qr-service";
import { customerStageLabel, customerJourneyIndex, getNextAction, customerFeatures } from "@/lib/rbac";

/**
 * GET /api/me/customer — the Customer Portal payload ("My Services").
 *
 * Only for a customer login (jobs.view = OWN with a linked customer record).
 * Everything is customer-facing: no internal notes, no crew ids, no internal
 * statuses, no commission data, no other customers. Each service carries
 * its ONE secure link so the portal and the SMS link land on the same page.
 * AMC / NRI sections appear only when the profile has those capabilities.
 */
export async function GET() {
  try {
    const { user, scope } = await requirePermission("jobs.view");
    if (scope !== "OWN" || !user.customerId) {
      return NextResponse.json({ success: false, error: "This portal is for customer accounts." }, { status: 403 });
    }
    const customerId = user.customerId;

    const [customer, properties, jobs, invoices, payments, contracts] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId } }),
      prisma.property.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
      prisma.job.findMany({
        where: { customerId },
        orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
        take: 100,
        include: {
          property: { select: { title: true, address: true } },
          service: { select: { name: true } },
          qualityChecks: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, score: true } },
          photos: { select: { photoType: true } },
        },
      }),
      prisma.invoice.findMany({ where: { customerId, status: { not: "CANCELLED" } }, orderBy: { issuedAt: "desc" } }),
      prisma.payment.findMany({ where: { customerId }, orderBy: { paidAt: "desc" }, take: 50 }),
      prisma.amcContract.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        include: { visits: { orderBy: { scheduledDate: "asc" } }, property: { select: { title: true } } },
      }),
    ]);
    if (!customer) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });

    const today = new Date().toISOString().slice(0, 10);
    const services = await Promise.all(
      jobs.map(async (j) => {
        const link = await ensureCustomerLink(j.id, { id: user.id, name: user.name });
        const qc = j.qualityChecks[0];
        return {
          id: j.id,
          stage: customerStageLabel(j.status),
          journeyIndex: customerJourneyIndex(j.status, Boolean(j.approvedAt)),
          scheduledDate: j.scheduledDate,
          scheduledTimeSlot: j.scheduledTimeSlot,
          serviceName: j.service?.name ?? "Service",
          property: { title: j.property?.title ?? "", address: j.property?.address ?? "" },
          isToday: j.scheduledDate === today,
          isUpcoming: j.scheduledDate > today && !["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED", "CANCELLED"].includes(j.status),
          isDone: ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"].includes(j.status),
          isCancelled: j.status === "CANCELLED",
          qualityChecked: qc?.decision === "PASS",
          hasPhotos: j.photos.length > 0,
          approvedAt: j.approvedAt?.toISOString() ?? null,
          rating: j.customerFeedbackRating ?? null,
          link: link.success ? link.data.linkUrl : null,
          nextAction: getNextAction("customer", {
            status: j.status,
            customerConfirmedAt: j.customerConfirmedAt?.toISOString() ?? null,
            approvedAt: j.approvedAt?.toISOString() ?? null,
            feedbackAt: j.customerFeedbackAt?.toISOString() ?? null,
          }),
        };
      })
    );

    const features = customerFeatures(contracts);
    return NextResponse.json({
      success: true,
      data: {
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address },
        features,
        properties: properties.map((p) => ({ id: p.id, title: p.title, address: p.address, city: p.city, propertyType: p.propertyType })),
        services,
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          jobId: i.jobId,
          total: i.total,
          amountPaid: i.amountPaid,
          balanceDue: i.balanceDue,
          dueDate: i.dueDate,
          status: i.status,
          issuedAt: i.issuedAt.toISOString(),
          finalized: Boolean(i.finalizedAt),
        })),
        payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, method: p.paymentMethod, paidAt: p.paidAt.toISOString() })),
        amc: features.amc
          ? contracts.map((c) => ({
              id: c.id,
              contractNumber: c.contractNumber,
              propertyTitle: c.property?.title ?? "",
              startDate: c.startDate,
              endDate: c.endDate,
              status: c.status,
              paymentStatus: c.paymentStatus,
              contractValue: c.contractValue,
              frequency: c.frequency,
              includedServices: c.includedServices,
              nri: Boolean(c.nriContactPhone || c.nriContactEmail),
              localContactName: c.localContactName,
              upcomingVisits: c.visits
                .filter((v) => ["SCHEDULED", "REMINDED"].includes(v.status) && v.scheduledDate >= today)
                .map((v) => ({ id: v.id, visitNumber: v.visitNumber, scheduledDate: v.scheduledDate, jobId: v.jobId })),
              visitHistory: c.visits
                .filter((v) => v.status === "COMPLETED")
                .map((v) => ({
                  id: v.id,
                  visitNumber: v.visitNumber,
                  scheduledDate: v.scheduledDate,
                  completedAt: v.completedAt?.toISOString() ?? null,
                  jobId: v.jobId,
                  qcScore: v.qcScore,
                  issuesFound: v.issuesFound,
                  recommendations: v.recommendations,
                  approved: v.nriApproved,
                })),
            }))
          : [],
        company: { name: process.env.APP_COMPANY_NAME || "Intense Care", googleReviewUrl: process.env.GOOGLE_BUSINESS_REVIEW_URL || "" },
      },
    });
  } catch (err) {
    return errorResponse(err, "me.customer.route_error");
  }
}
