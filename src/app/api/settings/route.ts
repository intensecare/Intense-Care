import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, readJson } from "@/lib/server/serialize";
import {
  getSystemSettings,
  updateSystemSettings,
} from "@/lib/server/settings";
import { can } from "@/lib/rbac";
import type { SystemSettings } from "@/lib/types";
import { CUSTOMER_VISIBILITY_KEYS } from "@/lib/types";

/**
 * GET /api/settings — current company configuration. Any signed-in user may
 * read (staff need the notification cooldown for UI hints).
 */
export async function GET() {
  try {
    const { user } = await requireUser();
    const settings = await getSystemSettings();
    // Business rules (bonus amounts, approval limits) are for those who manage settings.
    if (!can(user, "settings.view")) {
      const { referralRules: _r, refundApprovalLimit: _a, discountApprovalLimitPercent: _d, ...safe } = settings;
      return ok(safe);
    }
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

    if (body.referralRules && typeof body.referralRules === "object") {
      const r = body.referralRules as Record<string, unknown>;
      const next = { ...current.referralRules };
      if (typeof r.enabled === "boolean") next.enabled = r.enabled;
      if (r.bonusType === "FIXED" || r.bonusType === "PERCENT") next.bonusType = r.bonusType;
      if (typeof r.requirePaid === "boolean") next.requirePaid = r.requirePaid;
      const bad = (label: string) => NextResponse.json({ success: false, error: `${label} is out of range.` }, { status: 400 });
      // A value that is present must be valid — never silently ignored.
      const num = (v: unknown, min: number, max: number): number | undefined | "bad" => (v === undefined ? undefined : typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : "bad");
      const maxValue = next.bonusType === "PERCENT" ? 100 : 1_000_000;
      const fields: [keyof typeof next, string, number | undefined | "bad"][] = [
        ["bonusValue", next.bonusType === "PERCENT" ? "The bonus percentage (0–100)" : "The bonus amount", num(r.bonusValue, 0, maxValue)],
        ["minJobValue", "The minimum job value", num(r.minJobValue, 0, 100_000_000)],
        ["eligibilityDays", "The eligibility window (1–3650 days)", num(r.eligibilityDays, 1, 3650)],
        ["maxBonus", "The maximum bonus", num(r.maxBonus, 0, 1_000_000)],
      ];
      for (const [key, label, v] of fields) {
        if (v === "bad") return bad(label);
        if (v !== undefined) (next as Record<string, unknown>)[key] = v;
      }
      if (next.bonusType === "PERCENT" && next.bonusValue > 100) return bad("The bonus percentage (0–100)");
      patch.referralRules = next;
    }

    const updated = await updateSystemSettings(patch);
    return ok(updated);
  } catch (err) {
    return errorResponse(err, "settings.patch.route_error");
  }
}
