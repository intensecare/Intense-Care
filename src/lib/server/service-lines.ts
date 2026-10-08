/**
 * §3 Resolving the services on a job or quotation, server-side.
 *
 * Admin may pick one or many services. Each selection is either
 *   - a CATALOG service (serviceId) — price and duration default to the
 *     catalog, and Admin may override the price for this job, or
 *   - a one-off CUSTOM service (name + price), which is saved to the catalog
 *     as `isCustom` so it can be re-used, reported on and invoiced like any
 *     other service.
 *
 * Whatever comes in, this module produces validated, priced lines plus the
 * PRIMARY catalog service — the one whose checklist rubric the job runs on.
 * Prices are never taken on trust: a catalog line with no explicit price uses
 * the catalog price, and every figure is re-computed by lib/documents.ts.
 */

import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DocumentLine } from "@/lib/documents";

type Db = PrismaClient | Prisma.TransactionClient;

export const ServiceSelectionSchema = z
  .object({
    /** Catalog service. Omit for a one-off custom service. */
    serviceId: z.string().min(1).max(64).optional(),
    /** Required when there is no serviceId. */
    name: z.string().min(2).max(160).optional(),
    description: z.string().max(2000).optional(),
    quantity: z.number().min(0.01).max(1000).default(1),
    /** Overrides the catalog price for this job only. */
    unitPrice: z.number().min(0).max(10000000).optional(),
    discount: z.number().min(0).max(10000000).default(0),
    durationHours: z.number().min(0).max(2000).optional(),
    /** Tax treatment override; defaults to the catalog service setting. */
    taxTreatment: z.enum(["GST", "EXEMPT"]).optional(),
    /** Keep a one-off custom service in the catalog for re-use. */
    saveToCatalog: z.boolean().default(true),
  })
  .refine((s) => Boolean(s.serviceId || s.name), {
    message: "Each service needs either a catalog service or a name.",
  });

export type ServiceSelection = z.infer<typeof ServiceSelectionSchema>;

export class ServiceLineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type ResolvedLine = DocumentLine & { serviceId: string | null };

export interface ResolvedServiceLines {
  /** Priced lines, in the order Admin chose them. */
  lines: ResolvedLine[];
  /** The catalog service the job checklist is instantiated from. */
  primaryServiceId: string;
  primaryServiceName: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `service-${Date.now()}`
  );
}

/**
 * Creates a catalog entry for a one-off custom service so it can be re-used
 * and reported on. Custom services start with an empty checklist — the desk
 * authors the rubric on the Services page when it wants one.
 */
