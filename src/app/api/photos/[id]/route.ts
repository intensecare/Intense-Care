import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { authorize } from "@/lib/rbac";
import { deleteJobPhoto } from "@/lib/server/cloudinary";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * DELETE /api/photos/[id] — removes a photo from Cloudinary and the database.
 * Authorization: the uploading worker, any manager/admin, or an assigned
 * worker on the photo's job. Missing Cloudinary assets are tolerated so the
 * metadata row can always be cleaned up (idempotent).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("photos.delete");
    const { id } = params;

    const photo = await prisma.jobPhoto.findUnique({ where: { id } });
    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found." },
        { status: 404 }
      );
    }

    // Scope: ALL deletes anything, ASSIGNED deletes on assigned jobs, OWN only own uploads.
    const job = await prisma.job.findUnique({ where: { id: photo.jobId }, select: { assignedManagerId: true, assignedStaffIds: true, customerId: true } });
    const decision = authorize(user, "photos.delete", { ...job, createdByUserId: photo.uploadedByUserId });
    if (!decision.allowed) {
      logger.warn("photo.delete_denied", { photoId: id, by: user.id });
      return NextResponse.json(
        { success: false, error: "You are not authorized to delete this photo." },
        { status: 403 }
      );
    }

    // Remove the binary asset first; a provider failure does not block
    // metadata cleanup, but we record it for ops follow-up.
    const assetDeleted = await deleteJobPhoto(photo.cloudinaryPublicId);

    await prisma.jobPhoto.delete({ where: { id } });
    void recordAudit({ actor: user, action: "PHOTO_DELETED", entityType: "photo", entityId: id, jobId: photo.jobId, details: `${photo.photoType} ${photo.area}`, request: _request });

    logger.info("photo.deleted", {
      photoId: id,
      jobId: photo.jobId,
      publicId: photo.cloudinaryPublicId,
      assetDeleted,
      by: user.id,
    });

    return NextResponse.json({ success: true, data: { id, assetDeleted } });
  } catch (err) {
    return errorResponse(err, "photos.delete.route_error");
  }
}
