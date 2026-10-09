"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** The secure token inside a scanned customer QR (…/customer/service/<token>). */
export function tokenFromQr(text: string): string | null {
  const t = text.trim();
  const m = /\/customer\/(?:service|job)\/([A-Za-z0-9_-]{16,200})/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{32,200}$/.test(t) ? t : null;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Camera QR scanner in a sheet. Uses the phone's built-in barcode detector
 * when available, otherwise decodes frames with jsQR. Calls `onToken` with
 * the secure token only — the server decides whether it matches the job.
 */
export function QrScanner({ open, onClose, onToken, title = "Scan QR to Verify Location", description = "Point the camera at the customer's QR code." }: { open: boolean; onClose: () => void; onToken: (token: string) => void; title?: string; description?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;
    setError(null);
    setStarting(true);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch {
        setStarting(false);
        setError("Camera not available. Allow camera access in your browser settings, then try again.");
        return;
      }
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setStarting(false);

      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector: Detector | null = BD ? new BD({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async (now: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (now - last < 200 || !video.current || video.current.readyState < 2) return;
        last = now;
        let text: string | null = null;
        if (detector) {
          const found = await detector.detect(video.current).catch(() => []);
          text = found[0]?.rawValue ?? null;
        } else if (jsQR && canvas.current) {
          const v = video.current;
          const c = canvas.current;
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          text = jsQR(img.data, img.width, img.height)?.data ?? null;
        }
        if (text) {
          const token = tokenFromQr(text);
          if (token) {
            stopped = true;
            onToken(token);
          } else setError("That QR isn't an Intense Care service QR. Scan the customer's QR for this job.");
        }
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // onToken is stable for the life of one open sheet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-zinc-900">
          <video ref={video} className="h-full w-full object-cover" playsInline muted aria-label="Camera view" />
          <div aria-hidden className="absolute inset-[18%] rounded-2xl border-4 border-white/80" />
          {starting && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Starting camera…</div>
          )}
          {error && !starting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm gap-2 p-6 text-center"><Camera className="h-8 w-8" aria-hidden />{error}</div>
          )}
        </div>
        {error && !starting && <p role="alert" className="text-sm text-red-700 text-center">{error}</p>}
        <canvas ref={canvas} className="hidden" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
