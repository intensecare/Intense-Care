import crypto from "crypto";

/**
 * key = HMAC-SHA256(secret, "customer-link:<orderId>:<linkVersion>") truncated
 * to 32 base64url chars (192 bits). Pure — no database, no request context.
 */
export function customerKey(orderId: string, linkVersion: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`customer-link:${orderId}:${linkVersion}`).digest("base64url").slice(0, 32);
}

export function verifyCustomerKey(orderId: string, linkVersion: number, key: string, secret: string): boolean {
  const a = Buffer.from(customerKey(orderId, linkVersion, secret));
  const b = Buffer.from(typeof key === "string" ? key : "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
