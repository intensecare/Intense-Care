import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, authorizeJob, visibleJobIds } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { uploadJobPhoto, validateImagePayload } from "@/lib/server/cloudinary";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";

const BodySchema = z.object({
  jobId: z.string().min(1).max(64),
  area: z.string().min(1).max(80),
  photoType: z.enum(["before", "after"]),
  image: z.string().min(64), // base64 data URL; strict shape validated below
  caption: z.string().max(300).optional(),
});

/**
 * GET /api/photos?jobId=... — lists evidence photos for a job from the
 * database (Cloudinary URLs + metadata). Authorization mirrors job access:
 * assigned workers see their jobs' photos; managers/admins see all. When no
 * jobId is given, managers/admins receive the full index (ops dashboards);
 * staff receive only photos of their assigned jobs.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("photos.view");
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (jobId) {
      await authorizeJob(jobId, "photos.view");
      const photos = await prisma.jobPhoto.findMany({ where: { jobId }, orderBy: { uploadedAt: "desc" } });
      return NextResponse.json({ success: true, data: photos });
    }

    const ids = await visibleJobIds(user, "photos.view");
    const photos = await prisma.jobPhoto.findMany({
      where: ids === "ALL" ? undefined : { jobId: { in: ids } },
      orderBy: { uploadedAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ success: true, data: photos });
  } catch (err) {
    return errorResponse(err, "photos.get.route_error");
  }
}

/**
 * POST /api/photos — uploads a job evidence photo to Cloudinary and records
 * the identifiers + metadata in the database. Authorization: assigned field
 * workers (lead or support) and managers/admins on the job.
 * Secrets stay server-side; the client only ever receives Cloudinary URLs.
 */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "jobId, area, photoType and image are required." },
        { status: 400 }
      );
    }

    const { jobId, area, photoType, image, caption } = parsed.data;

    // Pre-validate payload shape before authorization to fail fast on junk.
    const valid = validateImagePayload(image);
    if (!valid.ok) {
      return NextResponse.json(
        { success: false, error: valid.error },
        { status: 400 }
      );
    }

    const { user } = await authorizeJob(jobId, "photos.upload");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }

    const upload = await uploadJobPhoto(image, jobId, photoType);
    if (!upload.ok) {
      const status = upload.error.includes("not configured") ? 503 : 502;
      return NextResponse.json(
        { success: false, error: upload.error },
        { status }
      );
    }

    const photo = await prisma.jobPhoto.create({
      data: {
        jobId,
        area: area.trim(),
        photoType,
        cloudinaryPublicId: upload.data.publicId,
        photoUrl: upload.data.url,
        thumbnailUrl: upload.data.thumbnailUrl,
        bytes: upload.data.bytes,
        width: upload.data.width,
        height: upload.data.height,
        format: upload.data.format,
        caption: caption?.trim() || null,
        uploadedByUserId: user.id,
        uploadedByName: user.name,
      },
    });

    logger.info("photo.uploaded", {
      photoId: photo.id,
      jobId,
      photoType,
      publicId: upload.data.publicId,
      by: user.id,
    });

    void recordAudit({ actor: user, action: "PHOTO_UPLOADED", entityType: "photo", entityId: photo.id, jobId, details: `${photoType} ${area.trim()}`, request });
    // Supervisor-visible live feed event (QC sees evidence land in real time).
    await recordActivity({
      jobId,
      type: "PHOTO_UPLOADED",
      message: `${photoType === "before" ? "Before" : "After"} photo uploaded for ${area.trim()}${caption?.trim() ? ` — “${caption.trim()}”` : ""}`,
      actor: { id: user.id, name: user.name, role: user.role },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: photo.id,
        jobId: photo.jobId,
        area: photo.area,
        photoType: photo.photoType as "before" | "after",
        photoUrl: photo.photoUrl,
        thumbnailUrl: photo.thumbnailUrl,
        caption: photo.caption,
        uploadedBy: photo.uploadedByName,
        uploadedAt: photo.uploadedAt.toISOString(),
      },
    });
  } catch (err) {
    return errorResponse(err, "photos.post.route_error");
  }
}