export async function createCustomService(
  db: Db,
  input: {
    name: string;
    description?: string;
    basePrice: number;
    durationHours?: number;
    taxTreatment?: "GST" | "EXEMPT";
  }
): Promise<{ id: string; name: string }> {
  let slug = slugify(input.name);
  if (await db.service.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  return db.service.create({
    data: {
      name: input.name,
      slug,
      category: "specialized",
      description: input.description ?? "",
      basePrice: input.basePrice,
      estimatedDurationHours: Math.max(0.5, input.durationHours ?? 4),
      taxTreatment: input.taxTreatment ?? "GST",
      isCustom: true,
    },
    select: { id: true, name: true },
  });
}

/**
 * Turns the Admin selections into priced lines.
 *
 * `fallbackServiceId` keeps older clients working: a request that still sends
 * only `serviceId` books exactly as before, as one line at the catalog price.
 */
export async function resolveServiceLines(
  db: Db,
  input: { services?: ServiceSelection[]; fallbackServiceId?: string }
): Promise<ResolvedServiceLines> {
  const selections: ServiceSelection[] =
    input.services && input.services.length > 0
      ? input.services
      : input.fallbackServiceId
      ? [{ serviceId: input.fallbackServiceId, quantity: 1, discount: 0, saveToCatalog: true }]
      : [];

  if (selections.length === 0) {
    throw new ServiceLineError("Select at least one service for this job.", 400);
  }

  const catalogIds = Array.from(
    new Set(selections.map((s) => s.serviceId).filter((id): id is string => Boolean(id)))
  );
  const catalog = catalogIds.length
    ? await db.service.findMany({
        where: { id: { in: catalogIds } },
        select: {
          id: true,
          name: true,
          description: true,
          basePrice: true,
          estimatedDurationHours: true,
          active: true,
          taxTreatment: true,
        },
      })
    : [];
  const byId = new Map(catalog.map((s) => [s.id, s]));

  for (const id of catalogIds) {
    const row = byId.get(id);
    if (!row) throw new ServiceLineError("Service not found. Create it on the Services page first.", 404);
    if (!row.active) throw new ServiceLineError(`${row.name} is inactive and cannot be booked.`, 409);
  }

  const lines: ResolvedLine[] = [];
  let primaryServiceId: string | null = null;
  let primaryServiceName = "";

  for (const sel of selections) {
    if (sel.serviceId) {
      const svc = byId.get(sel.serviceId)!;
      if (!primaryServiceId) {
        primaryServiceId = svc.id;
        primaryServiceName = svc.name;
      }
      lines.push({
        serviceId: svc.id,
        name: svc.name,
        description: sel.description ?? svc.description ?? "",
        quantity: sel.quantity,
        unitPrice: sel.unitPrice ?? svc.basePrice,
        discount: sel.discount,
        taxable: (sel.taxTreatment ?? svc.taxTreatment) !== "EXEMPT",
        durationHours: sel.durationHours ?? svc.estimatedDurationHours,
      });
      continue;
    }

    // A one-off custom service. Priced here and (by default) kept in the
    // catalog so Reports, Quotations and Invoices all speak the same names.
    const name = sel.name!.trim();
    const unitPrice = sel.unitPrice ?? 0;
    let serviceId: string | null = null;
    if (sel.saveToCatalog) {
      const created = await createCustomService(db, {
        name,
        description: sel.description,
        basePrice: unitPrice,
        durationHours: sel.durationHours,
        taxTreatment: sel.taxTreatment,
      });
      serviceId = created.id;
      if (!primaryServiceId) {
        primaryServiceId = created.id;
        primaryServiceName = created.name;
      }
    }
    lines.push({
      serviceId,
      name,
      description: sel.description ?? "",
      quantity: sel.quantity,
      unitPrice,
      discount: sel.discount,
      taxable: (sel.taxTreatment ?? "GST") !== "EXEMPT",
      durationHours: sel.durationHours ?? 0,
    });
  }

  if (!primaryServiceId) {
    // Every custom line opted out of the catalog — the job still needs one
    // catalog service to hang its checklist and its reporting on.
    const first = selections.find((s) => s.name);
    const created = await createCustomService(db, {
      name: first?.name?.trim() || "Custom Service",
      description: first?.description,
      basePrice: first?.unitPrice ?? 0,
      durationHours: first?.durationHours,
      taxTreatment: first?.taxTreatment,
    });
    primaryServiceId = created.id;
    primaryServiceName = created.name;
    const orphan = lines.find((l) => !l.serviceId);
    if (orphan) orphan.serviceId = created.id;
  }

  return { lines, primaryServiceId, primaryServiceName };
}

/** Persists resolved lines against a job, replacing any existing ones. */
export async function writeJobServiceLines(
  db: Db,
  jobId: string,
  lines: ResolvedLine[]
): Promise<void> {
  await db.jobServiceLine.deleteMany({ where: { jobId } });
  await db.jobServiceLine.createMany({
    data: lines.map((l, i) => ({
      jobId,
      serviceId: l.serviceId ?? null,
      name: l.name,
      description: l.description ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount ?? 0,
      taxable: l.taxable !== false,
      durationHours: l.durationHours ?? 0,
      position: i,
    })),
  });
}

/** The line shape persisted in Quote.items (JSON). */
export function toStoredLines(lines: ResolvedLine[]) {
  return lines.map((l) => ({
    serviceId: l.serviceId ?? null,
    name: l.name,
    description: l.description ?? "",
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount ?? 0,
    taxable: l.taxable !== false,
    durationHours: l.durationHours ?? 0,
  }));
}
