import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, isManagerRole } from "@/lib/server/authz";
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
    const { user } = await requireUser();
    const { id } = params;

    const photo = await prisma.jobPhoto.findUnique({ where: { id } });
    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found." },
        { status: 404 }
      );
    }

    const isUploader = photo.uploadedByUserId === user.id;
    const manager = isManagerRole(user.role);
    let assignedToJob = false;
    if (!isUploader && !manager) {
      const job = await prisma.job.findUnique({ where: { id: photo.jobId } });
      assignedToJob = Boolean(
        job &&
          (job.assignedManagerId === user.id ||
            (Array.isArray(job.assignedStaffIds) && job.assignedStaffIds.includes(user.id)))
      );
    }

    if (!isUploader && !manager && !assignedToJob) {
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
