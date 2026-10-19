import { logger } from "./logger";
import { client } from "./cloudinary";

/**
 * Fetches a stored job photo from the storage provider for the ERP's own image routes (customer link + staff).
 * The browser never receives a storage URL: it asks the ERP, the ERP checks who is asking, and streams the bytes.
 *
 * If the provider refuses the plain delivery URL (an account with "strict transformations", restricted or
 * authenticated media), a SIGNED delivery URL is generated server-side and tried next. A thumbnail is a signed
 * transformation of the original, so it works on those accounts too; if it can't be made the original is used.
 */
export interface PhotoSource {
  id: string;
  photoUrl: string;
  cloudinaryPublicId: string;
}

function signed(publicId: string, thumb: boolean): string | null {
  try {
    return client().url(publicId, {
      secure: true,
      sign_url: true,
      resource_type: "image",
      ...(thumb ? { transformation: [{ width: 480, height: 480, crop: "fill", quality: "auto", fetch_format: "auto" }] } : {}),
    });
  } catch {
    return null;
  }
}

async function tryFetch(url: string | null): Promise<Response | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "follow" });
    if (!res.ok || !res.body) return null;
    // Only ever hand images on: a provider error page must not reach the user's browser as if it were a photo.
    if (!(res.headers.get("content-type") || "").toLowerCase().startsWith("image/")) return null;
    return res;
  } catch {
    return null;
  }
}

export async function fetchPhoto(photo: PhotoSource, size: "full" | "thumb"): Promise<Response | null> {
  const candidates = size === "thumb" ? [() => signed(photo.cloudinaryPublicId, true), () => photo.photoUrl, () => signed(photo.cloudinaryPublicId, false)] : [() => photo.photoUrl, () => signed(photo.cloudinaryPublicId, false)];
  for (const c of candidates) {
    const res = await tryFetch(c());
    if (res) return res;
  }
  logger.warn("photo_delivery.unavailable", { photoId: photo.id });
  return null;
}

export function imageResponse(upstream: Response, cacheSeconds: number): Response {
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
  headers.set("Cache-Control", `private, max-age=${cacheSeconds}`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  return new Response(upstream.body, { status: 200, headers });
}

/** What staff screens receive for a photo: ERP image routes instead of storage URLs, and no storage identifiers. */
export function staffPhotoView<T extends { id: string; photoUrl: string; thumbnailUrl: string | null; cloudinaryPublicId?: string }>(p: T) {
  const { cloudinaryPublicId: _drop, ...rest } = p;
  void _drop;
  return { ...rest, photoUrl: `/api/photos/${p.id}/image`, thumbnailUrl: `/api/photos/${p.id}/image?s=thumb` };
}
