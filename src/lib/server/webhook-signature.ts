import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta's X-Hub-Signature-256: "sha256=" + HMAC-SHA256(raw body, app secret), compared in constant time. */
export function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), "hex");
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
