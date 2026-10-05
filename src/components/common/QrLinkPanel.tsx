"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { QrCode, Copy, Check, Loader2, RefreshCw, Ban, Share2, Download, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * §35 — per-job QR & secure-link panel (embedded in the job file).
 *
 * Mint any of the 7 purpose tokens, then SHOW QR / COPY / SHARE / DOWNLOAD /
 * REGENERATE / REVOKE each one. Raw tokens are never stored server-side:
 * minting returns the link once, and reveal/QR re-mint the same purpose so
 * the desk can always re-share without weakening security.
 */

const PURPOSES = [
  { value: "CUSTOMER_JOB", label: "Customer Job" },
  { value: "CUSTOMER_VERIFICATION", label: "Customer Verification" },
  { value: "CUSTOMER_APPROVAL", label: "Customer Approval" },
  { value: "MANAGER_JOB", label: "Manager Job" },
  { value: "QC_INSPECTION", label: "QC Inspection" },
  { value: "REWORK", label: "Rework" },
  { value: "REINSPECTION", label: "Reinspection" },
] as const;

const PURPOSE_TONE: Record<string, string> = {
  CUSTOMER_JOB: "bg-sky-50 text-sky-700 border-sky-200",
  CUSTOMER_VERIFICATION: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CUSTOMER_APPROVAL: "bg-teal-50 text-teal-700 border-teal-200",
  MANAGER_JOB: "bg-indigo-50 text-indigo-700 border-indigo-200",
  QC_INSPECTION: "bg-purple-50 text-purple-700 border-purple-200",
  REWORK: "bg-red-50 text-red-700 border-red-200",
  REINSPECTION: "bg-orange-50 text-orange-700 border-orange-200",
};

interface TokenRow {
  id: string;
  purpose: string;
  purposeLabel: string;
  scope: string;
  jobId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export function QrLinkPanel({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mintPurpose, setMintPurpose] = useState<string>("CUSTOMER_JOB");
  const [mintBusy, setMintBusy] = useState(false);
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrModal, setQrModal] = useState<{ dataUrl: string; linkUrl: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/qr-links");
      const json = await res.json();
      if (json?.success) {
        setRows((json.data.tokens as TokenRow[]).filter((t) => t.jobId === jobId));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const act = async (body: Record<string, unknown>, id: string) => {
    setBusyId(id);
    try {
      const res = await fetch("/api/qr-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    } finally {
      setBusyId(null);
    }
  };

  const handleMint = async () => {
    setMintBusy(true);
    setMintedLink(null);
    setCopied(false);
    try {
      const res = await fetch("/api/qr-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mint", jobId, purpose: mintPurpose }),
      });
      const json = await res.json();
      if (json?.success) {
        setMintedLink(json.data.linkUrl);
        showToast("Link minted — copy it below (revealed once).");
        void load();
      } else {
        showToast(json?.error || "Mint failed.");
      }
    } finally {
      setMintBusy(false);
    }
  };

  const handleReveal = async (row: TokenRow) => {
    const json = await act({ action: "reveal", tokenId: row.id }, row.id);
    if (json?.success) {
      await navigator.clipboard.writeText(json.data.linkUrl).catch(() => {});
      showToast("Fresh link copied to clipboard.");
    } else showToast(json?.error || "Reveal failed.");
  };

  const handleQr = async (row: TokenRow, download: boolean) => {
    const json = await act({ action: download ? "qr-download" : "qr", tokenId: row.id }, row.id);
    if (json?.success) {
      if (download) {
        const a = document.createElement("a");
        a.href = json.data.qrDataUrl;
        a.download = `qr-${jobId}-${row.purpose.toLowerCase()}.png`;
        a.click();
        showToast("QR PNG downloaded.");
      } else {
        setQrModal({ dataUrl: json.data.qrDataUrl, linkUrl: json.data.linkUrl });
      }
    } else showToast(json?.error || "QR generation failed.");
  };

  const handleRegenerate = async (row: TokenRow) => {
    await act({ action: "revoke", tokenId: row.id, reason: "Regenerated" }, row.id);
    const json = await act({ action: "mint", jobId, purpose: row.purpose }, row.id);
    if (json?.success) {
      await navigator.clipboard.writeText(json.data.linkUrl).catch(() => {});
      showToast("Old link revoked — new link copied.");
      void load();
    } else showToast(json?.error || "Regeneration failed.");
  };

