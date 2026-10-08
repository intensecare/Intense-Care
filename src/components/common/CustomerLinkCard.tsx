"use client";

import React, { useEffect, useState } from "react";
import { Link2, Copy, Check, Loader2, RefreshCw, Ban, Share2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { QrImage } from "./JobQr";

/**
 * The customer's ONE secure service link — and its QR — for this job, valid
 * for the whole job (arrival confirmation, progress, photos, QC result,
 * invoice, approval, rating). Admin can copy, share, replace (the old link
 * and QR stop working) or turn it off. The QR holds only the random link.
 */
export function CustomerLinkCard({ jobId, highlight }: { jobId: string; highlight?: boolean }) {
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch("/api/qr-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  useEffect(() => {
    let cancelled = false;
    void call({ action: "get", jobId })
      .then(({ status, json }) => {
        if (cancelled) return;
        if (json?.success) {
          setLinkUrl(json.data.linkUrl);
          setTokenId(json.data.tokenId ?? null);
        } else if (status !== 404) setError(json?.error || "Could not load the customer link.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const copy = async () => {
    if (!linkUrl) return;
    await navigator.clipboard?.writeText(linkUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regen = async () => {
    setBusy(true);
    const { json } = await call({ action: "regen", jobId });
    setBusy(false);
    if (json?.success) {
      setLinkUrl(json.data.linkUrl);
      setTokenId(json.data.tokenId ?? null);
    } else setError(json?.error || "Could not create a new link.");
  };

  const revoke = async () => {
    if (!tokenId) return;
    setBusy(true);
    const { json } = await call({ action: "revoke", tokenId, reason: "Turned off from the job page" });
    setBusy(false);
    if (json?.success) {
      setLinkUrl(null);
      setTokenId(null);
    } else setError(json?.error || "Could not turn the link off.");
  };

  return (
    <section className={cn("rounded-2xl border bg-white p-5 shadow-sm space-y-3", highlight ? "border-rose-300 ring-2 ring-rose-100" : "border-zinc-200")}>
      <div className="flex items-center gap-2">
        <Link2 className="h-5 w-5 text-rose-500" />
        <h2 className="text-base font-semibold text-zinc-900">Scan QR to View Service</h2>
      </div>
      <p className="text-sm text-zinc-500">One QR and link for the whole job — the customer confirms the team, follows progress, sees photos and the invoice, and approves here.</p>
      {loading ? (
        <div className="text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : linkUrl ? (
        <>
          <div className="flex justify-center"><QrImage value={linkUrl} size={176} label="QR code — scan to view this service" className="border border-zinc-200" /></div>
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-700 break-all">{linkUrl}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void copy()} className="h-10 px-4 rounded-xl bg-zinc-900 text-white text-sm font-semibold inline-flex items-center gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(linkUrl)}`} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 inline-flex items-center gap-2">
              <Share2 className="h-4 w-4" /> Share
            </a>
            <a href={linkUrl} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 inline-flex items-center gap-2">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
            <button disabled={busy} onClick={() => void regen()} className="h-10 px-3 rounded-xl text-sm text-zinc-500 inline-flex items-center gap-1.5 hover:bg-zinc-50" title="Replace — the old link and QR stop working">
              <RefreshCw className="h-4 w-4" /> Replace
            </button>
            <button disabled={busy} onClick={() => void revoke()} className="h-10 px-3 rounded-xl text-sm text-red-600 inline-flex items-center gap-1.5 hover:bg-red-50">
              <Ban className="h-4 w-4" /> Turn off
            </button>
          </div>
        </>
      ) : (
        <button disabled={busy} onClick={() => void regen()} className="h-10 px-4 rounded-xl bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create customer QR
        </button>
      )}
      {error && <div className="text-sm text-red-700">{error}</div>}
    </section>
  );
}
