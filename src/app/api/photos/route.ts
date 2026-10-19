import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, authorizeJob, visibleJobIds } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { uploadJobPhoto, validateImagePayload, deleteJobPhoto } from "@/lib/server/cloudinary";
import { Prisma } from "@prisma/client";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";
import { staffPhotoView } from "@/lib/server/photo-delivery";

const PHOTO_LABEL = { before: "Before", after: "After", qc: "QC evidence", rework: "Rework" } as const;

const BodySchema = z.object({
  jobId: z.string().min(1).max(64),
  area: z.string().min(1).max(80),
  photoType: z.enum(["before", "after", "qc", "rework"]),
  image: z.string().min(64), // base64 data URL; strict shape validated below
  caption: z.string().max(300).optional(),
  /** Id the app generated for this upload attempt: sending the same photo again (flaky network, app restart) returns the saved one. */
  clientUploadId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
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
      return NextResponse.json({ success: true, data: photos.map(staffPhotoView) });
    }

    const ids = await visibleJobIds(user, "photos.view");
    const photos = await prisma.jobPhoto.findMany({
      where: ids === "ALL" ? undefined : { jobId: { in: ids } },
      orderBy: { uploadedAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ success: true, data: photos.map(staffPhotoView) });
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

    const { jobId, area, photoType, image, caption, clientUploadId } = parsed.data;

    // Pre-validate payload shape before authorization to fail fast on junk.
    const valid = validateImagePayload(image);
    if (!valid.ok) {
      return NextResponse.json(
        { success: false, error: valid.error },
        { status: 400 }
      );
    }

    const { user } = await authorizeJob(jobId, photoType === "qc" ? "qc.inspect" : "photos.upload");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }

    // A retry of an upload that already succeeded: answer with the saved photo, store nothing twice.
    const serializePhoto = (p: { id: string; jobId: string; area: string; photoType: string; photoUrl: string; thumbnailUrl: string | null; caption: string | null; uploadedByName: string; uploadedAt: Date }) => ({
      id: p.id,
      jobId: p.jobId,
      area: p.area,
      photoType: p.photoType as "before" | "after" | "qc" | "rework",
      photoUrl: `/api/photos/${p.id}/image`,
      thumbnailUrl: `/api/photos/${p.id}/image?s=thumb`,
      caption: p.caption,
      uploadedBy: p.uploadedByName,
      uploadedAt: p.uploadedAt.toISOString(),
    });
    if (clientUploadId) {
      const again = await prisma.jobPhoto.findUnique({ where: { jobId_clientUploadId: { jobId, clientUploadId } } });
      if (again) return NextResponse.json({ success: true, replayed: true, data: serializePhoto(again) });
    }

    const upload = await uploadJobPhoto(image, jobId, photoType);
    if (!upload.ok) {
      const status = upload.error.includes("not configured") ? 503 : 502;
      return NextResponse.json(
        { success: false, error: upload.error },
        { status }
      );
    }

    let photo;
    try {
      photo = await prisma.jobPhoto.create({
      data: {
        clientUploadId: clientUploadId ?? null,
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
    } catch (e) {
      // The same upload id arrived twice at once: keep the first photo, drop this copy from cloud storage.
      if (clientUploadId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        void deleteJobPhoto(upload.data.publicId);
        const first = await prisma.jobPhoto.findUnique({ where: { jobId_clientUploadId: { jobId, clientUploadId } } });
        if (first) return NextResponse.json({ success: true, replayed: true, data: serializePhoto(first) });
      }
      throw e;
    }

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
      message: `${PHOTO_LABEL[photoType]} photo uploaded for ${area.trim()}${caption?.trim() ? ` — “${caption.trim()}”` : ""}`,
      actor: { id: user.id, name: user.name, role: user.role },
    });

    return NextResponse.json({ success: true, data: serializePhoto(photo) });
  } catch (err) {
    return errorResponse(err, "photos.post.route_error");
  }
}
