import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Converts unknown route errors into typed JSON responses.
 * HttpError carries an HTTP status; anything else becomes a 500 with a
 * generic message (details go to the structured log, never the client).
 */
export function errorResponse(err: unknown, event: string): NextResponse {
  if (err instanceof Error && "status" in err && typeof (err as { status?: unknown }).status === "number") {
    return NextResponse.json({ success: false, error: err.message }, { status: (err as { status: number }).status });
  }
  logger.error(event, {
    error: err instanceof Error ? err.message : String(err),
  });
  return NextResponse.json(
    { success: false, error: "Request failed due to a server error." },
    { status: 500 }
  );
}
