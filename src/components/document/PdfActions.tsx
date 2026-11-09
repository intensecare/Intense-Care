"use client";

import React, { useState } from "react";
import { Download, Eye, Printer, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const asLink = "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50";

/**
 * Download / preview / print for a server-generated PDF. The preview IS the PDF the customer receives (an embedded
 * viewer on the same file), so what is shown always matches what is downloaded, printed or shared.
 */
export function PdfActions({ href, defaultOpen = false }: { href: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <a href={href} download className={asLink}><Download className="h-4 w-4" aria-hidden /> Download PDF</a>
      <Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} {open ? "Hide preview" : "Preview PDF"}</Button>
      <a href={`${href}?inline=1`} target="_blank" rel="noreferrer" className={asLink}><Printer className="h-4 w-4" aria-hidden /> Print</a>
      {open && <PdfPreview href={href} />}
    </>
  );
}

/** Full-width embedded viewer (rendered by the browser's own PDF viewer; falls back to a link). */
export function PdfPreview({ href }: { href: string }) {
  return (
    <div className="basis-full print:hidden">
      <iframe title="PDF preview" src={`${href}?inline=1#toolbar=0&navpanes=0`} className="w-full h-[78vh] rounded-xl border border-zinc-200 bg-zinc-50" />
      <p className="mt-1 text-xs text-zinc-500">Can't see the preview? <a className="font-semibold underline" href={`${href}?inline=1`} target="_blank" rel="noreferrer">Open the PDF in a new tab</a>.</p>
    </div>
  );
}
