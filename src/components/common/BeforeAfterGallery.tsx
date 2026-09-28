"use client";

import React, { useState } from "react";
import { JobPhoto } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Image as ImageIcon, Sparkles, Clock, Eye, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

import { ImageLightboxModal } from "@/components/common/ImageLightboxModal";

interface BeforeAfterGalleryProps {
  photos: JobPhoto[];
  title?: string;
  allowUpload?: boolean;
  onUploadClick?: () => void;
}

export function BeforeAfterGallery({
  photos,
  title = "Before & After Evidence Gallery",
  allowUpload = false,
  onUploadClick,
}: BeforeAfterGalleryProps) {
  const [filterType, setFilterType] = useState<"all" | "pairs" | "before" | "after">("pairs");
  const [previewPhoto, setPreviewPhoto] = useState<JobPhoto | null>(null);

  // Group photos by area
  const areas = Array.from(new Set(photos.map((p) => p.area)));

  const pairsByArea = areas.map((area) => {
    const areaPhotos = photos.filter((p) => p.area === area);
    const beforePhoto = areaPhotos.find((p) => p.photoType === "before");
    const afterPhoto = areaPhotos.find((p) => p.photoType === "after");
    return {
      area,
      beforePhoto,
      afterPhoto,
      all: areaPhotos,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-500" />
            {title}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Verified photographic proof logged with timestamp & technician tags
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              onClick={() => setFilterType("pairs")}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                filterType === "pairs"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Side-by-Side Pairs
            </button>
            <button
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                filterType === "all"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              All Photos ({photos.length})
            </button>
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
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center bg-slate-50/50">
          <ImageIcon className="h-8 w-8 mx-auto text-slate-400 mb-2" />
          <p className="text-xs font-medium text-slate-700">No photos logged yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Technicians upload before/after photos during on-site execution.
          </p>
        </div>
      ) : filterType === "pairs" ? (
        <div className="space-y-6">
          {pairsByArea.map((pair) => (
            <div
              key={pair.area}
              className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-xs"
            >
              <div className="px-4 py-2.5 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">
                  {pair.area}
                </span>
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wider">
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
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {pair.beforePhoto.caption && (
                        <p className="text-xs text-slate-600 italic">
                          "{pair.beforePhoto.caption}"
                        </p>
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase tracking-wider">
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
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {pair.afterPhoto.caption && (
                        <p className="text-xs text-slate-600 italic">
                          "{pair.afterPhoto.caption}"
                        </p>
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
              className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-xs text-xs"
            >
              <div 
                className="relative aspect-video bg-slate-100 cursor-pointer group"
                onClick={() => setPreviewPhoto(photo)}
              >
                <img
                  src={photo.photoUrl}
                  alt={photo.caption || photo.area}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <span
                  className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    photo.photoType === "before"
                      ? "bg-amber-600 text-white"
                      : "bg-emerald-600 text-white"
                  }`}
                >
                  {photo.photoType}
                </span>
                <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold bg-slate-900/80 px-2 py-1 rounded border border-white/20">Click to Expand</span>
                </div>
              </div>
              <div className="p-2 space-y-1">
                <div className="font-medium text-slate-900 truncate">
                  {photo.area}
                </div>
                {photo.caption && (
                  <p className="text-[11px] text-slate-500 line-clamp-1">
                    {photo.caption}
                  </p>
                )}
                <div className="text-[10px] text-slate-400">
                  {formatDateTime(photo.uploadedAt)}
                </div>
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
