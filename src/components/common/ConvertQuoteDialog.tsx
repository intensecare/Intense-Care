"use client";

import React, { useEffect, useState } from "react";
import { Loader2, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Property, Quote } from "@/lib/types";

export interface QuoteSchedule {
  scheduledDate: string;
  scheduledTimeSlot: string;
}

interface ConvertQuoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  quote: Quote | null;
  property?: Property;
  onConfirm: (
    quote: Quote,
    schedule: QuoteSchedule
  ) => Promise<{ success: boolean; message: string }>;
}

const toLocalDateOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Derives a default time window from the property's preferred time, if any. */
function defaultSlot(property?: Property): string {
  const t = property?.preferredTime?.trim().toLowerCase() ?? "";
  if (t.includes("morning")) return "09:00 - 13:00";
  if (t.includes("afternoon")) return "13:00 - 17:00";
  if (t.includes("evening")) return "17:00 - 20:00";
  return "09:00 - 13:30";
}

/**
 * Conversion of an accepted quotation into a booking + tax invoice. The desk
 * picks the actual service date/window instead of receiving hardcoded values.
 */
export function ConvertQuoteDialog({ isOpen, onClose, quote, property, onConfirm }: ConvertQuoteDialogProps) {
  const [scheduledDate, setScheduledDate] = useState(toLocalDateOffset(1));
  const [slot, setSlot] = useState("09:00 - 13:30");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setScheduledDate(toLocalDateOffset(1));
      setSlot(defaultSlot(property));
      setError("");
    }
  }, [isOpen, property]);

  const slotValid = /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/.test(slot.trim());

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote) return;
    if (!scheduledDate || !slotValid) {
      setError("Enter a service date and a window like 09:00 - 13:00.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    const result = await onConfirm(quote, {
      scheduledDate,
      scheduledTimeSlot: slot.trim(),
    });
    setIsSubmitting(false);
    if (result.success) onClose();
    else setError(result.message);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4 text-emerald-600" />
            Convert Quotation to Booking
          </DialogTitle>
          <DialogDescription>
            {quote ? `${quote.quoteNumber} becomes a scheduled booking with its tax invoice. Pick the service schedule.` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Service Date</label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Time Window</label>
              <Input
                type="text"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder="09:00 - 13:00"
                className="text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">24h window, e.g. 09:00 - 13:00.</p>
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="bg-slate-900 text-white" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Converting…
                </>
              ) : (
                "Confirm Conversion"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
