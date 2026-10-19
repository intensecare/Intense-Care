import { prisma } from "@/lib/server/prisma";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { rateLimit } from "@/lib/server/qr-service";
import { messages, pushConfigured, pushToUser } from "@/lib/server/push";

/** POST /api/push/test — sends a test notification to the signed-in user's own phones (to check the setup). */
export async function POST() {
  try {
    const { user } = await requireUser();
    if (!rateLimit(`push-test:${user.id}`, 5, 10 * 60 * 1000).ok) return fail("Wait a few minutes before sending another test.", 429);
    if (!pushConfigured()) return fail("Push notifications aren't set up on the server yet (FCM_SERVICE_ACCOUNT_JSON).", 503);
    const phones = await prisma.mobileDevice.count({ where: { userId: user.id, revokedAt: null, pushToken: { not: null }, notificationsEnabled: true } });
    if (!phones) return fail("This phone isn't registered for notifications. Allow notifications in the app first.", 409);
    const r = await pushToUser(user.id, messages.test(), `test:${user.id}:${Date.now()}`);
    return r === "SENT" ? ok({ sent: true }) : fail("The notification service didn't accept it. Try again in a moment.", 502);
  } catch (err) {
    return errorResponse(err, "push.test.route_error");
  }
}
