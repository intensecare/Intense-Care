import { isStartMode } from "@/lib/start-verification";
import { CONTACT_LEAD_POLICIES } from "@/lib/contacts";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { isValidPayeeName, isValidVpa, maskVpa, upiProblem, UPI_PROBLEM_TEXT } from "@/lib/payments";
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
    const auth = await requirePermission("settings.manage");
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

    if (body.jobStartVerification && typeof body.jobStartVerification === "object") {
      const v = body.jobStartVerification as Record<string, unknown>;
      const next = { ...current.jobStartVerification };
      const bad = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 });
      if (v.defaultMode !== undefined) {
        if (!isStartMode(v.defaultMode)) return bad("Choose one of the three job start modes: DIRECT, GPS or GPS_QR.");
        next.defaultMode = v.defaultMode;
      }
      const whole = (x: unknown, min: number, max: number) => typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;
      if (v.maxDistanceMeters !== undefined) {
        if (!whole(v.maxDistanceMeters, 10, 5000)) return bad("The allowed distance must be between 10 and 5000 metres.");
        next.maxDistanceMeters = v.maxDistanceMeters as number;
      }
      if (v.maxAccuracyMeters !== undefined) {
        if (!whole(v.maxAccuracyMeters, 5, 1000)) return bad("The GPS accuracy limit must be between 5 and 1000 metres.");
        next.maxAccuracyMeters = v.maxAccuracyMeters as number;
      }
      if (v.allowPerJobOverride !== undefined) {
        if (typeof v.allowPerJobOverride !== "boolean") return bad("Invalid per-job override setting.");
        next.allowPerJobOverride = v.allowPerJobOverride;
      }
      patch.jobStartVerification = next;
    }

    if (body.qualityControl && typeof body.qualityControl === "object") {
      const v = body.qualityControl as Record<string, unknown>;
      if (v.separationOfDuties !== undefined) {
        if (typeof v.separationOfDuties !== "boolean") return NextResponse.json({ success: false, error: "Invalid quality control setting." }, { status: 400 });
        patch.qualityControl = { ...current.qualityControl, separationOfDuties: v.separationOfDuties };
        if (v.separationOfDuties !== current.qualityControl.separationOfDuties) {
          void recordAudit({ actor: auth.user, action: "QC_SEPARATION_SETTING_CHANGED", entityType: "settings", entityId: "qualityControl", previousState: String(current.qualityControl.separationOfDuties), newState: String(v.separationOfDuties), request });
        }
      }
    }

    if (body.upi && typeof body.upi === "object") {
      const v = body.upi as Record<string, unknown>;
      const next = { ...current.upi };
      const bad = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 });
      if (v.vpa !== undefined) {
        if (typeof v.vpa !== "string") return bad("Invalid UPI ID.");
        const t = v.vpa.trim();
        if (t && !isValidVpa(t)) return bad(UPI_PROBLEM_TEXT.BAD_VPA);
        next.vpa = t;
      }
      if (v.payeeName !== undefined) {
        if (typeof v.payeeName !== "string") return bad("Invalid payee name.");
        const t = v.payeeName.trim();
        if (t && !isValidPayeeName(t)) return bad(UPI_PROBLEM_TEXT.BAD_NAME);
        next.payeeName = t;
      }
      if (v.description !== undefined) {
        if (typeof v.description !== "string" || v.description.length > 40 || /[^\w .#/-]/.test(v.description)) return bad("The payment description can be up to 40 letters, numbers and spaces.");
        next.description = v.description.trim();
      }
      if (v.enabled !== undefined) {
        if (typeof v.enabled !== "boolean") return bad("Invalid setting.");
        next.enabled = v.enabled;
      }
      // Never switch payments on with an incomplete or invalid configuration.
      if (next.enabled) {
        const problem = upiProblem({ ...next, enabled: true });
        if (problem) return bad(`UPI payments can't be switched on yet: ${UPI_PROBLEM_TEXT[problem]}`);
      }
      patch.upi = next;
      // The payee account is where customers' money goes — every change is recorded.
      if (next.vpa !== current.upi.vpa || next.payeeName !== current.upi.payeeName || next.enabled !== current.upi.enabled) {
        void recordAudit({ actor: auth.user, action: "UPI_SETTINGS_CHANGED", entityType: "settings", entityId: "upi", previousState: `${current.upi.enabled ? "on" : "off"} ${current.upi.vpa ? maskVpa(current.upi.vpa) : "(none)"}`, newState: `${next.enabled ? "on" : "off"} ${next.vpa ? maskVpa(next.vpa) : "(none)"}`, request });
      }
    }

    if (body.contactSync && typeof body.contactSync === "object") {
      const v = body.contactSync as Record<string, unknown>;
      const next = { ...current.contactSync };
      const bad = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 });
      if (v.leadPolicy !== undefined) {
        if (!(CONTACT_LEAD_POLICIES as readonly string[]).includes(v.leadPolicy as string)) return bad("Choose how synced contacts are handled.");
        if (v.leadPolicy === "AUTO_NEW_CONTACTS" && next.leadPolicy !== "AUTO_NEW_CONTACTS") {
          // Turning on automatic leads is a business decision: it needs an explicit confirmation, which is recorded.
          if (v.confirmAutoLeads !== true) return bad("Confirm that new phone contacts should automatically become leads.");
          next.autoLeadApprovedBy = auth.user.name;
          next.autoLeadApprovedAt = new Date().toISOString();
        }
        if (v.leadPolicy === "DIRECTORY_ONLY") {
          next.autoLeadApprovedBy = null;
          next.autoLeadApprovedAt = null;
        }
        next.leadPolicy = v.leadPolicy as typeof next.leadPolicy;
      }
      if (v.removedRetentionDays !== undefined) {
        if (typeof v.removedRetentionDays !== "number" || !Number.isInteger(v.removedRetentionDays) || v.removedRetentionDays < 7 || v.removedRetentionDays > 3650) return bad("Keep removed contacts for 7 to 3650 days.");
        next.removedRetentionDays = v.removedRetentionDays;
      }
      patch.contactSync = next;
    }

    const updated = await updateSystemSettings(patch);
    return ok(updated);
  } catch (err) {
    return errorResponse(err, "settings.patch.route_error");
  }
}
