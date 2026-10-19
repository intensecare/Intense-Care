import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { requireDevice } from "@/lib/server/devices";
import { processSyncBatch, SyncPausedError, SyncRequestError } from "@/lib/server/contact-sync";
import { readJson } from "@/lib/server/serialize";

/**
 * POST /api/mobile/contacts/sync — one batch of contacts from the phone's sync run.
 * Authenticated by the phone's scoped token (not the session cookie). Idempotent per
 * `idempotencyKey`; at most 200 contacts per batch.
 */
export async function POST(request: Request) {
  try {
    const { device, user } = await requireDevice(request, "contacts.sync");
    const body = await readJson(request);
    const result = await processSyncBatch(device, user, body);
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof SyncPausedError) return NextResponse.json({ success: false, code: "SYNC_PAUSED", error: "Contact sync is paused for this phone." }, { status: 423 });
    if (err instanceof SyncRequestError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    return errorResponse(err, "mobile.contacts.sync.route_error");
  }
}
