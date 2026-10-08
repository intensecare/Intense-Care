import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, readJson } from "@/lib/server/serialize";
import {
  getSystemSettings,
  updateSystemSettings,
} from "@/lib/server/settings";
import type { SystemSettings } from "@/lib/types";
import { CUSTOMER_VISIBILITY_KEYS } from "@/lib/types";

/**
 * GET /api/settings — current company configuration. Any signed-in user may
 * read (staff need the notification cooldown for UI hints).
 */
export async function GET() {
  try {
    await requireUser();
    const settings = await getSystemSettings();
    return ok(settings);
  } catch (err) {
    return errorResponse(err, "settings.get.route_error");
  }
}

/**
 * PATCH /api/settings — update configuration (Admin only). Persists to
 * the DB singleton; already-issued invoices are never rewritten (see lib/tax).
 */
export async function PATCH(request: Request) {
  try {
    // Critical configuration is Super Admin only (approval authority §17).
    await requirePermission("settings.manage");
    const body = await readJson(request);
    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid settings payload." }, { status: 400 });
    }

    // Whitelist + coerce the known fields; ignore anything unexpected.
    const patch: Partial<SystemSettings> = {};
    const stringFields: (keyof SystemSettings)[] = [
      "nextDayDispatchTime",
      "googleBusinessReviewUrl",
      "currency",
      "companyName",
      "companyTagline",
      "companyAddress",
      "companyPhone",
      "companyEmail",
      "taxLabel",
      "gstin",
      "sacCode",
      "signatoryName",
      "invoicePaymentTerms",
      "invoiceNotes",
      "quotationTerms",
      "quotationPaymentTerms",
    ];
    const numberFields: (keyof SystemSettings)[] = [
      "taxRatePercent",
      "resendCooldownSeconds",
      "refundApprovalLimit",
      "discountApprovalLimitPercent",
      "quotationValidityDays",
    ];

    for (const f of stringFields) {
      if (typeof body[f] === "string") (patch[f] as string) = body[f] as string;
    }
    for (const f of numberFields) {
      const v = Number(body[f]);
      if (Number.isFinite(v)) (patch[f] as number) = v;
    }

    // Logo / signature: small PNG, JPEG or WebP images only ("" removes).
    for (const f of ["logoDataUrl", "signatureDataUrl"] as const) {
      const v = body[f];
      if (typeof v !== "string") continue;
      if (v === "") patch[f] = "";
      else if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 400_000) patch[f] = v;
      else return NextResponse.json({ success: false, error: "Upload a PNG, JPEG or WebP image under 300 KB." }, { status: 400 });
    }
    // Boolean groups: only known keys, only true/false.
    const current = await getSystemSettings();
    if (body.customerVisibility && typeof body.customerVisibility === "object") {
      const next = { ...current.customerVisibility };
      for (const k of CUSTOMER_VISIBILITY_KEYS) {
        const v = (body.customerVisibility as Record<string, unknown>)[k];
        if (typeof v === "boolean") next[k] = v;
      }
      patch.customerVisibility = next;
    }
    if (body.notifications && typeof body.notifications === "object") {
      const next = { ...current.notifications };
      for (const k of Object.keys(next) as (keyof typeof next)[]) {
        const v = (body.notifications as Record<string, unknown>)[k];
        if (typeof v === "boolean") next[k] = v;
      }
      patch.notifications = next;
    }

    const updated = await updateSystemSettings(patch);
    return ok(updated);
  } catch (err) {
    return errorResponse(err, "settings.patch.route_error");
  }
}
