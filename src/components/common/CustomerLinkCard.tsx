"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link2, Copy, Check, Loader2, RefreshCw, Ban, QrCode, Share2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CustomerLinkCard — the ONE customer secure link, per job.
 *
 * The link is minted automatically when the job is created / quotation is
 * converted. The desk can copy it, share it (WhatsApp), show/download the QR,
 * regenerate it (old dies instantly), or revoke it. Informational actions
 * (copy/QR) never rotate the link.
 */

interface LinkState {
  linkUrl: string | null;
  tokenId: string | null;
  revoked: boolean;
}

export function CustomerLinkCard({ jobId, canManage }: { jobId: string; canManage: boolean }) {
  const [state, setState] = useState<LinkState>({ linkUrl: null, tokenId: null, revoked: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ dataUrl: string; linkUrl: string } | null>(null);

  const fetchLink = async () => {
    try {
      const res = await fetch("/api/qr-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", jobId }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setState({ linkUrl: json.data.linkUrl, tokenId: json.data.tokenId, revoked: false });
      } else if (res.status === 404) {
        setState({ linkUrl: null, tokenId: null, revoked: false });
      } else {
        setError(json?.error || "Could not load the customer link.");
      }
    } catch {
      setError("Network error while loading the customer link.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/qr-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } finally {
      setBusy(false);
    }
  };

  const handleRegen = async () => {
    const { status, json } = await act({ action: "regen", jobId });
    if (status === 201 && json?.success) {
      await navigator.clipboard.writeText(json.data.linkUrl).catch(() => {});
      setState({ linkUrl: json.data.linkUrl, tokenId: json.data.tokenId, revoked: false });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      setError(json?.error || "Regeneration failed.");
    }
  };

  const handleRevoke = async () => {
    if (!state.tokenId) return;
    const { status, json } = await act({ action: "revoke", tokenId: state.tokenId, reason: "Revoked from job file" });
    if (status === 200 && json?.success) {
      setState({ linkUrl: null, tokenId: null, revoked: true });
    } else {
      setError(json?.error || "Revoke failed.");
    }
  };

  const handleQr = async (download: boolean) => {
    if (!state.tokenId) return;
    const { status, json } = await act({ action: download ? "qr-download" : "qr", tokenId: state.tokenId });
    if (status === 200 && json?.success) {
      if (download) {
        const a = document.createElement("a");
        a.href = json.data.qrDataUrl;
        a.download = `qr-${jobId}-customer.png`;
        a.click();
      } else {
        setQrModal({ dataUrl: json.data.qrDataUrl, linkUrl: json.data.linkUrl });
      }
    } else {
      setError(json?.error || "QR generation failed.");
    }
  };

  if (loading) {
    return (
      <div className="mb-6 p-4 rounded-lg border border-indigo-200 bg-indigo-50/40 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading customer link…
      </div>
    );
  }

  if (!canManage) return null;

  return (
    <div className="mb-6 p-4 rounded-lg border border-indigo-200 bg-indigo-50/40 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-indigo-950 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-indigo-600" />
            Customer Secure Link
          </h3>
          <p className="text-[11px] text-indigo-800/80 mt-0.5">
            One link for the whole journey — confirm arrival, watch live progress, approve, rate &amp; Google review. Scan or share; regenerate kills the old link instantly.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{error}</p>
      )}

      {state.linkUrl ? (
        <div className="flex items-center gap-2 flex-wrap bg-white border border-indigo-200 rounded-md p-2">
          <input
            readOnly
            value={state.linkUrl}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-[200px] text-[11px] font-mono text-slate-700 bg-transparent outline-none"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(state.linkUrl!).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
            className="h-7 text-[11px] gap-1"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Intense Care: Track & approve your service here: ${state.linkUrl}`
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-emerald-700 hover:bg-emerald-50">
              <Share2 className="h-3 w-3" />
              Share
            </Button>
          </a>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleQr(false)} className="h-7 text-[11px] gap-1">
            <QrCode className="h-3 w-3" /> QR
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleQr(true)} className="h-7 text-[11px] gap-1">
            PNG
          </Button>
          <a href={state.linkUrl} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
              <ExternalLink className="h-3 w-3" /> Open
            </Button>
          </a>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={handleRegen}
            title="Replace this link — the old one stops working instantly"
            className="h-7 text-[11px] gap-1"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerate
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={handleRevoke} className="h-7 text-[11px] gap-1">
            <Ban className="h-3 w-3" /> Revoke
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-600">
            {state.revoked ? "Link revoked — no active customer link." : "No customer link yet."}
          </span>
          <Button size="sm" disabled={busy} onClick={handleRegen} className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {state.revoked ? "Issue New Link" : "Generate Link"}
          </Button>
        </div>
      )}

      {qrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQrModal(null)}>
          <div className="bg-white rounded-2xl p-6 space-y-3 text-center max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900">Scan to open the customer journey</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrModal.dataUrl} alt="Customer link QR" className="mx-auto rounded-xl border border-slate-200" />
            <p className="font-mono text-[10px] break-all text-slate-500">{qrModal.linkUrl}</p>
            <Button onClick={() => setQrModal(null)} variant="outline" className="w-full h-10 text-xs">
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
