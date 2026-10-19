import { z } from "zod";
import { requireAnyPermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail, readJson } from "@/lib/server/serialize";
import { rateLimit } from "@/lib/server/qr-service";
import { extractFromMapLink } from "@/lib/server/map-link";
import { NextResponse } from "next/server";

const Body = z.object({ link: z.string().max(2500) });

/**
 * POST /api/location/extract { link } — reads a pasted Google Maps (or OSM / Apple) link.
 * Staff who can create or edit properties / jobs only. Returns what it found; it never saves anything — the Admin
 * checks the pin on the map and saves the property themselves. A failure carries a code and a human message.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireAnyPermission(["properties.create", "properties.update", "jobs.create"]);
    if (!rateLimit(`map-extract:${user.id}`, 30, 10 * 60 * 1000).ok) return fail("Too many lookups. Wait a few minutes.", 429);
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail("Paste a map link.", 400);
    const r = await extractFromMapLink(parsed.data.link);
    // A link we can't use is a normal answer (200 with ok:false), not a server error.
    return NextResponse.json({ success: true, data: r }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "location.extract.route_error");
  }
}
