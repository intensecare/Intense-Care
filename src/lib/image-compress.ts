/**
 * Browser-side evidence-photo compression.
 *
 * Phone camera photos routinely land at 3–8 MB; base64-encoding inflates them
 * another ~33% and the deployment platform rejects request bodies over a few
 * MB (FUNCTION_PAYLOAD_TOO_LARGE) — uploads then fail intermittently: small
 * images save, large ones don't. Every photo is therefore downscaled and
 * re-encoded to JPEG *in the browser* before the POST, keeping payloads in the
 * low hundreds of KB and making uploads both reliable and fast on mobile data.
 *
 * If a photo cannot be decoded by the current browser (e.g. HEIC opened in a
 * desktop browser without HEIC support), the original payload is returned
 * unchanged so the server can still accept it — compression never blocks an
 * upload, it only shrinks one when possible.
 */

const MAX_DIMENSION = 1600; // long edge in px — far above any evidence need
const JPEG_QUALITY = 0.82;
/** Images already below this size are passed through untouched (fast path). */
const SKIP_BELOW_BYTES = 600 * 1024;

export interface CompressedImage {
  dataUrl: string;
  originalBytes: number;
  finalBytes: number;
  compressed: boolean;
}

function approxBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const base64 = dataUrl.slice(comma + 1);
  // base64 expands binary by 4/3 (ignoring padding — good enough for sizing).
  return Math.floor((base64.length * 3) / 4);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be decoded by this browser."));
    img.src = dataUrl;
  });
}

/**
 * Returns a payload at most as large as the input: downscales to
 * MAX_DIMENSION long-edge and re-encodes as JPEG. Falls back to the original
 * data URL whenever decoding or encoding fails, or when the result would not
 * actually be smaller.
 */
export async function compressImageForUpload(dataUrl: string): Promise<CompressedImage> {
  const originalBytes = approxBytes(dataUrl);

  if (originalBytes <= SKIP_BELOW_BYTES) {
    return { dataUrl, originalBytes, finalBytes: originalBytes, compressed: false };
  }

  try {
    const img = await loadImage(dataUrl);
    if (!img.naturalWidth || !img.naturalHeight) {
      return { dataUrl, originalBytes, finalBytes: originalBytes, compressed: false };
    }

    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_DIMENSION / longEdge);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { dataUrl, originalBytes, finalBytes: originalBytes, compressed: false };
    }

    // JPEG has no alpha channel — flatten transparency onto white so PNG
    // screenshots don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const finalBytes = approxBytes(out);

    // Keep whichever payload is actually smaller (tiny images stay as-is).
    if (finalBytes >= originalBytes) {
      return { dataUrl, originalBytes, finalBytes: originalBytes, compressed: false };
    }
    return { dataUrl: out, originalBytes, finalBytes, compressed: true };
  } catch {
    // Undecodable here (HEIC in Chrome, corrupt file) — pass the original
    // through; the server-side validation is still the final judge.
    return { dataUrl, originalBytes, finalBytes: originalBytes, compressed: false };
  }
}
