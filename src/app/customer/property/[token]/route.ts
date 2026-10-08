import { NextResponse } from "next/server";
import { resolvePropertyAccess } from "@/lib/server/property-access";
import { ensureCustomerLink, clientIp, rateLimit } from "@/lib/server/qr-service";

export const dynamic = "force-dynamic";

/**
 * GET /customer/property/[token] — the ONE optional property QR.
 * Redirects to the customer page of the property's current or upcoming
 * service. The QR carries no customer data; it only leads to the job's own
 * secure service link, which the server authorizes as usual.
 */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  const rl = rateLimit(`property-qr:${clientIp(request)}`, 30, 60 * 1000);
  if (!rl.ok) return page("Too many attempts", "Please wait a minute and scan again.", 429);

  const access = await resolvePropertyAccess(params.token);
  if (!access) return page("This QR code is not active", "Please contact us for a new QR code.", 404);
  if (access.jobId) {
    const link = await ensureCustomerLink(access.jobId, { name: "Property QR" });
    if (link.success) {
      return NextResponse.redirect(new URL(link.data.linkPath, request.url), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    return page("One moment", "Your service page is being prepared. Please scan again in a minute.", 503);
  }
  return page("No upcoming service", `There is no service booked for ${access.propertyTitle} right now. Please contact us to book one.`, 200);
}

function page(title: string, body: string, status: number) {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fdfbf8;font-family:system-ui,sans-serif;color:#262626;padding:16px">
<div style="background:#fff;border:1px solid #efe9df;border-radius:24px;padding:32px;max-width:420px;text-align:center"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="margin:0;color:#615647;font-size:14px">${esc(body)}</p></div></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
