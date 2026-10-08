import { headers } from "next/headers";
import { sessionSecret } from "./session";
import { customerKey as rawKey, verifyCustomerKey as rawVerify } from "./link-key";

/**
 * Customer secure link: /customer/order/AC1024?k=<key>
 *
 * The key is an HMAC of the order id + linkVersion (see link-key.ts): never
 * stored, so a database leak cannot mint links. Changing the order number in
 * the URL fails verification because the key is bound to the order id.
 * Bumping the order's linkVersion revokes every previously shared link.
 */
export function customerKey(orderId: string, linkVersion: number): string {
  return rawKey(orderId, linkVersion, sessionSecret());
}

export function verifyCustomerKey(orderId: string, linkVersion: number, key: string): boolean {
  return rawVerify(orderId, linkVersion, key, sessionSecret());
}

/** Public base URL: APP_BASE_URL, else the current request's host. */
export function baseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (host) return `${h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  } catch {
    /* outside a request */
  }
  return "http://localhost:3000";
}

export function customerLink(order: { id: string; orderNumber: string; linkVersion: number }): string {
  return `${baseUrl()}/customer/order/${encodeURIComponent(order.orderNumber)}?k=${customerKey(order.id, order.linkVersion)}`;
}
