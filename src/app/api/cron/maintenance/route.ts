import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runMaintenance } from "@/lib/server/maintenance";

/**
 * GET|POST /api/cron/maintenance — run by a scheduler every ~15 minutes (Vercel Cron, or any external
 * scheduler). Sends job reminders and lead follow-up alerts, purges contacts past their retention period.
 * Requires `Authorization: Bearer $CRON_SECRET` (Vercel Cron adds it itself). Without CRON_SECRET the
 * endpoint is disabled.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: "Not configured." }, { status: 503 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  // `asOf` (ISO time) runs the job as if it were then — for backfilling after an outage and for tests. Needs the secret like everything here.
  const asOf = new URL(request.url).searchParams.get("asOf");
  const at = asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf) : new Date();
  return NextResponse.json({ success: true, data: await runMaintenance(at) }, { headers: { "Cache-Control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
