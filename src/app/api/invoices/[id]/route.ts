import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission, requirePermission, HttpError } from "@/lib/server/authz";
import { invoiceWhereFor } from "@/lib/server/invoices";
import { errorResponse } from "@/lib/server/http";
import { serializeInvoice, ok, fail, readJson } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { recordAudit } from "@/lib/server/audit";
import { can } from "@/lib/rbac";
import { computeInvoiceFigures } from "@/lib/tax";
import { z } from "zod";

/**
 * GET /api/invoices/[id] — one invoice, ready to print.
 * The lookup itself carries the GST-only rule for a Tax Officer, so a
 * Non-GST invoice id answers 404 exactly like an id that does not exist.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["finance.view", "gst.view"]);
    const scope = invoiceWhereFor(user);
    if (!scope) return fail("Your role is not authorized for invoices.", 403);

    const row = await prisma.invoice.findFirst({
      where: { AND: [{ id: params.id }, scope] },
      include: {
        job: {
          select: {
            id: true,
            jobSerial: true,
            scheduledDate: true,
            service: { select: { name: true } },
            property: { select: { address: true, city: true, postalCode: true } },
            customer: { select: { name: true, phone: true, email: true, address: true, gstin: true } },
            locationAddress: true,
          },
        },
      },
    });
    if (!row) {
      logger.info("invoices.detail_not_visible", { userId: user.id, role: user.role, invoiceId: params.id });
      return fail("Invoice not found.", 404);
    }

    const settings = await getSystemSettings();
    const full = can(user, "finance.view");
    const c = row.job?.customer;
    return ok({
      invoice: serializeInvoice(row),
      job: row.job
        ? {
            id: full ? row.job.id : undefined,
            jobNumber: row.job.jobSerial,
            serviceName: row.job.service?.name ?? "Service",
            serviceDate: row.job.scheduledDate,
          }
        : {
            id: undefined,
            jobNumber: "—",
            serviceName: "Service",
            serviceDate: "—",
          },
      customer: {
        name: c?.name || "Customer",
        address:
          row.billingAddress ||
          c?.address ||
          [row.job?.property?.address, row.job?.property?.city, row.job?.property?.postalCode]
            .filter(Boolean)
            .join(", ") ||
          "—",
        serviceAddress:
          row.serviceAddress ||
          row.job?.locationAddress ||
          [row.job?.property?.address, row.job?.property?.city].filter(Boolean).join(", ") ||
          "—",
        gstin: row.customerGstin ?? undefined,
        // Contact details are for Admin only — a Tax Officer sees what a GST invoice needs.
        phone: full ? c?.phone : undefined,
        email: full ? c?.email || undefined : undefined,
      },
      company: {
        name: settings.companyName,
        address: settings.companyAddress,
        phone: settings.companyPhone,
        email: settings.companyEmail,
        gstin: row.invoiceType === "GST" ? row.supplierGstin || settings.gstin || "" : "",
        sacCode: row.invoiceType === "GST" ? settings.sacCode || "" : "",
        tagline: settings.companyTagline,
        logo: settings.logoDataUrl,
        signature: settings.signatureDataUrl,
        signatoryName: settings.signatoryName,
      },
    });
  } catch (err) {
    return errorResponse(err, "invoices.detail.route_error");
  }
}

const UpdateInvoiceSchema = z.object({
  status: z.enum(["UNPAID", "PARTIAL", "PAID", "REFUNDED", "CANCELLED", "VOID"]).optional(),
  discount: z.number().min(0).max(100000000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoiceType: z.enum(["GST", "NON_GST"]).optional(),
  interState: z.boolean().optional(),
  customerGstin: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
  paymentTerms: z.string().max(500).optional(),
  billingAddress: z.string().max(500).optional(),
  serviceAddress: z.string().max(500).optional(),
  finalized: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * PATCH /api/invoices/[id] — update draft invoice, finalize, or cancel/void.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.view");
    const json = await readJson(request);
    const parsed = UpdateInvoiceSchema.safeParse(json);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid payload.", 400);

    const data = parsed.data;
    const existing = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { payments: true },
    });
    if (!existing) return fail("Invoice not found.", 404);

    // If invoice is finalized and user wants to edit amounts or type without unfinalizing:
    if (existing.finalizedAt && (data.discount !== undefined || data.invoiceType !== undefined || data.interState !== undefined)) {
      if (user.role !== "admin") {
        return fail("Cannot modify financial details of a finalized invoice.", 400);
      }
    }

    const settings = await getSystemSettings();
    const nextType: "GST" | "NON_GST" = (data.invoiceType ?? (existing.invoiceType === "NON_GST" ? "NON_GST" : "GST")) as "GST" | "NON_GST";
    const nextInterState = data.interState !== undefined ? data.interState : existing.interState;
    const nextDiscount = data.discount !== undefined ? data.discount : existing.discount;
    const gstRate = nextType === "GST" ? (existing.gstRate > 0 ? existing.gstRate : settings.taxRatePercent) : 0;

    const figures = computeInvoiceFigures({
      invoiceType: nextType,
      subtotal: existing.subtotal,
      discount: nextDiscount,
      gstRatePercent: gstRate,
      interState: nextInterState,
    });

    const nextTotal = figures.total;
    const nextBalanceDue = Math.max(0, nextTotal - existing.amountPaid);
    const nextStatus = data.status ?? (existing.amountPaid >= nextTotal - 0.005 ? "PAID" : existing.amountPaid > 0 ? "PARTIAL" : existing.status);

    const updated = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        status: nextStatus,
        discount: nextDiscount,
        tax: figures.tax,
        cgst: figures.cgst,
        sgst: figures.sgst,
        igst: figures.igst,
        total: nextTotal,
        balanceDue: nextBalanceDue,
        invoiceType: nextType,
        gstRate: figures.gstRate,
        interState: nextInterState,
        customerGstin: data.customerGstin !== undefined ? data.customerGstin.trim().toUpperCase() || null : existing.customerGstin,
        dueDate: data.dueDate ?? existing.dueDate,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : existing.paymentTerms,
        billingAddress: data.billingAddress !== undefined ? data.billingAddress : existing.billingAddress,
        serviceAddress: data.serviceAddress !== undefined ? data.serviceAddress : existing.serviceAddress,
        ...(data.finalized && !existing.finalizedAt
          ? { finalizedAt: new Date(), finalizedBy: user.name }
          : {}),
      },
    });

    void recordAudit({
      actor: user,
      action: data.status === "CANCELLED" || data.status === "VOID" ? "INVOICE_CANCELLED" : "INVOICE_UPDATED",
      entityType: "invoice",
      entityId: params.id,
      jobId: existing.jobId,
      previousState: JSON.stringify({ status: existing.status, total: existing.total, finalizedAt: existing.finalizedAt }),
      newState: JSON.stringify({ status: updated.status, total: updated.total, finalizedAt: updated.finalizedAt }),
      reason: data.reason,
      details: existing.invoiceNumber,
      request,
    });

    return ok({
      success: true,
      message: "Invoice updated successfully.",
      invoice: serializeInvoice(updated),
    });
  } catch (err) {
    return errorResponse(err, "invoices.patch.route_error");
  }
}

/**
 * DELETE /api/invoices/[id] — delete draft/cancelled invoice.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.view");
    if (user.role !== "admin") {
      return fail("Only Admins can delete invoices.", 403);
    }

    const existing = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { payments: true, refunds: true },
    });
    if (!existing) return fail("Invoice not found.", 404);

    if (existing.amountPaid > 0 || existing.payments.length > 0) {
      return fail(
        "Cannot permanently delete an invoice with recorded payments. Please void or cancel the invoice instead.",
        400
      );
    }

    if (existing.finalizedAt && existing.status !== "CANCELLED" && existing.status !== "VOID") {
      return fail(
        "Finalized invoices cannot be permanently deleted. Please cancel or void the invoice first.",
        400
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete any refund stubs
      await tx.refund.deleteMany({ where: { invoiceId: params.id } });
      // Delete invoice
      await tx.invoice.delete({ where: { id: params.id } });
    });

    void recordAudit({
      actor: user,
      action: "INVOICE_DELETED",
      entityType: "invoice",
      entityId: params.id,
      jobId: existing.jobId,
      previousState: `${existing.invoiceNumber} ₹${existing.total} (${existing.status})`,
      details: "Invoice deleted by administrator",
      request,
    });

    return ok({ success: true, message: `Invoice ${existing.invoiceNumber} deleted successfully.` });
  } catch (err) {
    return errorResponse(err, "invoices.delete.route_error");
  }
}
