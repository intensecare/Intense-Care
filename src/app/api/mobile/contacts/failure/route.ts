import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { requireDevice } from "@/lib/server/devices";
import { recordRunFailure } from "@/lib/server/contact-sync";
import { ok, fail, readJson } from "@/lib/server/serialize";

const Body = z.object({ runId: z.string().min(8).max(64), trigger: z.string().max(20), errorCode: z.string().min(1).max(60), scanned: z.number().int().min(0).max(500000).optional() });

/** POST /api/mobile/contacts/failure — the phone reports a run that couldn't finish (permission lost, read error…). A code only. */
export async function POST(request: Request) {
  try {
    const { device, user } = await requireDevice(request, "contacts.sync");
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail("Invalid report.", 400);
    await recordRunFailure(device, user, parsed.data);
    return ok({ recorded: true });
  } catch (err) {
    return errorResponse(err, "mobile.contacts.failure.route_error");
  }
}
