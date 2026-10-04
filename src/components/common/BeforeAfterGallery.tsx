"use client";

import React, { useState } from "react";
import { JobPhoto } from "@/lib/types";
import { formatDateTime, cn } from "@/lib/utils";
import { Image as ImageIcon, Clock, Layers, MoveHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

import { ImageLightboxModal } from "@/components/common/ImageLightboxModal";

interface BeforeAfterGalleryProps {
  photos: JobPhoto[];
  title?: string;
  allowUpload?: boolean;
  onUploadClick?: () => void;
}

/* §7 canonical areas — every photo is grouped under one of these six rooms,
 * wherever the field app tagged it (e.g. "Kitchen Gas Hob & Granite" → Kitchen). */
const CANONICAL_AREAS = ["Living Room", "Bedroom", "Kitchen", "Bathroom", "Balcony", "Other"] as const;

function canonicalArea(area: string): (typeof CANONICAL_AREAS)[number] {
  const a = (area || "").toLowerCase();
  if (/balcon|terrace/.test(a)) return "Balcony";
  if (/kitchen|chimney|hob/.test(a)) return "Kitchen";
  if (/bath|toilet|shower|washroom/.test(a)) return "Bathroom";
  if (/bed|wardrobe/.test(a)) return "Bedroom";
  if (/living|hall|lounge|drawing|dining/.test(a)) return "Living Room";
  return "Other";
}

/* ------------------------------------------------------------------ */
/* §7 Interactive Before ↔ After slider — drag (or swipe) the divider  */
/* to reveal the transformation; works with mouse, touch and keyboard. */
/* ------------------------------------------------------------------ */
function BeforeAfterSlider({ beforeUrl, afterUrl, area }: { beforeUrl: string; afterUrl: string; area: string }) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const [pos, setPos] = useState(50);

  const setFromClientX = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  };

  return (
    <div
      ref={frameRef}
      role="slider"
      aria-label={`Before and after comparison for ${area}`}
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 4));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 4));
      }}
      onPointerDown={(e) => {
        draggingRef.current = true;
        try {
          frameRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture unsupported — drag still works while held */
        }
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setFromClientX(e.clientX);
      }}
      onPointerUp={() => (draggingRef.current = false)}
      onPointerCancel={() => (draggingRef.current = false)}
      className="relative rounded-xl overflow-hidden bg-slate-100 aspect-video border border-slate-200 cursor-ew-resize select-none"
      style={{ touchAction: "pan-y" }}
    >
      {/* After (result) fills the frame; Before is revealed from the left */}
      <img
        src={afterUrl}
        alt={`After — ${area}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img
          src={beforeUrl}
          alt={`Before — ${area}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Labels */}
      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-600/90 text-white">
        Before
      </span>
      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-600/90 text-white">
        After
      </span>

      {/* Divider + handle */}
      <div className="absolute top-0 bottom-0 w-[2px] bg-white shadow-sm" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-7 w-7 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center">
          <MoveHorizontal className="h-3.5 w-3.5 text-slate-700" />
        </div>
      </div>
    </div>
  );
}

