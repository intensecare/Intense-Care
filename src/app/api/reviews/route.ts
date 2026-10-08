import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { can } from "@/lib/rbac";

/**
 * GET /api/reviews — Reviews & Feedback (Admin).
 *   private: star ratings + comments customers left on their QR page
 *   complaints: issues customers reported (resolve on the job / here)
 *   google: who was sent to Google, and — when GOOGLE_PLACES_API_KEY +
 *           GOOGLE_PLACE_ID are set — the public Google rating and latest reviews.
 * Private ERP feedback and public Google reviews are kept separate.
 */

let googleCache: { at: number; data: unknown } | null = null;

async function googleReviews() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const place = process.env.GOOGLE_PLACE_ID;
  if (!key || !place) return { configured: false as const };
  if (googleCache && Date.now() - googleCache.at < 60 * 60 * 1000) return googleCache.data as Record<string, unknown>;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place)}&fields=rating,user_ratings_total,reviews&reviews_sort=newest&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const json = (await res.json()) as { result?: { rating?: number; user_ratings_total?: number; reviews?: { author_name: string; rating: number; text: string; time: number; relative_time_description?: string }[] }; status?: string };
    if (json.status !== "OK" || !json.result) throw new Error(json.status || `HTTP ${res.status}`);
    const data = {
      configured: true as const,
      rating: json.result.rating ?? null,
      total: json.result.user_ratings_total ?? 0,
      reviews: (json.result.reviews ?? []).map((r) => ({ author: r.author_name, rating: r.rating, text: r.text, when: r.relative_time_description ?? new Date(r.time * 1000).toISOString().slice(0, 10) })),
    };
    googleCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    logger.warn("reviews.google_failed", { error: err instanceof Error ? err.message : String(err) });
    return { configured: true as const, error: "Google reviews couldn't be loaded right now." };
  }
}

export async function GET() {
  try {
    const { user } = await requirePermission("feedback.view");
    const settings = await getSystemSettings();
    const [rated, complaints, sentToGoogle] = await Promise.all([
      prisma.job.findMany({
        where: { customerFeedbackRating: { not: null } },
        orderBy: { customerFeedbackAt: "desc" },
        take: 300,
        select: { id: true, jobSerial: true, customerFeedbackRating: true, customerFeedbackComment: true, customerFeedbackAt: true, googleReviewClicked: true, customer: { select: { name: true } }, service: { select: { name: true } } },
      }),
      can(user, "complaints.view")
        ? prisma.complaint.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true, category: true, severity: true, status: true, description: true, createdAt: true, resolvedAt: true, resolutionNotes: true, job: { select: { id: true, jobSerial: true, customer: { select: { name: true } } } } } })
        : Promise.resolve([]),
      prisma.job.count({ where: { googleReviewClicked: true } }),
    ]);
    const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const r of rated) dist[String(r.customerFeedbackRating)]++;
    const avg = rated.length ? Math.round((rated.reduce((a, r) => a + (r.customerFeedbackRating ?? 0), 0) / rated.length) * 10) / 10 : null;
    return ok({
      summary: {
        ratings: rated.length,
        average: avg,
        distribution: dist,
        openComplaints: complaints.filter((c) => !["resolved", "closed"].includes(c.status)).length,
        sentToGoogle,
      },
      feedback: rated.map((r) => ({
        jobId: r.id,
        jobNumber: r.jobSerial,
        customer: r.customer.name,
        service: r.service.name,
        rating: r.customerFeedbackRating,
        comment: r.customerFeedbackComment,
        at: r.customerFeedbackAt?.toISOString() ?? null,
        googleReviewClicked: r.googleReviewClicked,
      })),
      complaints: complaints.map((c) => ({
        id: c.id,
        jobId: c.job.id,
        jobNumber: c.job.jobSerial,
        customer: c.job.customer.name,
        category: c.category,
        severity: c.severity,
        status: c.status,
        description: c.description,
        resolutionNotes: c.resolutionNotes,
        createdAt: c.createdAt.toISOString(),
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
      })),
      google: { reviewUrl: settings.googleBusinessReviewUrl || "", ...(await googleReviews()) },
    });
  } catch (err) {
    return errorResponse(err, "reviews.get.route_error");
  }
}
