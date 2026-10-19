import { client, isCloudinaryConfigured, PHOTO_FOLDER } from "./cloudinary";
import { logger } from "./logger";

/**
 * The cloud storage provider as the media manager sees it (Cloudinary — the ERP's
 * existing provider; no other service is introduced). Everything the provider does
 * not report stays null: nothing is guessed.
 */

export interface ProviderUsage {
  configured: boolean;
  usageBytes: number | null;
  /** Storage limit in bytes — only when the provider's plan reports one. */
  limitBytes: number | null;
  plan: string | null;
  error: string | null;
  fetchedAt: string | null;
}

export interface RemoteAsset {
  publicId: string;
  bytes: number;
  format: string | null;
  createdAt: string | null;
  url: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Cloudinary's own message for a failed call (without the secret-bearing parts). */
function describe(err: unknown): string {
  const e = err as { message?: string; error?: { message?: string; http_code?: number }; http_code?: number };
  const code = e?.error?.http_code ?? e?.http_code;
  const msg = e?.error?.message ?? e?.message ?? String(err);
  if (code === 401 || code === 403) return `Cloudinary refused the request (${code}). Check the API key and secret.`;
  if (code === 420 || code === 429) return "Cloudinary rate limit reached. Try again in a few minutes.";
  return `Cloudinary error${code ? ` (${code})` : ""}: ${String(msg).slice(0, 200)}`;
}

export async function providerUsage(): Promise<ProviderUsage> {
  if (!isCloudinaryConfigured()) return { configured: false, usageBytes: null, limitBytes: null, plan: null, error: null, fetchedAt: null };
  try {
    const u = (await client().api.usage()) as Record<string, unknown>;
    const storage = (u.storage ?? {}) as Record<string, unknown>;
    // Storage "usage" is bytes; a "limit" exists only on plans that cap storage directly.
    return {
      configured: true,
      usageBytes: num(storage.usage),
      limitBytes: num(storage.limit),
      plan: typeof u.plan === "string" ? u.plan : null,
      error: null,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("media.provider_usage_failed", { error: describe(err) });
    return { configured: true, usageBytes: null, limitBytes: null, plan: null, error: describe(err), fetchedAt: null };
  }
}

/** Lists the files under the ERP's folder (images). `truncated` is true when more pages exist than were read. */
export async function listRemoteAssets(maxPages = 10): Promise<{ assets: RemoteAsset[]; truncated: boolean; error: string | null }> {
  if (!isCloudinaryConfigured()) return { assets: [], truncated: false, error: null };
  const assets: RemoteAsset[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < maxPages; page++) {
      const r = (await client().api.resources({ type: "upload", resource_type: "image", prefix: `${PHOTO_FOLDER}/`, max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) })) as { resources?: Record<string, unknown>[]; next_cursor?: string };
      for (const a of r.resources ?? []) {
        assets.push({
          publicId: String(a.public_id),
          bytes: num(a.bytes) ?? 0,
          format: typeof a.format === "string" ? a.format : null,
          createdAt: typeof a.created_at === "string" ? a.created_at : null,
          url: typeof a.secure_url === "string" ? a.secure_url : null,
        });
      }
      cursor = r.next_cursor;
      if (!cursor) return { assets, truncated: false, error: null };
    }
    return { assets, truncated: true, error: null };
  } catch (err) {
    logger.warn("media.provider_list_failed", { error: describe(err) });
    return { assets, truncated: false, error: describe(err) };
  }
}

export type DestroyOutcome = { ok: true; found: boolean } | { ok: false; error: string };

/** Deletes one asset. "Not found" counts as success (it's already gone); anything else is an error — the caller then keeps its database row. */
export async function destroyRemoteAsset(publicId: string): Promise<DestroyOutcome> {
  if (!isCloudinaryConfigured()) return { ok: false, error: "Cloud storage isn't configured on the server." };
  try {
    const r = (await client().uploader.destroy(publicId, { resource_type: "image", invalidate: true })) as { result?: string };
    if (r.result === "ok") return { ok: true, found: true };
    if (r.result === "not found") return { ok: true, found: false };
    return { ok: false, error: `Cloudinary answered "${r.result ?? "unknown"}".` };
  } catch (err) {
    logger.warn("media.provider_destroy_failed", { error: describe(err) });
    return { ok: false, error: describe(err) };
  }
}
