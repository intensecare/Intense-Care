"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

/** Asks for one short piece of text (a reason, a note). Sheet on phones. */
export function PromptModal({ isOpen, onClose, title, description, placeholder, defaultValue = "", confirmText = "Submit", onSubmit }: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <textarea
            autoFocus
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label={title}
            className="w-full rounded-xl border border-zinc-300 px-3.5 py-3 text-sm focus-visible:outline-none focus-visible:border-rose-500 focus-visible:ring-2 focus-visible:ring-rose-100"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{confirmText}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