export function BeforeAfterGallery({
  photos,
  title = "Before & After Evidence Gallery",
  allowUpload = false,
  onUploadClick,
}: BeforeAfterGalleryProps) {
  const [filterType, setFilterType] = useState<"pairs" | "side" | "all">("pairs");
  const [previewPhoto, setPreviewPhoto] = useState<JobPhoto | null>(null);

  // Group photos by canonical area (PDF §7), in canonical room order.
  const pairsByArea = React.useMemo(() => {
    const grouped = new Map<string, JobPhoto[]>();
    photos.forEach((p) => {
      const key = canonicalArea(p.area);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    });
    return CANONICAL_AREAS.filter((a) => grouped.has(a)).map((area) => {
      const areaPhotos = grouped.get(area)!;
      const beforePhoto = areaPhotos.find((p) => p.photoType === "before");
      const afterPhoto = areaPhotos.find((p) => p.photoType === "after");
      return { area, beforePhoto, afterPhoto, all: areaPhotos };
    });
  }, [photos]);

  const filterButton = (value: typeof filterType, label: string) => (
    <button
      onClick={() => setFilterType(value)}
      className={cn(
        "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
        filterType === value ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-500" />
            {title}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Grouped by room · drag the slider to see the transformation
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {filterButton("pairs", "Before ↔ After")}
            {filterButton("side", "Side-by-Side")}
            {filterButton("all", `All Photos (${photos.length})`)}
          </div>

          {allowUpload && (
            <Button size="sm" onClick={onUploadClick} className="h-7 text-xs">
              <ImageIcon className="h-3 w-3 mr-1" />
              Upload Evidence
            </Button>
          )}
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center bg-slate-50/50">
          <ImageIcon className="h-8 w-8 mx-auto text-slate-400 mb-2" />
          <p className="text-xs font-medium text-slate-700">No photos logged yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Technicians upload before/after photos during on-site execution.
          </p>
        </div>
      ) : filterType === "pairs" ? (
        /* Interactive slider per area */
        <div className="space-y-4">
          {pairsByArea.map((pair) =>
            pair.beforePhoto && pair.afterPhoto ? (
              <div key={pair.area} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="px-4 py-2.5 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">{pair.area}</span>
                  <span className="text-[11px] text-slate-500">Drag to compare</span>
                </div>
                <div className="p-4">
                  <BeforeAfterSlider beforeUrl={pair.beforePhoto.photoUrl} afterUrl={pair.afterPhoto.photoUrl} area={pair.area} />
                  {(pair.beforePhoto.caption || pair.afterPhoto.caption) && (
                    <p className="text-xs text-slate-500 italic mt-2">
                      {pair.afterPhoto?.caption || pair.beforePhoto?.caption}
                    </p>
                  )}
                </div>
              </div>
            ) : null
          )}
          {/* Areas without a full pair fall back to the side-by-side grid */}
          {pairsByArea.filter((p) => !(p.beforePhoto && p.afterPhoto)).length > 0 && (
            <div className="space-y-4 pt-1">
              {pairsByArea
                .filter((p) => !(p.beforePhoto && p.afterPhoto))
                .map((pair) => (
                  <div key={pair.area} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                    <div className="px-4 py-2.5 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">{pair.area}</span>
                      <span className="text-[11px] text-slate-400">
                        {pair.beforePhoto ? "Before photo only" : "After photo only"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-slate-200">
                      {[pair.beforePhoto, pair.afterPhoto].map((photo, i) =>
                        photo ? (
                          <div key={i} className="relative aspect-video bg-slate-100">
                            <img
                              src={photo.photoUrl}
                              alt={`${i === 0 ? "Before" : "After"} — ${pair.area}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                            <span
                              className={cn(
                                "absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white",
                                i === 0 ? "bg-amber-600/90" : "bg-emerald-600/90"
                              )}
                            >
                              {i === 0 ? "Before" : "After"}
                            </span>
                          </div>
                        ) : (
                          <div
                            key={i}
                            className="aspect-video flex items-center justify-center text-[11px] text-slate-400 bg-slate-50"
                          >
                            {i === 0 ? "No before photo recorded" : "After photo pending"}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : filterType === "side" ? (
        /* Classic side-by-side pairs */
        <div className="space-y-6">
          {pairsByArea.map((pair) => (
            <div key={pair.area} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">{pair.area}</span>
                <span className="text-[11px] text-slate-500">
                  {pair.beforePhoto && pair.afterPhoto
                    ? "Complete Before / After Pair"
                    : pair.beforePhoto
                    ? "Before photo only"
                    : "After photo only"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                {/* BEFORE */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      Initial Condition (Before)
                    </span>
                    {pair.beforePhoto && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDateTime(pair.beforePhoto.uploadedAt)}
                      </span>
                    )}
                  </div>

                  {pair.beforePhoto ? (
                    <div className="space-y-2">
                      <div className="relative rounded-md overflow-hidden bg-slate-100 aspect-video border border-slate-200">
                        <img
                          src={pair.beforePhoto.photoUrl}
                          alt={`Before - ${pair.area}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {pair.beforePhoto.caption && (
                        <p className="text-xs text-slate-600 italic">"{pair.beforePhoto.caption}"</p>
                      )}
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400 bg-slate-50/50">
                      No initial before photo recorded
                    </div>
                  )}
                </div>

                {/* AFTER */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      Result Delivered (After)
                    </span>
                    {pair.afterPhoto && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDateTime(pair.afterPhoto.uploadedAt)}
                      </span>
                    )}
                  </div>

                  {pair.afterPhoto ? (
                    <div className="space-y-2">
                      <div className="relative rounded-md overflow-hidden bg-slate-100 aspect-video border border-slate-200">
                        <img
                          src={pair.afterPhoto.photoUrl}
                          alt={`After - ${pair.area}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {pair.afterPhoto.caption && (
                        <p className="text-xs text-slate-600 italic">"{pair.afterPhoto.caption}"</p>
                      )}
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400 bg-slate-50/50">
                      Work in progress (After photo pending)
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs text-xs"
            >
              <div
                className="relative aspect-video bg-slate-100 cursor-pointer group"
                onClick={() => setPreviewPhoto(photo)}
              >
                <img
                  src={photo.photoUrl}
                  alt={photo.caption || photo.area}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <span
                  className={cn(
                    "absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-semibold",
                    photo.photoType === "before" ? "bg-amber-600 text-white" : "bg-emerald-600 text-white"
                  )}
                >
                  {photo.photoType}
                </span>
                <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-[10px] font-semibold bg-slate-900/80 px-2 py-1 rounded border border-white/20">
                    Click to Expand
                  </span>
                </div>
              </div>
              <div className="p-2 space-y-1">
                <div className="font-medium text-slate-900 truncate">{photo.area}</div>
                {photo.caption && <p className="text-[11px] text-slate-500 line-clamp-1">{photo.caption}</p>}
                <div className="text-[10px] text-slate-400">{formatDateTime(photo.uploadedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Pop-up Modal */}
      {previewPhoto && (
        <ImageLightboxModal
          isOpen={!!previewPhoto}
          onClose={() => setPreviewPhoto(null)}
          imageUrl={previewPhoto.photoUrl}
          title={`${previewPhoto.area} — ${previewPhoto.photoType.toUpperCase()} Cleaning`}
          category={previewPhoto.photoType}
          uploadedAt={previewPhoto.uploadedAt}
          notes={previewPhoto.caption}
        />
      )}
    </div>
  );
}
