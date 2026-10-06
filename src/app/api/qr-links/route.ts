import { NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import {
  mintQrToken,
  revokeQrToken,
  revokeAllForJob,
  serializeQrToken,
  QR_PURPOSES,
  PURPOSE_LABEL,
  type QrPurpose,
} from "@/lib/server/qr-service";

/**
 * §35 — ADMIN → QR & SECURE LINKS.
 *
 * super_admin + ops_manager (the QC desk mints approval links on pass). Table of every token with Type / Job / Purpose / Created /
 * Expires / Status / Last Used / Actions. Actions:
 *   [SHOW QR]   → PNG data URL of the short URL (only until revealed)
 *   [COPY LINK] → the raw link, revealed once on demand (never stored raw)
 *   [SHARE]     → WhatsApp share URL for the link
 *   [DOWNLOAD]  → QR PNG at 1024px for print
 *   [REGENERATE]→ revoke old + mint fresh (old stops working instantly)
 *   [REVOKE]    → kill switch (§5)
 */

export async function GET() {
  try {
    await requireRole(["super_admin", "ops_manager"]);
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
        purposes: QR_PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABEL[p] })),
      },
    });
  } catch (err) {
    return errorResponse(err, "qr_links.get.route_error");
  }
}

const MintSchema = z.object({
  action: z.literal("mint"),
  jobId: z.string().min(1).max(64),
  purpose: z.enum(["CUSTOMER_JOB", "CUSTOMER_VERIFICATION", "CUSTOMER_APPROVAL", "MANAGER_JOB", "QC_INSPECTION", "REWORK", "REINSPECTION"]),
});

const TokenActionSchema = z.object({
  action: z.enum(["reveal", "qr", "qr-download", "share", "revoke"]),
  tokenId: z.string().min(1).max(64),
  reason: z.string().max(300).optional(),
});

const PurgeSchema = z.object({
  action: z.literal("purge-job"),
  jobId: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "mint") {
      const parsed = MintSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid mint payload." }, { status: 400 });
      const res = await mintQrToken(parsed.data.jobId, parsed.data.purpose as QrPurpose, {
        id: user.id,
        name: user.name,
      });
      if (!res.success) {
        const status = res.failure.kind === "not_found" ? 404 : res.failure.kind === "cooldown" ? 429 : 429;
        return NextResponse.json({ success: false, error: res.failure.message }, { status });
      }
      // Raw token is only present in this response — share/store it now.
      return NextResponse.json(
        {
          success: true,
          data: {
            ...res.data,
            reveal: res.data.linkUrl, // one-time reveal in the mint response
            shareUrl: `https://wa.me/?text=${encodeURIComponent(`${res.data.linkUrl}`)}`,
          },
        },
        { status: 201 }
      );
    }

    if (action === "reveal" || action === "qr" || action === "qr-download" || action === "share") {
      const parsed = TokenActionSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });

      const row = await prisma.qrToken.findUnique({ where: { id: parsed.data.tokenId } });
      if (!row) return NextResponse.json({ success: false, error: "Token not found." }, { status: 404 });

      // The raw token is not stored — it can only be revealed from the token
      // VALUE side. To make [COPY LINK]/[SHOW QR] possible after minting, the
      // service mints fresh tokens on reveal ONLY when the original is dead.
      // For live tokens we rebuild the link from a fresh mint of the same
      // purpose (cooldown-free path below) so the admin can always re-share.
      if (row.revokedAt) {
        return NextResponse.json(
          { success: false, error: "This token is revoked — REGENERATE to issue a fresh link." },
          { status: 409 }
        );
      }

      // §35 reveal-by-remint: mint a NEW token of the same purpose for the
      // same job and present its link/QR. The old token stays live until
      // revoked (or use purge-job). This keeps raw tokens out of the DB
      // entirely while making re-sharing possible at any time.
      if (action === "reveal" || action === "share") {
        const minted = await mintQrToken(row.jobId, row.purpose as QrPurpose, { id: user.id, name: user.name });
        if (!minted.success) {
          return NextResponse.json({ success: false, error: minted.failure.message }, { status: 429 });
        }
        return NextResponse.json({
          success: true,
          data: { linkUrl: minted.data.linkUrl, shortUrl: minted.data.shortUrl, expiresAt: minted.data.expiresAt },
        });
      }

      // QR image for the (freshly re-minted) same-purpose token.
      const minted = await mintQrToken(row.jobId, row.purpose as QrPurpose, { id: user.id, name: user.name });
      if (!minted.success) {
        return NextResponse.json({ success: false, error: minted.failure.message }, { status: 429 });
      }
      const urlForQr = action === "qr-download" ? minted.data.linkUrl : minted.data.shortUrl;
      const size = action === "qr-download" ? 1024 : 320;
      const dataUrl = await QRCode.toDataURL(urlForQr, {
        width: size,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      return NextResponse.json({ success: true, data: { qrDataUrl: dataUrl, linkUrl: minted.data.linkUrl, token: urlForQr.split("/").pop() } });
    }

    if (action === "revoke") {
      const parsed = TokenActionSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
      const ok = await revokeQrToken(parsed.data.tokenId, { id: user.id, name: user.name }, parsed.data.reason);
      if (!ok) return NextResponse.json({ success: false, error: "Token already revoked or not found." }, { status: 409 });
      return NextResponse.json({ success: true, data: { revoked: true } });
    }

    if (action === "purge-job") {
      const parsed = PurgeSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
      const count = await revokeAllForJob(parsed.data.jobId, undefined, "Compromise response — all tokens revoked");
      logger.warn("qr.purged_job_tokens", { jobId: parsed.data.jobId, count, by: user.id });
      return NextResponse.json({ success: true, data: { revokedCount: count } });
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return errorResponse(err, "qr_links.post.route_error");
  }
}
