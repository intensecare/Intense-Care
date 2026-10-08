"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Star, MessageSquareWarning, ExternalLink, ThumbsUp } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { cn, formatDate } from "@/lib/utils";

interface ReviewsData {
  summary: { ratings: number; average: number | null; distribution: Record<string, number>; openComplaints: number; sentToGoogle: number };
  feedback: { jobId: string; jobNumber: string; customer: string; service: string; rating: number; comment: string | null; at: string | null; googleReviewClicked: boolean }[];
  complaints: { id: string; jobId: string; jobNumber: string; customer: string; category: string; severity: string; status: string; description: string; resolutionNotes: string | null; createdAt: string; resolvedAt: string | null }[];
  google: { reviewUrl: string; configured: boolean; rating?: number | null; total?: number; reviews?: { author: string; rating: number; text: string; when: string }[]; error?: string };
}

const CATEGORY: Record<string, string> = { missed_area: "Area not cleaned", quality: "Quality", damage: "Damage", staff_behavior: "Team conduct" };

const StarsRow = ({ n, size = "h-4 w-4" }: { n: number; size?: string }) => (
  <span className="inline-flex" aria-label={`${n} of 5 stars`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className={cn(size, i <= n ? "text-amber-400 fill-amber-400" : "text-zinc-300")} aria-hidden />
    ))}
  </span>
);

/** Admin → Reviews & Feedback: private ratings, customer issues, and Google — kept apart. */
export default function ReviewsPage() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(json?.error || "Couldn't load reviews.");
      else setData(json.data);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;
  const feedback = (data?.feedback ?? []).filter((f) => stars === null || f.rating === stars);

  return (
    <AdminLayout>
      <PageHeader title="Reviews & Feedback" description="Private ratings and comments from the customer page, customer issues, and your public Google reviews." />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data || !s ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-sm text-zinc-500">Average rating</div>
              <div className="text-3xl font-semibold text-zinc-950 mt-1">{s.average ?? "—"}<span className="text-lg text-amber-500">{s.average ? "★" : ""}</span></div>
              <div className="text-xs text-zinc-500">{s.ratings} rating{s.ratings === 1 ? "" : "s"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-sm text-zinc-500">With comments</div>
              <div className="text-3xl font-semibold text-zinc-950 mt-1">{data.feedback.filter((f) => f.comment).length}</div>
            </div>
            <div className={cn("rounded-2xl border bg-white p-4", s.openComplaints ? "border-red-200" : "border-zinc-200")}>
              <div className="text-sm text-zinc-500">Open complaints</div>
              <div className={cn("text-3xl font-semibold mt-1", s.openComplaints ? "text-red-700" : "text-zinc-950")}>{s.openComplaints}</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-sm text-zinc-500">Sent to Google</div>
              <div className="text-3xl font-semibold text-zinc-950 mt-1">{s.sentToGoogle}</div>
              <div className="text-xs text-zinc-500">customers opened the review link</div>
            </div>
          </div>

          <Tabs defaultValue="feedback" className="space-y-4">
            <TabsList>
              <TabsTrigger value="feedback">Private feedback</TabsTrigger>
              <TabsTrigger value="complaints">Complaints ({data.complaints.length})</TabsTrigger>
              <TabsTrigger value="google">Google reviews</TabsTrigger>
            </TabsList>

            <TabsContent value="feedback" className="space-y-4">
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by stars">
                {[null, 5, 4, 3, 2, 1].map((n) => (
                  <button key={String(n)} role="tab" aria-selected={stars === n} onClick={() => setStars(n)} className={cn("shrink-0 min-h-10 px-3.5 rounded-full border text-sm font-medium", stars === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>
                    {n === null ? "All" : `${n}★`} <span className={stars === n ? "text-zinc-300" : "text-zinc-400"}>{n === null ? s.ratings : s.distribution[String(n)] ?? 0}</span>
                  </button>
                ))}
              </div>
              {feedback.length === 0 ? (
                <EmptyState icon={ThumbsUp} title="No feedback yet" description="Customers rate the service on their QR page after approving it." />
              ) : (
                <ul className="space-y-3">
                  {feedback.map((f) => (
                    <li key={f.jobId} className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StarsRow n={f.rating} />
                        <span className="text-xs text-zinc-500">{f.at ? formatDate(f.at) : ""}</span>
                      </div>
                      {f.comment ? <p className="text-sm text-zinc-800 break-words">“{f.comment}”</p> : <p className="text-sm text-zinc-400">No comment</p>}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-700">{f.customer}</span>
                        <span>{f.service}</span>
                        <Link href={`/jobs/${f.jobId}`} className="font-mono text-rose-600 break-all">{f.jobNumber}</Link>
                        {f.googleReviewClicked && <span className="text-emerald-700 font-semibold">Opened Google review</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="complaints">
              {data.complaints.length === 0 ? (
                <EmptyState icon={MessageSquareWarning} title="No complaints" description="Issues customers report from their QR page appear here." />
              ) : (
                <ul className="space-y-3">
                  {data.complaints.map((c) => {
                    const open = !["resolved", "closed"].includes(c.status);
                    return (
                      <li key={c.id} className={cn("rounded-2xl border bg-white p-4 space-y-2", open ? "border-red-200" : "border-zinc-200")}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-zinc-900">{CATEGORY[c.category] ?? c.category}</span>
                          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", open ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800")}>{open ? "Open" : "Resolved"}</span>
                        </div>
                        <p className="text-sm text-zinc-800 break-words">{c.description}</p>
                        {c.resolutionNotes && <p className="text-sm text-zinc-600 break-words"><span className="font-semibold">Resolution:</span> {c.resolutionNotes}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                          <span className="font-semibold text-zinc-700">{c.customer}</span>
                          <span>{formatDate(c.createdAt)}</span>
                          <Link href={`/jobs/${c.jobId}`} className="font-mono text-rose-600 break-all">{c.jobNumber}</Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="google" className="space-y-4">
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">Google review status</h2>
                    <p className="text-sm text-zinc-500">{data.google.reviewUrl ? "Customers see a “Leave Google review” button after approving." : "No review link yet — add it in Settings → Customer portal."}</p>
                  </div>
                  {data.google.reviewUrl ? (
                    <a href={data.google.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
                      <ExternalLink className="h-4 w-4" aria-hidden /> Open review page
                    </a>
                  ) : (
                    <Link href="/settings#s-portal" className="inline-flex items-center h-11 px-4 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-800">Add link</Link>
                  )}
                </div>
                {data.google.configured && typeof data.google.rating === "number" && (
                  <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3">
                    <span className="text-3xl font-semibold text-zinc-950">{data.google.rating}</span>
                    <StarsRow n={Math.round(data.google.rating)} size="h-5 w-5" />
                    <span className="text-sm text-zinc-500">{data.google.total} Google reviews</span>
                  </div>
                )}
              </section>
              {!data.google.configured ? (
                <p className="text-sm text-zinc-500">To show your public Google reviews here, your developer can add the Google Places key and Place ID.</p>
              ) : data.google.error ? (
                <p role="alert" className="text-sm text-amber-800">{data.google.error}</p>
              ) : (data.google.reviews ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">No Google reviews yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.google.reviews!.map((r, i) => (
                    <li key={i} className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-zinc-900">{r.author}</span>
                        <span className="text-xs text-zinc-500">{r.when}</span>
                      </div>
                      <StarsRow n={r.rating} />
                      {r.text && <p className="text-sm text-zinc-800 break-words">{r.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </AdminLayout>
  );
}
