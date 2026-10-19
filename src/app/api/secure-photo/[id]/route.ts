import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { logger } from "@/lib/server/logger";
import { getSystemSettings, resolveVisibility } from "@/lib/server/settings";
import { fetchPhoto, imageResponse } from "@/lib/server/photo-delivery";

/**
 * §36 — private evidence delivery. Photos are served through this proxy only
 * when the caller presents a LIVE QR token (correct job, purpose-appropriate,
 * not expired, not revoked). Cloudinary URLs are never exposed to the token
 * holder; the proxy streams the image bytes after validation. Tokens expire
 * with the link, so every URL rendered on a secure page is inherently
 * temporary and revocable (revoke → the image stops loading).
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const rl = rateLimit(`photo:${clientIp(request)}`, 600, 60 * 1000);
    if (!rl.ok) return new NextResponse("Too many requests", { status: 429 });

    const { searchParams } = new URL(request.url);
    const token = searchParams.get("t") || "";
    const resolved = await resolveQrToken(token);
    if (!resolved.ok) {
      return new NextResponse("Link inactive", { status: resolved.failure.kind === "not_found" ? 404 : 410 });
    }
    const jobId = resolved.data.job.id;

    const photo = await prisma.jobPhoto.findUnique({ where: { id: params.id } });
    if (!photo || photo.jobId !== jobId || !["before", "after"].includes(photo.photoType)) {
      // Token from a DIFFERENT job can never read another job's photo, and
      // QC / rework evidence is internal — never served on the customer link.
      return new NextResponse("Not found", { status: 404 });
    }
    // Customer visibility: before/after photos the admin hid are not served either.
    const [settings, jobVis] = await Promise.all([
      getSystemSettings(),
      prisma.job.findUnique({ where: { id: jobId }, select: { customerVisibility: true } }),
    ]);
    const vis = resolveVisibility(settings.customerVisibility, jobVis?.customerVisibility);
    if ((photo.photoType === "before" && !vis.beforePhotos) || (photo.photoType === "after" && !vis.afterPhotos)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const upstream = await fetchPhoto(photo, searchParams.get("s") === "thumb" ? "thumb" : "full");
    if (!upstream) return new NextResponse("Photo temporarily unavailable", { status: 502 });
    return imageResponse(upstream, 300) as NextResponse;
  } catch (err) {
    logger.error("secure_photo.route_error", { error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("Photo delivery failed", { status: 500 });
  }
}
