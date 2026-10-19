import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { authorizeJob } from "@/lib/server/authz";
import { fetchPhoto, imageResponse } from "@/lib/server/photo-delivery";
import { errorResponse } from "@/lib/server/http";

/**
 * GET /api/photos/[id]/image[?s=thumb] — a job photo for SIGNED-IN staff. Same access rule as the photo list:
 * Admin sees all, a Field Manager only photos of their jobs, QC the jobs in their queue. The storage URL itself is never sent to the browser.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const photo = await prisma.jobPhoto.findUnique({ where: { id: params.id } });
    if (!photo) return new NextResponse("Not found", { status: 404 });
    await authorizeJob(photo.jobId, "photos.view");
    const upstream = await fetchPhoto(photo, new URL(request.url).searchParams.get("s") === "thumb" ? "thumb" : "full");
    if (!upstream) return new NextResponse("Photo temporarily unavailable", { status: 502 });
    return imageResponse(upstream, 300) as NextResponse;
  } catch (err) {
    return errorResponse(err, "photos.image.route_error");
  }
}
