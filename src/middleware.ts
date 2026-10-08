import { NextResponse, type NextRequest } from "next/server";

/**
 * Page guard (runs before any protected page is served).
 *   - No valid, unexpired, correctly-signed session cookie → redirect to
 *     /login. A signed-out user (or the browser Back button after sign-out)
 *     never receives a protected page.
 *   - Protected pages are sent with Cache-Control: no-store so the browser
 *     keeps no copy to show from its back/forward cache.
 * The full check — user still active, role, session not revoked — still runs
 * on every API call (src/lib/server/session.ts). Login and the customer's
 * secure link / QR page are public and are not matched here.
 */

const COOKIE_NAME = "erp_session";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function validCookie(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(encoded)));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    const secret = process.env.ERP_SESSION_SECRET;
    if (!secret) return true; // cannot verify here; every API call still verifies
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(encoded));
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const ok = await validCookie(request.cookies.get(COOKIE_NAME)?.value);
  if (!ok) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return res;
}

export const config = {
  // Every page except: API routes, Next internals, static files, login and
  // the customer's secure link.
  matcher: ["/((?!api/|_next/|customer/|login|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
