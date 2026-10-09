"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { UPLOAD_MAX_BYTES } from "@/lib/business";

/** JSON call to one of our APIs → { data } or { error } (never throws). */
export async function callApi<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ data?: T; error?: string; status: number; extra?: Record<string, unknown> }> {
  try {
    const { json, ...rest } = init ?? {};
    const res = await fetch(url, {
      cache: "no-store",
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { error: body?.error || (res.status === 403 ? "Your role isn't allowed to do that." : res.status === 404 ? "Not found." : "Something went wrong. Please try again."), status: res.status, extra: body ?? undefined };
    return { data: body.data as T, status: res.status };
  } catch {
    return { error: "You're offline. Check your connection and try again.", status: 0 };
  }
}

/** Uploads one file and returns its id. */
export async function uploadFile(file: File, meta: { ownerType: "expense" | "employee"; ownerId?: string; category?: string; label?: string; expiresOn?: string }) {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
  return callApi<{ id: string; fileName: string; mimeType: string }>("/api/files", { method: "POST", body: form });
}

/** A list that loads from an API with filters and reloads on demand. */
export function useApiList<T>(buildUrl: () => string, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(buildUrl);
  urlRef.current = buildUrl;
  const reload = useCallback(async () => {
    setLoading(true);
    const r = await callApi<T>(urlRef.current());
    if (r.error) setError(r.error);
    else {
      setError(null);
      setData(r.data ?? null);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload };
}

const selectCls = "w-full h-11 rounded-xl border border-zinc-300 bg-white px-3 text-base sm:text-sm disabled:bg-zinc-50";

export function SelectField({ label, id, value, onChange, children, hint, required, className, disabled }: { label: string; id: string; value: string; onChange: (v: string) => void; children: React.ReactNode; hint?: string; required?: boolean; className?: string; disabled?: boolean }) {
  return (
    <Field label={label} htmlFor={id} hint={hint} required={required} className={className}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={selectCls}>
        {children}
      </select>
    </Field>
  );
}

export const textareaCls = "w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm";

const TONES = {
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-700",
  info: "border-info-200 bg-info-50 text-info-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-700",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
} as const;
export function Pill({ tone = "neutral", children, className }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className={cn("rounded-2xl border bg-white p-4 min-w-0", tone === "bad" ? "border-red-200" : tone === "warn" ? "border-amber-200" : "border-zinc-200")}>
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={cn("text-xl sm:text-2xl font-semibold mt-1 break-words", tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-zinc-950")}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

/** Choose a receipt / document. Shows the chosen name; checks size and type before sending. */
export function FilePick({ file, onFile, label = "Receipt or bill", existing }: { file: File | null; onFile: (f: File | null) => void; label?: string; existing?: { id: string; fileName: string } | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-zinc-800">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}><Paperclip className="h-4 w-4" aria-hidden /> {file || existing ? "Replace file" : "Attach file"}</Button>
        {file ? (
          <span className="inline-flex items-center gap-1 text-sm text-zinc-700 min-w-0"><span className="truncate max-w-[14rem]">{file.name}</span><button type="button" aria-label="Remove file" onClick={() => onFile(null)}><X className="h-4 w-4 text-zinc-400" aria-hidden /></button></span>
        ) : existing ? (
          <a href={`/api/files/${existing.id}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-rose-600 truncate max-w-[14rem]">{existing.fileName}</a>
        ) : null}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture={undefined}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!f) return;
          if (f.size > UPLOAD_MAX_BYTES) return setProblem(`That file is too large (limit ${UPLOAD_MAX_BYTES / 1024 / 1024} MB).`);
          if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) return setProblem("Use a JPEG, PNG, WebP image or a PDF.");
          setProblem(null);
          onFile(f);
        }}
      />
      {problem ? <p role="alert" className="text-xs font-medium text-red-700">{problem}</p> : <p className="text-xs text-zinc-500">JPEG, PNG, WebP or PDF · up to {UPLOAD_MAX_BYTES / 1024 / 1024} MB</p>}
    </div>
  );
}

export const inr = (n: number | null | undefined) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export function csvUrl(base: string, params: Record<string, string | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `${base}?${q.toString()}`;
}
