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
    ];
    const numberFields: (keyof SystemSettings)[] = [
      "taxRatePercent",
      "resendCooldownSeconds",
      "refundApprovalLimit",
      "discountApprovalLimitPercent",
    ];

    for (const f of stringFields) {
      if (typeof body[f] === "string") (patch[f] as string) = body[f] as string;
    }
    for (const f of numberFields) {
      const v = Number(body[f]);
      if (Number.isFinite(v)) (patch[f] as number) = v;
    }

    const updated = await updateSystemSettings(patch);
    return ok(updated);
  } catch (err) {
    return errorResponse(err, "settings.patch.route_error");
  }
}
