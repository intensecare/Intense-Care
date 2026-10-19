"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryPhoto {
  id: string;
  /** Full-size image. */
  url: string;
  /** Small version for the grid (falls back to `url`). */
  thumbUrl?: string;
  area: string;
  photoType: string;
  caption?: string | null;
  uploadedAt?: string | null;
}

const TYPE_LABEL: Record<string, string> = { before: "Before photos", after: "After photos", qc: "QC photos", rework: "Rework photos" };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Thumbnail that says so when it can't load, with a retry — never a silent blank box. */
function Thumb({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(0);
  const url = failed ? `${src}${src.includes("?") ? "&" : "?"}r=${failed}` : src;
  return (
    <button type="button" onClick={onOpen} className="relative block w-full aspect-square rounded-xl overflow-hidden bg-zinc-100 border border-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500" aria-label={`Open photo: ${alt}`}>
      {failed > 1 ? (
        <span className="h-full w-full flex flex-col items-center justify-center gap-1 text-xs text-zinc-500 p-1"><ImageOff className="h-5 w-5" aria-hidden />Tap to retry</span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed((n) => n + 1)} />
      )}
    </button>
  );
}

/**
 * Photos grouped into sections (Before / After …) as a thumbnail grid. Tap a thumbnail to open the full-size viewer
 * with zoom, previous / next (buttons, arrow keys, swipe) and close (button, Esc).
 */
export function PhotoGallery({ photos, order = ["before", "after"], empty }: { photos: GalleryPhoto[]; order?: string[]; empty?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const groups = order.map((t) => ({ type: t, items: photos.filter((p) => p.photoType === t) })).filter((g) => g.items.length);
  // One flat, ordered list so the viewer can step through everything.
  const flat = groups.flatMap((g) => g.items);
  if (!flat.length) return <p className="py-3 text-base text-zinc-500">{empty ?? "Photos appear here once the work is done."}</p>;
  return (
    <div className="space-y-5 pt-1">
      {groups.map((g) => (
        <section key={g.type} aria-label={TYPE_LABEL[g.type] ?? g.type}>
          <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wide mb-2">{TYPE_LABEL[g.type] ?? g.type} <span className="text-zinc-400 font-medium normal-case">({g.items.length})</span></h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {g.items.map((p) => (
              <div key={p.id} className="min-w-0">
                <Thumb src={p.thumbUrl ?? p.url} alt={`${p.area} ${p.photoType}`} onOpen={() => setOpen(flat.indexOf(p))} />
                <div className="mt-1 text-xs text-zinc-600 truncate">{p.area}</div>
                {p.uploadedAt && <div className="text-[11px] text-zinc-400">{when(p.uploadedAt)}</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
      {open !== null && <Lightbox photos={flat} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const p = photos[index];
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; start: { x: number; y: number }; pos: { x: number; y: number }; moved: boolean } | null>(null);
  const swipe = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const reset = useCallback(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, []);
  const go = useCallback((d: number) => onIndex((index + d + photos.length) % photos.length), [index, photos.length, onIndex]);
  const zoom = useCallback((f: number) => {
    setScale((s) => {
      const n = Math.min(5, Math.max(1, s * f));
      if (n === 1) setPos({ x: 0, y: 0 });
      return n;
    });
  }, []);

  useEffect(() => {
    reset();
    setState("loading");
    setAttempt(0);
  }, [index, reset]);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") zoom(1.4);
      else if (e.key === "-") zoom(1 / 1.4);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose, reset, zoom]);

  const down = (e: React.PointerEvent) => {
    // Buttons inside the viewer (previous / next) keep their own clicks: don't capture the pointer away from them.
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    swipe.current = pointers.current.size === 1 ? e.clientX : null;
    const pts = Array.from(pointers.current.values());
    gesture.current = { dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, scale, start: { x: e.clientX, y: e.clientY }, pos, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    const g = gesture.current;
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setScale(Math.min(5, Math.max(1, g.scale * (d / g.dist))));
      g.moved = true;
    } else if (pts.length === 1 && scale > 1) {
      setPos({ x: g.pos.x + e.clientX - g.start.x, y: g.pos.y + e.clientY - g.start.y });
      g.moved = true;
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    // A horizontal swipe on an un-zoomed photo flips to the next / previous one.
    if (swipe.current !== null && scale === 1 && pointers.current.size === 0) {
      const dx = e.clientX - swipe.current;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    }
    swipe.current = null;
    if (pointers.current.size === 0 && scale < 1.05) reset();
  };

  const src = attempt ? `${p.url}${p.url.includes("?") ? "&" : "?"}r=${attempt}` : p.url;
  const label = `${p.area} · ${p.photoType === "before" ? "Before" : p.photoType === "after" ? "After" : p.photoType}`;
  const btn = "h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return (
    <div role="dialog" aria-modal="true" aria-label={`Photo viewer — ${label}`} className="fixed inset-0 z-[100] bg-black/95 flex flex-col select-none">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-white">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{label}</div>
          <div className="text-xs text-white/70">{index + 1} of {photos.length}{p.uploadedAt ? ` · ${when(p.uploadedAt)}` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => zoom(1 / 1.4)} aria-label="Zoom out" disabled={scale <= 1}><Minus className="h-5 w-5" aria-hidden /></button>
          <button type="button" className={btn} onClick={() => zoom(1.4)} aria-label="Zoom in" disabled={scale >= 5}><Plus className="h-5 w-5" aria-hidden /></button>
          <button type="button" className={cn(btn, scale === 1 && "opacity-40")} onClick={reset} aria-label="Reset zoom"><RotateCcw className="h-5 w-5" aria-hidden /></button>
          <button ref={closeRef} type="button" className={btn} onClick={onClose} aria-label="Close viewer"><X className="h-6 w-6" aria-hidden /></button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => (scale > 1 ? reset() : setScale(2.5))} onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}>
        {state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <ImageOff className="h-10 w-10" aria-hidden />
            <p className="text-base">This photo couldn&apos;t be loaded.</p>
            <button type="button" className="h-11 px-5 rounded-xl bg-white text-zinc-900 font-semibold" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }}>Try again</button>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={`${p.id}-${attempt}`}
            src={src}
            alt={label}
            draggable={false}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain will-change-transform"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: gesture.current?.moved ? "none" : "transform 120ms" }}
          />
        )}
        {state === "loading" && <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm pointer-events-none">Loading photo…</div>}
        {photos.length > 1 && (
          <>
            <button type="button" className={cn(btn, "absolute left-2 top-1/2 -translate-y-1/2")} onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft className="h-6 w-6" aria-hidden /></button>
            <button type="button" className={cn(btn, "absolute right-2 top-1/2 -translate-y-1/2")} onClick={() => go(1)} aria-label="Next photo"><ChevronRight className="h-6 w-6" aria-hidden /></button>
          </>
        )}
      </div>
      {p.caption && <div className="px-4 py-3 text-sm text-white bg-black/60">{p.caption}</div>}
    </div>
  );
}
