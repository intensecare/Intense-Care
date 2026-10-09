import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission } from "@/lib/server/authz";
import { invoiceWhereFor, istDayStart } from "@/lib/server/invoices";
import { errorResponse } from "@/lib/server/http";
import { serializeInvoice, ok, fail } from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/invoices — invoice list with filters.
 *   ?type=ALL|GST|NON_GST  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?customerId=…  ?q=…
 * Admin (finance.view) sees both types. A Tax Officer (gst.view) is ALWAYS
 * limited to GST invoices — asking for Non-GST invoices is refused outright.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireAnyPermission(["finance.view", "gst.view"]);
    const scope = invoiceWhereFor(user);
    if (!scope) return fail("Your role is not authorized for invoices.", 403);

    const url = new URL(request.url);
    const type = (url.searchParams.get("type") || "ALL").toUpperCase();
    if (!["ALL", "GST", "NON_GST"].includes(type)) return fail("type must be ALL, GST or NON_GST.", 400);
    if (type === "NON_GST" && scope.invoiceType === "GST") {
      logger.warn("invoices.non_gst_denied", { userId: user.id, role: user.role });
      return fail("You can only view GST invoices.", 403);
    }
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const customerId = url.searchParams.get("customerId");
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80);

    const issuedAt: Prisma.DateTimeFilter = {};
    if (from && DATE.test(from)) issuedAt.gte = istDayStart(from);
    if (to && DATE.test(to)) issuedAt.lt = new Date(istDayStart(to).getTime() + 24 * 60 * 60 * 1000);

    const where: Prisma.InvoiceWhereInput = {
      AND: [
        scope, // the server-side GST-only rule — always applied, never optional
        type === "ALL" ? {} : { invoiceType: type },
        Object.keys(issuedAt).length ? { issuedAt } : {},
        customerId ? { customerId } : {},
        q
          ? {
              OR: [
                { invoiceNumber: { contains: q, mode: "insensitive" } },
                { job: { jobSerial: { contains: q, mode: "insensitive" } } },
                { job: { customer: { name: { contains: q, mode: "insensitive" } } } },
                { customerGstin: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };

    const rows = await prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      take: 500,
      include: { job: { select: { jobSerial: true, customer: { select: { id: true, name: true } } } } },
    });

    // Customers to filter by — only those that appear on invoices this user may see.
    const customerRows = await prisma.invoice.findMany({
      where: scope,
      distinct: ["customerId"],
      select: { job: { select: { customer: { select: { id: true, name: true } } } } },
      take: 1000,
    });

    return ok({
      invoices: rows.map((r) => ({
        ...serializeInvoice(r),
        jobNumber: r.job?.jobSerial ?? "—",
        customerName: r.job?.customer?.name ?? "—",
      })),
      customers: customerRows
        .map((r) => r.job?.customer)
        .filter((c): c is { id: string; name: string } => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    return errorResponse(err, "invoices.get.route_error");
  }
}
