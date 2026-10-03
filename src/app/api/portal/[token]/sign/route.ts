import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { recordSignOff } from "@/lib/server/completion-service";
import { logger } from "@/lib/server/logger";
import { prisma } from "@/lib/server/prisma";
import { recordActivity } from "@/lib/server/activity";

const BodySchema = z.object({
  decision: z.enum(["APPROVED", "ATTENTION_REQUESTED"]),
  signatoryName: z.string().min(2).max(120),
  notes: z.string().max(2000).optional(),
});

function hashIp(ip: string | null): string | undefined {
  if (!ip) return undefined;
  const salt = process.env.ERP_SESSION_SECRET || "portal-sign-ip";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * POST /api/portal/[token]/sign — public, token-gated customer sign-off.
 * APPROVED advances the job to COMPLETED and records the digital signature
 * (name, UA, hashed IP). ATTENTION_REQUESTED keeps the job open for ops.
 */
export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "A decision and your full name are required." },
        { status: 400 }
      );
    }

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : null;

    const result = await recordSignOff(params.token, {
      decision: parsed.data.decision,
      signatoryName: parsed.data.signatoryName,
      notes: parsed.data.notes,
      userAgent: request.headers.get("user-agent") || undefined,
      ipHash: hashIp(ip),
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }

    const { invite, job, alreadySigned } = result;

    if (parsed.data.decision === "APPROVED" && !alreadySigned) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "COMPLETED", updatedAt: new Date() },
      });
      logger.info("portal.sign.completed_job", { jobId: job.id });
    }

    // Live feed: ops/QC see the customer's decision the moment it happens.
    await recordActivity({
      jobId: job.id,
      type: parsed.data.decision === "APPROVED" ? "CUSTOMER_SIGNED" : "ATTENTION_REQUESTED",
      message:
        parsed.data.decision === "APPROVED"
          ? `Customer digitally signed off the completed service${parsed.data.signatoryName ? ` — ${parsed.data.signatoryName}` : ""}`
          : `Customer requested attention: ${parsed.data.notes || "see handover ticket"}`,
      actor: { name: parsed.data.signatoryName || "Customer", role: "customer" },
    });

    return NextResponse.json({
      success: true,
      data: {
        signStatus: invite.signStatus,
        signedAt: invite.signedAt,
        alreadySigned,
        jobStatus: parsed.data.decision === "APPROVED" ? "COMPLETED" : job.status,
      },
    });
  } catch (err) {
    logger.error("portal.sign.route_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: "Sign-off failed due to a server error." },
      { status: 500 }
    );
  }
}
