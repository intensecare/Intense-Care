"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QrCode,
  Copy,
  Share2,
  Download,
  RefreshCw,
  Ban,
  Plus,
  Loader2,
  Search,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils";

/**
 * §35 — ADMIN → QR & SECURE LINKS.
 *
 * One table over every dynamic token: Type / Job / Purpose / Created /
 * Expires / Status / Last Used / Actions with [SHOW QR] [COPY LINK] [SHARE]
 * [DOWNLOAD] [REGENERATE] [REVOKE]. Regenerate revokes the old row and mints
 * a fresh token (old link dies instantly). Reveal/QR re-mint the same purpose
 * so raw tokens are never stored server-side.
 */

interface TokenRow {
  id: string;
  purpose: string;
  purposeLabel: string;
  scope: string;
  jobId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdByName: string;
  createdAt: string;
  job: { id: string; status: string; scheduledDate: string; customerName: string | null; propertyTitle: string | null; serviceName: string | null } | null;
}

interface PurseOption {
  value: string;
  label: string;
}

const PURPOSE_TONE: Record<string, string> = {
  CUSTOMER_JOB: "bg-sky-50 text-sky-700 border-sky-200",
  CUSTOMER_VERIFICATION: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CUSTOMER_APPROVAL: "bg-teal-50 text-teal-700 border-teal-200",
  MANAGER_JOB: "bg-indigo-50 text-indigo-700 border-indigo-200",
  QC_INSPECTION: "bg-purple-50 text-purple-700 border-purple-200",
  REWORK: "bg-red-50 text-red-700 border-red-200",
  REINSPECTION: "bg-orange-50 text-orange-700 border-orange-200",
};

