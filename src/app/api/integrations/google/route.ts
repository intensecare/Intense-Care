import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { getGoogleIntegrationStatus } from "@/lib/server/google-calendar";

/**
 * GET /api/integrations/google — Settings → Integrations status.
 * Reports Connected / Not Connected for the Google Calendar integration.
 */
export async function GET() {
  try {
    await requirePermission("integrations.manage");
    const status = await getGoogleIntegrationStatus();
    return NextResponse.json({ success: true, data: status });
  } catch (err) {
    return errorResponse(err, "integrations.google.route_error");
  }
}
