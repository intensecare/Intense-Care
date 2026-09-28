import { NextResponse } from "next/server";
import { destroySession, getSessionUser } from "@/lib/server/session";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/auth/session — returns the signed-in server session user.
 * DELETE — clears the session cookie.
 *
 * NOTE: there is deliberately NO POST handler. Sessions are established
 * exclusively through POST /api/auth/login, which verifies a bcrypt password
 * hash against the database. The previous session-sync endpoint allowed any
 * client to mint a session for an arbitrary user id — that hole is closed.
 */

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: user });
  } catch (err) {
    return errorResponse(err, "auth.session.get_error");
  }
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ success: true });
}
