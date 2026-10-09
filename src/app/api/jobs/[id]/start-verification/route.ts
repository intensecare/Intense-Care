import { prisma } from "@/lib/server/prisma";
import { authorizeJob } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { effectiveStartMode, normalizeStartMode } from "@/lib/start-verification";

/**
 * GET /api/jobs/[id]/start-verification — the mode that applies to this job and
 * every start attempt (passed, failed, Admin override). Admin only (jobs.assign);
 * a Field Manager sees the mode on their own job screen.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await authorizeJob(params.id, "jobs.assign");
    const [job, sv, attempts] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: params.id }, select: { startVerificationMode: true } }),
      getSystemSettings().then((s) => s.jobStartVerification),
      prisma.jobStartVerification.findMany({ where: { jobId: params.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return ok({
      mode: effectiveStartMode(job.startVerificationMode, sv),
      jobMode: normalizeStartMode(job.startVerificationMode),
      settings: sv,
      attempts: attempts.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), user: a.userName, role: a.userRole, mode: a.mode, result: a.result, failureReason: a.failureReason, lat: a.lat, lng: a.lng, accuracy: a.accuracy, distanceM: a.distanceM, qrResult: a.qrResult, gpsResult: a.gpsResult, gpsCheckedAt: a.gpsCheckedAt?.toISOString() ?? null, qrCheckedAt: a.qrCheckedAt?.toISOString() ?? null, targetLat: a.targetLat, targetLng: a.targetLng, targetSource: a.targetSource, overrideReason: a.overrideReason, statusBefore: a.statusBefore, statusAfter: a.statusAfter })),
    });
  } catch (err) {
    return errorResponse(err, "jobs.start_verification.get_error");
  }
}
