import { v2 as cloudinary } from "cloudinary";
import { logger } from "./logger";

/**
 * Cloudinary integration — the single image-storage backend for the platform.
 *
 * Configuration is exclusively server-side via environment variables:
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 * (optional: CLOUDINARY_FOLDER, default "intense-care").
 *
 * Secrets NEVER reach the client: uploads and deletions happen only through
 * authenticated API routes, and the database stores only Cloudinary
 * identifiers/URLs plus display metadata.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
export const PHOTO_FOLDER = process.env.CLOUDINARY_FOLDER || "intense-care";

export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && API_KEY && API_SECRET);
}

function ensureConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured on the server (missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)."
    );
  }
}

function client() {
  ensureConfigured();
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
  });
  return cloudinary;
}

/** Allowed image MIME types for evidence photos. */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export function validateImagePayload(dataUrl: string): { ok: true; mime: string } | { ok: false; error: string } {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,/.exec(dataUrl);
  if (!match) {
    return { ok: false, error: "Image must be a base64 data URL." };
  }
  const mime = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    return { ok: false, error: "Unsupported image format. Use JPEG, PNG, WebP or HEIC." };
  }
  const base64 = dataUrl.slice(match[0].length);
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes <= 0) {
    return { ok: false, error: "Image payload is empty." };
  }
  if (approxBytes > MAX_BYTES) {
    return { ok: false, error: "Image exceeds the 15 MB limit." };
  }
  return { ok: true, mime };
}

export interface UploadedPhoto {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
}

/**
 * Uploads a base64 data-URL image into the job evidence folder and returns
 * the Cloudinary identifiers. The original asset is kept (evidence value);
 * a derived thumbnail is addressable via Cloudinary transformation params.
 */
export async function uploadJobPhoto(
  dataUrl: string,
  jobId: string,
  photoType: "before" | "after" | "qc" | "rework"
): Promise<{ ok: true; data: UploadedPhoto } | { ok: false; error: string }> {
  const check = validateImagePayload(dataUrl);
  if (!check.ok) return { ok: false, error: check.error };

  try {
    const cld = client();
    const result = await cld.uploader.upload(dataUrl, {
      folder: `${PHOTO_FOLDER}/jobs/${jobId}`,
      // Evidence photos are stored untransformed; delivery URLs may transform.
      resource_type: "image",
      // Context tags make bulk audits easy in the Cloudinary console.
      context: `jobId=${jobId}|photoType=${photoType}`,
      tags: [PHOTO_FOLDER, `job_${jobId}`, photoType],
    });

    const publicId: string = result.public_id;
    const thumb = cld.url(publicId, {
      secure: true,
      transformation: [{ width: 480, height: 270, crop: "fill", quality: "auto", fetch_format: "auto" }],
    });

    return {
      ok: true,
      data: {
        publicId,
        url: result.secure_url,
        thumbnailUrl: thumb,
        bytes: result.bytes ?? 0,
        width: result.width ?? 0,
        height: result.height ?? 0,
        format: result.format ?? "",
      },
    };
  } catch (err) {
    logger.error("cloudinary.upload_failed", {
      jobId,
      photoType,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Image upload failed. Please retry." };
  }
}

/** Deletes a Cloudinary asset; missing assets resolve (idempotent cleanup). */
export async function deleteJobPhoto(publicId: string): Promise<boolean> {
  try {
    const cld = client();
    const result = await cld.uploader.destroy(publicId, { resource_type: "image" });
    const ok = result.result === "ok" || result.result === "not found";
    if (!ok) {
      logger.warn("cloudinary.destroy_unexpected", { publicId, result: result.result });
    }
    return ok;
  } catch (err) {
    logger.error("cloudinary.destroy_failed", {
      publicId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
