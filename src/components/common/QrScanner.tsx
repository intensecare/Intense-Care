"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/**
 * §2 QR VERIFICATION — scanning the job QR when GPS cannot be trusted.
 *
 * Dependency-free, with three routes in order of convenience, because a field
 * phone in a basement is exactly where a fragile scanner is least welcome:
 *
 *   1. Live camera scan via the browser BarcodeDetector (Android Chrome).
 *   2. A photo of the QR, decoded from the still image by the same detector.
 *   3. Pasting the link itself, which is what the QR contains anyway.
 *
 * What comes out is the raw token from the link. It is handed straight to the
 * server, which decides whether it belongs to this job — the scan alone
 * proves nothing until the backend says so.
 */

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

function detectorCtor(): DetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/**
 * Pulls the token out of whatever the QR contained. The QR encodes the secure
 * link (`.../customer/service/<token>`), but a pasted bare token is accepted
 * too so a phone that cannot scan is never a dead end.
 */
export function extractToken(scanned: string): string | null {
  const text = scanned.trim();
  if (!text) return null;
  const fromPath = /\/customer\/(?:service|job)\/([A-Za-z0-9_-]{16,})/.exec(text);
  if (fromPath) return fromPath[1];
  // A bare token: URL-safe base64, no scheme, no spaces.
  if (/^[A-Za-z0-9_-]{16,200}$/.test(text)) return text;
  return null;
}

export function QrScanner({
  onToken,
  onCancel,
  busy,
  title = "Scan the job QR",
  description = "Ask the customer to show the QR for this service, or scan the QR on the property.",
}: {
  onToken: (token: string) => void;
  onCancel?: () => void;
  busy?: boolean;
  title?: string;
  description?: string;
}) {
  const [mode, setMode] = useState<"idle" | "camera" | "manual">("idle");
  const [error, setError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [pasted, setPasted] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const supported = detectorCtor() !== null;

  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const accept = useCallback(
    (raw: string) => {
      const token = extractToken(raw);
      if (!token) {
        setError("That QR is not a service link for this system. Scan the QR on the customer link.");
        return false;
      }
      stop();
      setMode("idle");
      setError(null);
      onToken(token);
      return true;
    },
    [onToken, stop]
  );

  const startCamera = async () => {
    setError(null);
    const Ctor = detectorCtor();
    if (!Ctor) {
      setMode("manual");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      setMode("camera");
      // The element mounts with the mode change, so wait a frame for the ref.
      requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const detector = new Ctor({ formats: ["qr_code"] });
        const tick = async () => {
          if (!videoRef.current || !streamRef.current) return;
          try {
            const hits = await detector.detect(videoRef.current);
            if (hits.length > 0 && hits[0].rawValue) {
              if (accept(hits[0].rawValue)) return;
            }
          } catch {
            /* a single failed frame is normal — keep looking */
          }
          loopRef.current = requestAnimationFrame(() => void tick());
        };
        void tick();
      });
    } catch {
      setError("We could not open the camera. Take a photo of the QR instead, or paste the link.");
      setMode("manual");
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const Ctor = detectorCtor();
    if (!Ctor) {
      setError("This phone cannot read QR images. Paste the service link instead.");
      setMode("manual");
      return;
    }
    setDecoding(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const hits = await new Ctor({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close?.();
      if (hits.length === 0 || !hits[0].rawValue) {
        setError("No QR found in that photo. Hold the phone steady and fill the frame with the QR.");
      } else {
        accept(hits[0].rawValue);
      }
    } catch {
      setError("We could not read that photo. Paste the service link instead.");
    } finally {
      setDecoding(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFilePicked}
        aria-hidden
        tabIndex={-1}
      />

      <div className="flex items-start gap-3">
        <QrCode className="h-5 w-5 text-zinc-700 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
          <p className="text-sm text-zinc-600">{description}</p>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {mode === "camera" && (
        <div className="relative rounded-xl overflow-hidden bg-black">
          <video ref={videoRef} className="w-full h-64 object-cover" muted playsInline aria-label="Camera preview" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-40 w-40 rounded-2xl border-4 border-white/80" />
          </div>
          <button
            type="button"
            onClick={() => {
              stop();
              setMode("idle");
            }}
            className="absolute right-2 top-2 h-9 w-9 rounded-lg bg-black/60 text-white flex items-center justify-center"
            aria-label="Stop scanning"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <p className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-xs px-3 py-2 text-center">
            Point the camera at the QR
          </p>
        </div>
      )}

      {mode !== "camera" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {supported && (
            <Button type="button" onClick={() => void startCamera()} disabled={busy}>
              <Camera className="h-4 w-4" aria-hidden /> SCAN WITH CAMERA
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy || decoding}
            className={cn(!supported && "sm:col-span-2")}
          >
            {decoding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImageIcon className="h-4 w-4" aria-hidden />}
            PHOTO OF THE QR
          </Button>
        </div>
      )}

      {mode === "manual" || !supported ? (
        <div className="space-y-2 pt-1">
          <Field label="Or paste the service link" hint="The link behind the QR works just as well.">
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="https://…/customer/service/…"
              autoComplete="off"
              inputMode="url"
            />
          </Field>
          <Button type="button" variant="secondary" onClick={() => accept(pasted)} disabled={busy || !pasted.trim()}>
            USE THIS LINK
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setMode("manual")}
          className="text-sm font-medium text-rose-600 underline-offset-4 hover:underline"
        >
          Paste the link instead
        </button>
      )}

      {onCancel && (
        <Button type="button" variant="ghost" className="w-full" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      )}
    </section>
  );
}
