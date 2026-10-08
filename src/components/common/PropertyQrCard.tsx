"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Copy, Check, Loader2, Printer } from "lucide-react";

/**
 * The ONE optional property QR. Scanning it opens the customer page for the
 * property's current or upcoming service. Admin can create, re-print,
 * replace (old QR stops working) or turn it off.
 */
export function PropertyQrCard({ propertyId, propertyTitle }: { propertyId: string; propertyTitle: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const call = async (method: "GET" | "POST" | "DELETE") => {
    setError(null);
    const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/access-link`, { method });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      setError(json?.error || "Could not load the property QR.");
      return;
    }
    setUrl(json.data.url);
  };

  useEffect(() => {
    setLoading(true);
    void call("GET").finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    void QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then(setImg);
  }, [url]);

  const run = async (method: "POST" | "DELETE") => {
    setBusy(true);
    await call(method);
    setBusy(false);
  };

  const print = () => {
    if (!img) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(`<html><head><title>${propertyTitle}</title></head><body style="font-family:sans-serif;text-align:center;padding:24px"><h2 style="margin:0 0 4px">${propertyTitle.replace(/</g, "&lt;")}</h2><p style="margin:0 0 16px;color:#555">Scan to see your service</p><img src="${img}" style="width:280px;height:280px"/></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <QrCode className="h-4 w-4 text-slate-500" /> Property QR (optional)
      </div>
      <p className="text-xs text-slate-500">Place it at the property. Scanning opens the customer page for the current or upcoming service.</p>
      {loading ? (
        <div className="h-10 flex items-center text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>
      ) : url ? (
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          {img ? <img src={img} alt="Property QR code" className="h-36 w-36 rounded-xl border border-slate-200" /> : <div className="h-36 w-36 rounded-xl bg-slate-100" />}
          <div className="flex-1 min-w-0 space-y-2 w-full">
            <div className="text-[11px] font-mono text-slate-500 break-all">{url}</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold inline-flex items-center gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
              </button>
              <button onClick={print} className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold inline-flex items-center gap-1.5">
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button disabled={busy} onClick={() => void run("POST")} className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold">Replace</button>
              <button disabled={busy} onClick={() => void run("DELETE")} className="h-9 px-3 rounded-lg border border-red-200 text-red-700 text-xs font-semibold">Turn off</button>
            </div>
          </div>
        </div>
      ) : (
        <button disabled={busy} onClick={() => void run("POST")} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold inline-flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Create property QR
        </button>
      )}
      {error && <div className="text-xs text-red-700">{error}</div>}
    </div>
  );
}
