import { NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, authorizeJob } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import {
  ensureCustomerLink,
  mintCustomerLink,
  revokeQrToken,
  rawTokenOfRow,
  buildLinkUrl,
  buildShortUrl,
  serializeQrToken,
} from "@/lib/server/qr-service";

/**
 * ADMIN → CUSTOMER SECURE LINK (one per job).
 *
 * GET                → every job's link state for the desk table.
 * POST get           → the job's single link; mints it on first use.
 * POST regen         → replace: new link, old dies instantly.
 * POST revoke        → kill switch.
 * POST qr / qr-dl    → QR image of the SAME link (no rotation).
 * POST purge-job     → revoke the job's link (compromise response).
 */

export async function GET() {
  try {
    await requirePermission("links.manage");
    const rows = await prisma.qrToken.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
    const jobs = await prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        customer: { select: { name: true } },
        property: { select: { title: true } },
        service: { select: { name: true } },
      },
    });
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    return NextResponse.json({
      success: true,
      data: {
        tokens: rows.map((r) => {
          const j = jobMap.get(r.jobId);
          return {
            ...serializeQrToken(r),
            job: j
              ? {
                  id: j.id,
                  status: j.status,
                  scheduledDate: j.scheduledDate,
                  customerName: j.customer?.name ?? null,
                  propertyTitle: j.property?.title ?? null,
                  serviceName: j.service?.name ?? null,
                }
              : null,
          };
        }),
      },
    });
  } catch (err) {
    return errorResponse(err, "qr_links.get.route_error");
  }
}

const GetSchema = z.object({ action: z.literal("get"), jobId: z.string().min(1).max(64) });
const RegenSchema = z.object({ action: z.literal("regen"), jobId: z.string().min(1).max(64) });
const PurgeSchema = z.object({ action: z.literal("purge-job"), jobId: z.string().min(1).max(64) });
const TokenActionSchema = z.object({
  action: z.enum(["reveal", "qr", "qr-download", "revoke"]),
  tokenId: z.string().min(1).max(64),
  reason: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("links.manage");
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";
    // Record-level scope: the job must be inside the caller's jobs.view scope.
    if (typeof body?.jobId === "string") await authorizeJob(body.jobId, "jobs.view");
    if (typeof body?.tokenId === "string") {
      const row = await prisma.qrToken.findUnique({ where: { id: body.tokenId }, select: { jobId: true } });
      if (row) await authorizeJob(row.jobId, "jobs.view");
    }

    if (action === "get" || action === "regen") {
      const parsed = (action === "get" ? GetSchema : RegenSchema).safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
      const res =
        action === "get"
          ? await ensureCustomerLink(parsed.data.jobId, { id: user.id, name: user.name })
          : await mintCustomerLink(parsed.data.jobId, { id: user.id, name: user.name });
      if (!res.success) {
        const status = res.failure.kind === "not_found" ? 404 : 429;
        return NextResponse.json({ success: false, error: res.failure.message }, { status });
      }
      // Raw token appears only in this response — share/store it now.
      return NextResponse.json(
        {
          success: true,
          data: {
            ...res.data,
            reveal: res.data.linkUrl,
            created: "created" in res ? res.created : true,
            shareUrl: `https://wa.me/?text=${encodeURIComponent(res.data.linkUrl)}`,
          },
        },
        { status: action === "regen" ? 201 : 200 }
      );
    }

    if (action === "reveal" || action === "qr" || action === "qr-download") {
      const parsed = TokenActionSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });

      const row = await prisma.qrToken.findUnique({ where: { id: parsed.data.tokenId } });
      if (!row) return NextResponse.json({ success: false, error: "Token not found." }, { status: 404 });
      if (row.revokedAt) {
        return NextResponse.json(
          { success: false, error: "This link is revoked — REGENERATE to issue a fresh one." },
          { status: 409 }
        );
      }
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return NextResponse.json(
          { success: false, error: "This link has expired — REGENERATE to issue a fresh one." },
          { status: 409 }
        );
      }
      const raw = rawTokenOfRow(row);
      if (!raw) {
        return NextResponse.json(
          { success: false, error: "This legacy link cannot be re-shown — REGENERATE to issue a fresh one." },
          { status: 409 }
        );
      }

      const linkUrl = buildLinkUrl(raw);
      const shortUrl = buildShortUrl(raw);

      if (action === "reveal") {
        return NextResponse.json({
          success: true,
          data: { linkUrl, shortUrl, expiresAt: row.expiresAt?.toISOString() ?? null },
        });
      }

      const urlForQr = action === "qr-download" ? linkUrl : shortUrl;
      const size = action === "qr-download" ? 1024 : 320;
      const dataUrl = await QRCode.toDataURL(urlForQr, {
        width: size,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      return NextResponse.json({ success: true, data: { qrDataUrl: dataUrl, linkUrl, token: urlForQr.split("/").pop() } });
    }

    if (action === "revoke") {
      const parsed = TokenActionSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
      const ok = await revokeQrToken(parsed.data.tokenId, { id: user.id, name: user.name }, parsed.data.reason);
      if (!ok) return NextResponse.json({ success: false, error: "Link already revoked or not found." }, { status: 409 });
      void recordAudit({ actor: user, action: "CUSTOMER_LINK_REVOKED", entityType: "qr_token", entityId: parsed.data.tokenId, reason: parsed.data.reason, request });
      return NextResponse.json({ success: true, data: { revoked: true } });
    }

    if (action === "purge-job") {
      const parsed = PurgeSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
      const { revokeAllForJob } = await import("@/lib/server/qr-service");
      const count = await revokeAllForJob(parsed.data.jobId, "Compromise response — link revoked");
      logger.warn("qr.purged_job_tokens", { jobId: parsed.data.jobId, count, by: user.id });
      return NextResponse.json({ success: true, data: { revokedCount: count } });
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return errorResponse(err, "qr_links.post.route_error");
  }
}
