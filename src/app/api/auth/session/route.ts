import { NextResponse } from "next/server";
import { destroySession, getSessionUser } from "@/lib/server/session";
import { errorResponse } from "@/lib/server/http";
import { grantsFor, workspaceFor, navFor, ROLE_LABELS } from "@/lib/rbac";

/**
 * GET /api/auth/session — the signed-in identity PLUS everything the client
 * needs to render the role workspace without guessing:
 *   - grants: every permission + scope the role holds (from the central matrix)
 *   - workspace: home / queue / layout / nav items the role may open
 * The client treats this as a rendering hint; every API call re-checks.
 *
 * DELETE — clears the session cookie.
 *
 * There is deliberately NO POST handler: sessions are established only by
 * POST /api/auth/login after bcrypt verification.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const ws = workspaceFor(user.role);
    return NextResponse.json({
      success: true,
      data: {
        ...user,
        roleLabel: ROLE_LABELS[user.role],
        grants: grantsFor(user.role),
        workspace: { title: ws.title, home: ws.home, queue: ws.queue, layout: ws.layout, nav: navFor(user.role) },
      },
    });
  } catch (err) {
    return errorResponse(err, "auth.session.get_error");
  }
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ success: true });
}