export default function QrLinksPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [purposes, setPurposes] = useState<PurseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ dataUrl: string; linkUrl: string } | null>(null);

  // mint form
  const [mintJobId, setMintJobId] = useState("");
  const [mintPurpose, setMintPurpose] = useState("CUSTOMER_JOB");
  const [mintBusy, setMintBusy] = useState(false);
  const [mintResult, setMintResult] = useState<{ linkUrl: string; shortUrl: string; expiresAt: string | null } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/qr-links");
      const json = await res.json();
      if (json?.success) {
        setTokens(json.data.tokens);
        setPurposes(json.data.purposes);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };

  const act = async (body: Record<string, unknown>, tokenId: string) => {
    setBusyId(tokenId);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.jobId.toLowerCase().includes(q) ||
        t.purposeLabel.toLowerCase().includes(q) ||
        (t.job?.customerName || "").toLowerCase().includes(q) ||
        (t.job?.propertyTitle || "").toLowerCase().includes(q)
    );
  }, [tokens, search]);

  const handleMint = async () => {
    if (!mintJobId.trim()) {
      showToast("Enter a job ID to mint a token for.");
      return;
    }
    setMintBusy(true);
    const json = await act({ action: "mint", jobId: mintJobId.trim(), purpose: mintPurpose }, "mint");
    setMintBusy(false);
    if (json?.success) {
      setMintResult({ linkUrl: json.data.linkUrl, shortUrl: json.data.shortUrl, expiresAt: json.data.expiresAt });
      showToast("Token minted — link revealed once below.");
      void load();
    } else {
      showToast(json?.error || "Mint failed.");
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
        a.download = `qr-${row.jobId}-${row.purpose.toLowerCase()}.png`;
        a.click();
        showToast("QR PNG downloaded.");
      } else {
        setQrModal({ dataUrl: json.data.qrDataUrl, linkUrl: json.data.linkUrl });
      }
    } else showToast(json?.error || "QR generation failed.");
  };

  const handleRegenerate = async (row: TokenRow) => {
    // Revoke old + mint fresh in one action.
    await act({ action: "revoke", tokenId: row.id, reason: "Regenerated" }, row.id);
    const json = await act({ action: "mint", jobId: row.jobId, purpose: row.purpose }, row.id);
    if (json?.success) {
      await navigator.clipboard.writeText(json.data.linkUrl).catch(() => {});
      showToast("Old link revoked — new link copied to clipboard.");
      void load();
    } else showToast(json?.error || "Regeneration failed.");
  };

  const handleRevoke = async (row: TokenRow) => {
    const json = await act({ action: "revoke", tokenId: row.id, reason: "Revoked from QR manager" }, row.id);
    if (json?.success) {
      showToast("Token revoked — the link stops working immediately.");
      void load();
    } else showToast(json?.error || "Revoke failed.");
  };

  const statusOf = (row: TokenRow) => {
    if (row.revokedAt) return { label: "Revoked", cls: "bg-red-50 text-red-700 border-red-200" };
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { label: "Expired", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    return { label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  };

  return (
    <AdminLayout>
      <PageHeader
        title="QR & Secure Links"
        description="Centralized dynamic QR tokens — every link is hashed, expiring, revocable, and audited."
      />

      {toast && <div className="mx-6 mb-2 p-3 rounded-xl bg-slate-900 text-white text-xs font-semibold">{toast}</div>}

      {/* Mint form */}
      <div className="mx-6 mb-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Plus className="h-4 w-4 text-rose-600" /> Mint a new secure link
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <Input value={mintJobId} onChange={(e) => setMintJobId(e.target.value)} placeholder="Job ID (e.g. cmux…)" className="h-10 text-xs" />
          <select value={mintPurpose} onChange={(e) => setMintPurpose(e.target.value)} className="h-10 rounded-md border border-slate-200 px-2 text-xs bg-white">
            {purposes.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Button onClick={handleMint} disabled={mintBusy} className="h-10 bg-rose-500 hover:bg-rose-600 text-white text-xs">
            {mintBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mint token"}
          </Button>
        </div>
        {mintResult && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1">
            <p className="font-semibold text-emerald-900">Link (revealed once — copy now):</p>
            <p className="font-mono text-[11px] break-all text-emerald-800">{mintResult.linkUrl}</p>
            <p className="text-[10px] text-emerald-700">
              Short QR URL: {mintResult.shortUrl} {mintResult.expiresAt ? `· expires ${formatDateTime(mintResult.expiresAt)}` : "· valid until inspection completes"}
            </p>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="mx-6 mb-3 relative">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by job, customer, property or purpose…" className="pl-9 h-10 text-xs" />
      </div>

      {/* Table */}
      <div className="mx-6 mb-10 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Used</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    <ShieldCheck className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                    No tokens yet. Mint one above, or they appear automatically as jobs move through the journey.
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const status = statusOf(row);
                const busy = busyId === row.id;
                return (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className={cn("inline-block px-2 py-0.5 rounded border text-[10px] font-bold", PURPOSE_TONE[row.purpose] || "bg-slate-50 text-slate-600 border-slate-200")}>
                        {row.purposeLabel}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-1">scope: /{row.scope}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[10px] font-semibold text-slate-800">{row.jobId}</div>
                      <div className="text-[10px] text-slate-500">{row.job?.customerName ?? "—"} · {row.job?.serviceName ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.expiresAt ? formatDateTime(row.expiresAt) : "Until revoked"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold", status.cls)}>{status.label}</span>
                      {row.usageCount > 0 && <div className="text-[10px] text-slate-400 mt-1">{row.usageCount} scans</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.lastUsedAt ? formatDateTime(row.lastUsedAt) : "Never"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button variant="outline" size="sm" disabled={busy || !!row.revokedAt} onClick={() => handleQr(row, false)} className="h-8 text-[10px] px-2">
                          <QrCode className="h-3 w-3 mr-1" /> SHOW QR
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy || !!row.revokedAt} onClick={() => handleReveal(row)} className="h-8 text-[10px] px-2">
                          <Copy className="h-3 w-3 mr-1" /> COPY LINK
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || !!row.revokedAt}
                          onClick={async () => {
                            const json = await act({ action: "reveal", tokenId: row.id }, row.id);
                            if (json?.success) window.open(`https://wa.me/?text=${encodeURIComponent(json.data.linkUrl)}`, "_blank");
                            else showToast(json?.error || "Share failed.");
                          }}
                          className="h-8 text-[10px] px-2"
                        >
                          <Share2 className="h-3 w-3 mr-1" /> SHARE
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy || !!row.revokedAt} onClick={() => handleQr(row, true)} className="h-8 text-[10px] px-2">
                          <Download className="h-3 w-3 mr-1" /> DOWNLOAD
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => handleRegenerate(row)} className="h-8 text-[10px] px-2">
                          <RefreshCw className="h-3 w-3 mr-1" /> REGENERATE
                        </Button>
                        <Button variant="destructive" size="sm" disabled={busy || !!row.revokedAt} onClick={() => handleRevoke(row)} className="h-8 text-[10px] px-2">
                          <Ban className="h-3 w-3 mr-1" /> REVOKE
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR modal */}
      {qrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQrModal(null)}>
          <div className="bg-white rounded-2xl p-6 space-y-3 text-center max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900 flex items-center justify-center gap-2">
              <QrCode className="h-4 w-4 text-rose-600" /> Scan to open the secure workflow
            </h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrModal.dataUrl} alt="QR code" className="mx-auto rounded-xl border border-slate-200" />
            <p className="font-mono text-[10px] break-all text-slate-500">{qrModal.linkUrl}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setQrModal(null)} className="flex-1 h-10 text-xs">
                Close
              </Button>
              <Button
                onClick={() => window.open(qrModal.linkUrl, "_blank")}
                className="flex-1 h-10 text-xs bg-rose-500 hover:bg-rose-600 text-white"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open link
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
