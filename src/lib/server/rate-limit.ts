/**
 * In-memory fixed-window rate limiter (per server instance). Protects login
 * and the public customer link from brute force and scraping.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10000) {
      buckets.forEach((v, k) => {
        if (v.resetAt < now) buckets.delete(k);
      });
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
