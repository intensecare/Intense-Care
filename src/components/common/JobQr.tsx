"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Printer, Copy, Check, Share2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE job QR. It encodes only the job's ONE secure customer link
 * (APP_BASE_URL/customer/service/<random token>) — never a phone number,
 * GSTIN, customer id, invoice data or anything personal. The same QR works
 * for the whole job: arrival confirmation, progress, photos, QC result,
 * invoice, approval and feedback.
 */

/** Renders a QR as an <img>. Dark-on-white with a quiet zone, so phones scan it easily. */
export function QrImage({ value, size = 240, className, label = "QR code" }: { value: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 2, width: size * 2, color: { dark: "#111111", light: "#ffffff" } })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  if (!src) return <div className={cn("bg-zinc-100 rounded-xl animate-pulse", className)} style={{ width: size, height: size }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label} width={size} height={size} className={cn("bg-white rounded-xl", className)} style={{ width: size, height: size, imageRendering: "pixelated" }} />;
}

/** The job's single customer link (created on first use). Admin only — the API checks. */
export function useCustomerLink(jobId: string | null | undefined, enabled = true) {
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/qr-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", jobId }) })
      .then((r) => r.json().catch(() => null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success) setLinkUrl(json.data.linkUrl);
        else setError(json?.error || "Could not load the customer QR.");
      })
      .catch(() => !cancelled && setError("You're offline. Try again when connected."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [jobId, enabled]);
  return { linkUrl, loading, error };
}

/** "Scan QR to View Service" button → a large QR the customer scans with their phone camera. */
export function JobQrButton({
  jobId,
  jobNumber,
  customerName,
  className,
  variant = "outline",
  size = "default",
  compact = false,
}: {
  jobId: string;
  jobNumber?: string;
  customerName?: string;
  className?: string;
  variant?: "outline" | "default" | "secondary";
  size?: "default" | "sm" | "lg";
  /** Icon + "QR" — for job cards and table rows. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { linkUrl, loading, error } = useCustomerLink(jobId, open);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!linkUrl) return;
    await navigator.clipboard?.writeText(linkUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {compact ? (
        <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)} aria-label={`Scan QR to View Service${jobNumber ? ` — ${jobNumber}` : ""}`}>
          <QrCode className="h-4 w-4" aria-hidden /> QR
        </Button>
      ) : (
        <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
          <QrCode className="h-5 w-5" aria-hidden /> Scan QR to View Service
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan QR to View Service</DialogTitle>
            <DialogDescription>
              {customerName ? `${customerName} can scan` : "The customer can scan"} this with their phone camera — no app needed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2 qr-print-area">
            {loading || (!linkUrl && !error) ? (
              <div className="h-[240px] w-[240px] rounded-xl bg-zinc-100 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
            ) : error ? (
              <p role="alert" className="text-sm text-red-700">{error}</p>
            ) : (
              <QrImage value={linkUrl!} size={240} label={`QR code for job ${jobNumber ?? ""}`} className="border border-zinc-200" />
            )}
            {jobNumber && <div className="text-sm font-semibold text-zinc-900 font-mono break-all text-center">{jobNumber}</div>}
            <p className="text-xs text-zinc-500 text-center">One QR for the whole service — status, photos, quality check, invoice, approval and feedback.</p>
          </div>
          {linkUrl && (
            <DialogFooter>
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
              </Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`View your service: ${linkUrl}`)}`} target="_blank" rel="noreferrer" className="h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 inline-flex items-center justify-center gap-2">
                <Share2 className="h-4 w-4" /> WhatsApp
              </a>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
