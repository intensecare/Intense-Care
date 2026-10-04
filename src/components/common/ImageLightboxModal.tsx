"use client";

import React from "react";
import { X, Calendar, User, Camera, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  category?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  notes?: string;
}

export function ImageLightboxModal({
  isOpen,
  onClose,
  imageUrl,
  title = "Evidence Photo",
  category = "field_proof",
  uploadedBy,
  uploadedAt,
  notes,
}: ImageLightboxModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-800 shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <Camera className="h-4 w-4 text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-white leading-tight">{title}</h3>
              <span className="text-[10px] font-semibold text-slate-400 tracking-wider">
                {category.replace("_", " ")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a href={imageUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-300 hover:text-white">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Original
              </Button>
            </a>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Image Preview Container */}
        <div className="flex-1 bg-black flex items-center justify-center p-4 min-h-[350px] max-h-[65vh] overflow-hidden">
          <img
            src={imageUrl}
            alt={title}
            className="max-h-full max-w-full object-contain rounded shadow-lg"
          />
        </div>

        {/* Metadata Footer */}
        {(uploadedBy || uploadedAt || notes) && (
          <div className="p-4 border-t border-slate-800 bg-slate-900 text-xs text-slate-300 space-y-2 shrink-0">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              {uploadedBy && (
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-blue-400" />
                  Captured by: <strong className="text-slate-200">{uploadedBy}</strong>
                </span>
              )}
              {uploadedAt && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  {new Date(uploadedAt).toLocaleString()}
                </span>
              )}
            </div>
            {notes && (
              <p className="text-slate-300 bg-slate-800/80 p-2.5 rounded border border-slate-700/60 leading-relaxed text-xs">
                {notes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