  const handleRevoke = async (row: TokenRow) => {
    const json = await act({ action: "revoke", tokenId: row.id, reason: "Revoked from job file" }, row.id);
    if (json?.success) {
      showToast("Token revoked — link dead immediately.");
      void load();
    } else showToast(json?.error || "Revoke failed.");
  };

  return (
    <div className="mb-6 p-4 rounded-lg border border-indigo-200 bg-indigo-50/40 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-indigo-950 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            QR & Secure Links
          </h3>
          <p className="text-[11px] text-indigo-800/80 mt-0.5">
            Dynamic tokens for this job — hashed, expiring, revocable. Share via QR scan or link; revoke kills access instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mintPurpose}
            onChange={(e) => setMintPurpose(e.target.value)}
            className="h-9 rounded-md border border-indigo-200 px-2 text-xs bg-white"
          >
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleMint} disabled={mintBusy} className="h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
            {mintBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
            Mint Secure Link
          </Button>
        </div>
      </div>

      {mintedLink && (
        <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-md p-2">
          <input readOnly value={mintedLink} onFocus={(e) => e.target.select()} className="flex-1 text-[11px] font-mono text-slate-700 bg-transparent outline-none" />
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(mintedLink).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
            className="h-7 text-[11px] gap-1"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(mintedLink)}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-emerald-700 hover:bg-emerald-50">
              <Share2 className="h-3 w-3" />
              Share
            </Button>
          </a>
        </div>
      )}

      {toast && <p className="text-[11px] text-indigo-800 bg-indigo-100/60 border border-indigo-200 rounded px-2.5 py-1.5">{toast}</p>}

      {loading ? (
        <p className="text-[11px] text-slate-400">Loading tokens…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">No secure links minted for this job yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const dead = !!row.revokedAt;
            const expired = row.expiresAt && new Date(row.expiresAt) < new Date();
            const busy = busyId === row.id;
            return (
              <div key={row.id} className={cn("flex items-center gap-2 flex-wrap bg-white border rounded-md px-2.5 py-1.5", dead ? "border-slate-200 opacity-70" : "border-indigo-100")}>
                <span className={cn("inline-block px-2 py-0.5 rounded border text-[10px] font-bold", PURPOSE_TONE[row.purpose] || "bg-slate-50 text-slate-600 border-slate-200")}>
                  {row.purposeLabel}
                </span>
                <span className={cn("text-[10px] font-semibold", dead ? "text-red-600" : expired ? "text-amber-600" : "text-emerald-600")}>
                  {dead ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE"}
                </span>
                <span className="text-[10px] text-slate-400">
                  {row.usageCount} scan{row.usageCount === 1 ? "" : "s"}
                  {row.lastUsedAt ? ` · last ${new Date(row.lastUsedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                  {row.expiresAt ? ` · expires ${new Date(row.expiresAt).toLocaleDateString()}` : " · until revoked"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={busy || dead} onClick={() => handleQr(row, false)} className="h-7 text-[10px] px-2">
                    <QrCode className="h-3 w-3 mr-0.5" /> QR
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy || dead} onClick={() => handleReveal(row)} className="h-7 text-[10px] px-2">
                    <Copy className="h-3 w-3 mr-0.5" /> LINK
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy || dead} onClick={() => handleQr(row, true)} className="h-7 text-[10px] px-2">
                    <Download className="h-3 w-3 mr-0.5" /> PNG
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => handleRegenerate(row)} className="h-7 text-[10px] px-2">
                    <RefreshCw className="h-3 w-3 mr-0.5" /> REGEN
                  </Button>
                  <Button variant="destructive" size="sm" disabled={busy || dead} onClick={() => handleRevoke(row)} className="h-7 text-[10px] px-2">
                    <Ban className="h-3 w-3 mr-0.5" /> REVOKE
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {qrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQrModal(null)}>
          <div className="bg-white rounded-2xl p-6 space-y-3 text-center max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900">Scan to open the secure workflow</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrModal.dataUrl} alt="QR code" className="mx-auto rounded-xl border border-slate-200" />
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
