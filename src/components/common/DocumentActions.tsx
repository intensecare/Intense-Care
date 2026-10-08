"use client";

import React, { useState } from "react";
import { Download, Printer, Share2, Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * §4 / §5 [ Download PDF ] [ Print ] [ Share ] — one row, every document.
 *
 * Download PDF and Print are the same browser dialog, because that dialog is
 * what actually produces a faithful PDF of the styled document (Save as PDF
 * is a destination in it). They are offered separately because people look
 * for the word they have in mind, and the PDF button says so in its hint.
 *
 * Share uses the native share sheet when the device has one (a phone sharing
 * to WhatsApp, which is how these documents usually travel), and falls back
 * to copying the link.
 */
export function DocumentActions({
  /** What the document is called when shared, e.g. "Quotation QTN-2627-00001". */
  title,
  /** The link to share. Defaults to the current page. */
  shareUrl,
  /** Extra line for the share message. */
  shareText,
  className,
}: {
  title: string;
  shareUrl?: string;
  shareText?: string;
  className?: string;
}) {
  const [shared, setShared] = useState<"copied" | "shared" | null>(null);

  const print = () => window.print();

  const share = async () => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    const payload = { title, text: shareText || title, url };
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share(payload);
        setShared("shared");
        setTimeout(() => setShared(null), 2500);
        return;
      } catch {
        // The sheet was dismissed, or sharing is blocked — fall back to copy.
      }
    }
    try {
      await nav?.clipboard?.writeText(url);
      setShared("copied");
      setTimeout(() => setShared(null), 2500);
    } catch {
      setShared(null);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 print:hidden", className)}>
      <Button onClick={print}>
        <Download className="h-4 w-4" aria-hidden /> DOWNLOAD PDF
      </Button>
      <Button variant="outline" onClick={print}>
        <Printer className="h-4 w-4" aria-hidden /> PRINT
      </Button>
      <Button variant="outline" onClick={() => void share()}>
        {shared ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {shared === "copied" ? "LINK COPIED" : shared === "shared" ? "SHARED" : "SHARE"}
      </Button>
      <p className="basis-full text-xs text-zinc-500">
        <Link2 className="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden />
        In the print dialog choose <strong>Save as PDF</strong> to keep a copy.
      </p>
    </div>
  );
}
