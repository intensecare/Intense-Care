"use client";

import React from "react";
import { AlertTriangle, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "destructive" | "default";
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "destructive",
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-zinc-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
          <div className="flex items-center gap-2">
            {variant === "destructive" ? (
              <Trash2 className="h-4 w-4 text-zinc-900" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-zinc-900" />
            )}
            <span className="text-xs font-semibold text-zinc-900 font-sans">
              {title}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-black hover:bg-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-600 leading-relaxed font-sans">{description}</p>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-8 text-xs font-medium"
            >
              {cancelText}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className={
                variant === "destructive"
                  ? "h-8 text-xs bg-rose-500 hover:bg-rose-600 text-white font-semibold border border-rose-500"
                  : "h-8 text-xs bg-rose-500 hover:bg-rose-600 text-white font-medium"
              }
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
