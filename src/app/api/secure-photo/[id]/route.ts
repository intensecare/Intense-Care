import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { logger } from "@/lib/server/logger";

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
    const rl = rateLimit(`photo:${clientIp(request)}`, 120, 60 * 1000);
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

    const source = photo.photoUrl;
    const upstream = await fetch(source);
    if (!upstream.ok || !upstream.body) {
      logger.warn("secure_photo.upstream_failed", { photoId: photo.id, status: upstream.status });
      return new NextResponse("Photo temporarily unavailable", { status: 502 });
    }
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    headers.set("Cache-Control", "private, max-age=300");
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    logger.error("secure_photo.route_error", { error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("Photo delivery failed", { status: 500 });
  }
}
