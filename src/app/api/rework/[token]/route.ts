import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";
import { startRework, completeRework } from "@/lib/server/workflow-service";

/**
 * /rework/{token} API — §19, §27, §30.
 *
 * Purpose scope: REWORK only. Shows ONLY the assigned rework tasks (never the
 * whole job's finance, other areas' issues, or internal notes beyond the fix
 * instructions). START and COMPLETE are idempotent and drive
 * REWORK_ASSIGNED → REWORK_IN_PROGRESS → REWORK_COMPLETED.
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`rw:${clientIp(request)}`, 90, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const resolved = await resolveQrToken(params.token, "REWORK");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { job } = resolved.data;

    const [tasks, jobRow] = await Promise.all([
      prisma.reworkTask.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } }),
      prisma.job.findUnique({ where: { id: job.id }, select: { status: true } }),
    ]);
    const issueByTask = await prisma.qualityIssue.findMany({
      where: { jobId: job.id, reworkTaskId: { not: null } },
      select: { reworkTaskId: true, area: true, severity: true, itemDescription: true },
    });
    const issueMap = new Map(issueByTask.map((i) => [i.reworkTaskId, i]));

    return NextResponse.json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: jobRow?.status ?? job.status,
          serviceName: (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service",
          propertyAddress: job.propertyAddress,
        },
        tasks: tasks.map((t) => {
          const issue = issueMap.get(t.id);
          return {
            id: t.id,
            instructions: t.instructions,
            status: t.status,
            area: issue?.area ?? null,
            severity: issue?.severity ?? null,
            problem: issue?.itemDescription ?? null,
            completedNotes: t.completedNotes,
            completedAt: t.completedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
          };
        }),
      },
    });
  } catch (err) {
    logger.error("rework.get.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load the rework task.", 500);
  }
}

const StartSchema = z.object({ action: z.literal("start") });
const CompleteSchema = z.object({
  action: z.literal("complete"),
  notes: z.string().max(1000).default(""),
  photoArea: z.string().max(80).optional(),
  image: z.string().min(64).optional(),
});

export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`rw-post:${clientIp(request)}`, 30, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const resolved = await resolveQrToken(params.token, "REWORK");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { job } = resolved.data;

    if (body?.action === "start") {
      const parsed = StartSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const res = await startRework(job.id, { name: "Field Staff (rework link)" });
      if (!res.ok) return fail(res.message, 409);
      return NextResponse.json({ success: true, data: { already: res.already, status: "REWORK_IN_PROGRESS" } });
    }

    if (body?.action === "complete") {
      const parsed = CompleteSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);

      // Optional evidence photo on the rework link.
      if (parsed.data.image) {
        const { uploadJobPhoto, validateImagePayload } = await import("@/lib/server/cloudinary");
        const valid = validateImagePayload(parsed.data.image);
        if (!valid.ok) return fail(valid.error, 400);
        const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
        if (jobRow && ["REWORK_ASSIGNED", "REWORK_IN_PROGRESS"].includes(jobRow.status)) {
          const upload = await uploadJobPhoto(parsed.data.image, job.id, "after");
          if (upload.ok) {
            await prisma.jobPhoto.create({
              data: {
                jobId: job.id,
                area: parsed.data.photoArea?.trim() || "Rework",
                photoType: "after",
                cloudinaryPublicId: upload.data.publicId,
                photoUrl: upload.data.url,
                thumbnailUrl: upload.data.thumbnailUrl,
                bytes: upload.data.bytes,
                width: upload.data.width,
                height: upload.data.height,
                format: upload.data.format,
                caption: "Rework evidence",
                uploadedByUserId: "rework-link",
                uploadedByName: "Field Staff (rework link)",
              },
            });
            await recordActivity({
              jobId: job.id,
              type: "PHOTO_UPLOADED",
              message: "Rework evidence photo uploaded (rework link)",
              actor: { name: "Field Staff", role: "staff" },
            });
          }
        }
      }

      const res = await completeRework(job.id, parsed.data.notes || "Corrective work completed via rework link.", {
        id: "rework-link",
        name: "Field Staff (rework link)",
        role: "staff",
      });
      if (!res.ok) return fail(res.message, 409);
      return NextResponse.json({ success: true, data: { status: "REWORK_COMPLETED" } });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("rework.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
