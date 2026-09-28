"use client";

import React, { useState, useEffect } from "react";
import { X, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  onSubmit: (value: string) => void;
}

export function PromptModal({
  isOpen,
  onClose,
  title,
  description,
  placeholder = "Enter response...",
  defaultValue = "",
  confirmText = "Submit",
  onSubmit,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(value);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-zinc-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-zinc-900" />
            <span className="text-xs font-bold text-zinc-900 uppercase tracking-wider font-sans">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-black hover:bg-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {description && <p className="text-xs text-zinc-600 leading-relaxed font-sans">{description}</p>}

          <div className="space-y-1">
            <Input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              onFocus={(e) => e.target.select()}
              autoFocus
              className="text-xs h-9"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-black text-white font-medium border border-black hover:bg-zinc-800">
              {confirmText}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

