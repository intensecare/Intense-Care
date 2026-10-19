"use client";

import React, { useState } from "react";
import { HardDrive, Trash2, AlertTriangle, ShieldAlert, Lock, Image as ImageIcon, FileText, Search, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/data-table";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SelectField, Stat, Pill, useApiList, callApi, csvUrl } from "@/components/biz/Bits";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import { formatBytes, MEDIA_CATEGORIES, MEDIA_CATEGORY_LABEL, PROTECTED_DELETE_PHRASE, type MediaItem, type MediaSummary, type ProtectionLevel } from "@/lib/media";

interface ListResponse { rows: MediaItem[]; total: number; totalBytes: number; page: number; pageSize: number }
interface Scan { items: MediaItem[]; brokenReferences: MediaItem[]; cloudChecked: boolean; truncated: boolean; error: string | null }
interface Preview { items: MediaItem[]; missing: string[]; totalBytes: number; counts: Record<"free" | "confirm" | "protected" | "locked", number> }
interface Outcome { id: string; name: string; outcome: "DELETED" | "REFUSED" | "FAILED" | "NOT_FOUND"; reason?: string }

const LEVEL: Record<ProtectionLevel, { label: string; tone: "good" | "info" | "warn" | "bad" }> = {
  FREE: { label: "Safe to remove", tone: "good" },
  CONFIRM: { label: "Past retention", tone: "info" },
  PROTECTED: { label: "Protected record", tone: "warn" },
  LOCKED: { label: "In use — locked", tone: "bad" },
};

export default function MediaPage() {
  const { can } = useAuth();
  const manage = can("media.manage");
  const [tab, setTab] = useState<"files" | "unreferenced">("files");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [minMb, setMinMb] = useState("");
  const [sort, setSort] = useState("newest");
  const [protection, setProtection] = useState("");
  const [referenced, setReferenced] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, MediaItem>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useApiList<MediaSummary>(() => "/api/media/summary", []);
  const list = useApiList<ListResponse>(() => csvUrl("/api/media", { q: q.trim(), category, type, minMb, sort, protection, referenced, page: String(page), pageSize: "25" }), [q, category, type, minMb, sort, protection, referenced, page]);
  const scan = useApiList<Scan>(() => (tab === "unreferenced" ? "/api/media/unreferenced" : "/api/media/summary"), [tab]);
  const scanData = tab === "unreferenced" ? (scan.data as unknown as Scan | null) : null;

  const rows = tab === "files" ? list.data?.rows ?? [] : scanData?.items ?? [];
  const chosen = Object.values(selected);
  const toggle = (i: MediaItem) => setSelected((s) => { const n = { ...s }; if (n[i.id]) delete n[i.id]; else n[i.id] = i; return n; });

  const refreshAll = () => { summary.reload(); list.reload(); scan.reload(); };

  const openPreview = async () => {
    setPreviewBusy(true);
    setError(null);
    const r = await callApi<Preview>("/api/media/delete", { method: "POST", json: { ids: chosen.map((c) => c.id), preview: true } });
    setPreviewBusy(false);
    if (r.error || !r.data) return setError(r.error ?? "Could not prepare the deletion.");
    setReason("");
    setPhrase("");
    setOutcome(null);
    setPreview(r.data);
  };

  const confirmDelete = async () => {
    if (!preview) return;
    setBusy(true);
    const ids = preview.items.filter((i) => i.protection.level !== "LOCKED").map((i) => i.id);
    const r = await callApi<{ results: Outcome[]; deleted: number }>("/api/media/delete", {
      method: "POST",
      json: { ids, confirm: true, override: preview.counts.protected ? { reason, phrase } : null },
    });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? "Deletion failed.");
    setOutcome(r.data.results);
    setSelected({});
    refreshAll();
  };

  const s = summary.data;
  const q2 = s?.quota;
  const needsOverride = !!preview && preview.counts.protected > 0;
  const canConfirm = !!preview && preview.items.some((i) => i.protection.level !== "LOCKED") && (!needsOverride || (reason.trim().length >= 10 && phrase === PROTECTED_DELETE_PHRASE));

  return (
    <AdminLayout>
      <PageHeader title="Media & Storage" description="Photos and documents stored in the cloud. Review what takes space and remove only what is safe — business records are protected." actions={<Button variant="outline" onClick={refreshAll}><RefreshCw className="h-4 w-4" aria-hidden /> Refresh</Button>} />

      {summary.error && <ErrorState message={summary.error} onRetry={summary.reload} />}
      {q2?.message && q2.level !== "OK" && <Notice tone={q2.level === "UNKNOWN" ? "info" : "warning"} className="mb-4">{q2.message}</Notice>}

      {s && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" aria-label="Storage summary">
          <Stat label="Storage used" value={formatBytes(q2?.usedBytes ?? s.estimateBytes)} hint={q2?.usedBytes == null ? "Estimate from ERP records" : `Reported by ${s.provider.name}`} tone={q2?.level === "FULL" ? "bad" : q2?.level === "WARN" ? "warn" : undefined} />
          <Stat label="Storage limit" value={q2?.limitBytes ? formatBytes(q2.limitBytes) : "Not reported"} hint={q2?.limitBytes ? `${q2.usedPercent ?? 0}% used` : "Your storage provider didn't state a limit"} />
          <Stat label="Files managed" value={s.managed.files.toLocaleString("en-IN")} hint={formatBytes(s.managed.bytes)} />
          <Stat label="Provider" value={s.provider.name} hint={s.provider.configured ? (s.provider.plan ?? "Connected") : "Not configured"} />
        </section>
      )}
      {q2?.usedPercent != null && (
        <div className="mb-6" role="img" aria-label={`${q2.usedPercent}% of storage used`}>
          <div className="h-2.5 rounded-full bg-zinc-100 overflow-hidden"><div className={`h-full ${q2.level === "FULL" ? "bg-red-500" : q2.level === "WARN" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, q2.usedPercent)}%` }} /></div>
        </div>
      )}

      {s && (
        <section className="mb-6 grid sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-label="By category">
          {MEDIA_CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => { setTab("files"); setCategory(category === c ? "" : c); setPage(1); }} className={`text-left rounded-2xl border bg-white p-4 ${category === c ? "border-rose-400 ring-1 ring-rose-300" : "border-zinc-200"}`}>
              <div className="text-sm text-zinc-500">{MEDIA_CATEGORY_LABEL[c]}</div>
              <div className="text-lg font-semibold text-zinc-950 mt-0.5">{s.managed.byCategory[c].files.toLocaleString("en-IN")} files · {formatBytes(s.managed.byCategory[c].bytes)}</div>
            </button>
          ))}
        </section>
      )}

      {s && s.recommendations.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-label="Safe clean-up suggestions">
          <div className="font-semibold text-amber-900 mb-2">Safe clean-up suggestions</div>
          <ul className="space-y-1.5 text-sm text-amber-900">
            {s.recommendations.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2"><span>{r.title} — {r.files} files, {formatBytes(r.bytes)}.</span>
                <button type="button" className="font-semibold underline" onClick={() => { if (r.key === "cloud-scan") setTab("unreferenced"); else { setTab("files"); const f = new URLSearchParams(r.filter); setProtection(f.get("protection") ?? ""); setReferenced(f.get("referenced") ?? ""); setMinMb(f.get("minMb") ?? ""); setSort(f.get("sort") ?? "newest"); setPage(1); } }}>Review</button></li>
            ))}
          </ul>
        </section>
      )}

      <div role="tablist" className="flex gap-2 mb-4">
        {([["files", "All files"], ["unreferenced", "Unreferenced files"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelected({}); }} className={`h-10 px-4 rounded-xl text-sm font-semibold border ${tab === k ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-700 border-zinc-300"}`}>{label}</button>
        ))}
      </div>

      {tab === "files" && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <div className="col-span-2 lg:col-span-2 relative"><Search className="h-4 w-4 absolute left-3 top-3.5 text-zinc-400" aria-hidden /><Input aria-label="Search files" className="pl-9" placeholder="File, Job ID, customer, uploader" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <SelectField label="" id="m-cat" value={category} onChange={(v) => { setCategory(v); setPage(1); }}><option value="">All categories</option>{MEDIA_CATEGORIES.map((c) => <option key={c} value={c}>{MEDIA_CATEGORY_LABEL[c]}</option>)}</SelectField>
          <SelectField label="" id="m-type" value={type} onChange={(v) => { setType(v); setPage(1); }}><option value="">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option></SelectField>
          <SelectField label="" id="m-min" value={minMb} onChange={(v) => { setMinMb(v); setPage(1); }}><option value="">Any size</option><option value="1">Over 1 MB</option><option value="5">Over 5 MB</option><option value="10">Over 10 MB</option></SelectField>
          <SelectField label="" id="m-sort" value={sort} onChange={setSort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest first</option><option value="smallest">Smallest first</option><option value="name">Name</option></SelectField>
        </div>
      )}

      {tab === "unreferenced" && (
        <div className="mb-4 space-y-2">
          <p className="text-sm text-zinc-600">Files nothing refers to: receipts attached to no expense, and files in cloud storage with no photo record (older than 24 hours, so an upload in progress is never listed).</p>
          {scanData?.error && <Notice tone="warning">{scanData.error}</Notice>}
          {scanData && !scanData.cloudChecked && !scanData.error && <Notice tone="info">The cloud account was not scanned, so only ERP records are shown.</Notice>}
          {scanData?.truncated && <Notice tone="info">Only the first part of a very large library was scanned.</Notice>}
          {scanData && scanData.brokenReferences.length > 0 && <Notice tone="warning">{scanData.brokenReferences.length} photo record(s) point to a cloud file that no longer exists: {scanData.brokenReferences.slice(0, 5).map((b) => b.name).join(", ")}. Their links will show a broken image.</Notice>}
        </div>
      )}

      {error && <Notice tone="error" className="mb-3">{error}</Notice>}
      {(tab === "files" ? list.loading && !list.data : scan.loading) && <SkeletonList rows={5} />}
      {tab === "files" && list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.loading && tab === "files" && rows.length === 0 && !list.error && <EmptyState icon={HardDrive} title="No files match" description="Try clearing a filter." />}
      {tab === "unreferenced" && !scan.loading && rows.length === 0 && <EmptyState icon={HardDrive} title="Nothing unreferenced" description="Every file is used by a record." />}

      <ul className="space-y-2" aria-label="Files">
        {rows.map((i) => (
          <li key={i.id} className="rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 flex items-start gap-3">
            {manage && <input type="checkbox" className="mt-3 h-5 w-5 shrink-0" aria-label={`Select ${i.name}`} checked={!!selected[i.id]} onChange={() => toggle(i)} />}
            <div className="h-14 w-14 shrink-0 rounded-xl bg-zinc-100 overflow-hidden flex items-center justify-center">
              {i.thumbnailUrl ? <img src={i.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : i.type === "document" ? <FileText className="h-6 w-6 text-zinc-400" aria-hidden /> : <ImageIcon className="h-6 w-6 text-zinc-400" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-zinc-950 truncate max-w-full">{i.name}</span><Pill tone={LEVEL[i.protection.level].tone}>{LEVEL[i.protection.level].label}</Pill></div>
              <div className="text-sm text-zinc-500 mt-0.5">{MEDIA_CATEGORY_LABEL[i.category]} · {formatBytes(i.bytes)} · {i.type}{i.uploadedAt ? ` · ${formatDate(i.uploadedAt)}` : ""}</div>
              <div className="text-sm text-zinc-500">{i.jobSerial ? `Job ${i.jobSerial}` : "No job"}{i.customerName ? ` · ${i.customerName}` : ""}{i.uploadedBy ? ` · by ${i.uploadedBy}` : ""}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{i.referenced ? `Used by: ${i.references.join(", ") || "a record"}` : "Not used by any record"} — {i.protection.reasons[0]}</div>
            </div>
            {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-rose-600 shrink-0">Open</a>}
          </li>
        ))}
      </ul>
      {tab === "files" && list.data && <Pager page={list.data.page} pages={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}

      {manage && chosen.length > 0 && (
        <div className="sticky bottom-3 mt-4 rounded-2xl border border-zinc-300 bg-white shadow-lg p-3 flex flex-wrap items-center gap-3 z-10">
          <span className="text-sm font-semibold">{chosen.length} selected · {formatBytes(chosen.reduce((a, c) => a + (c.bytes ?? 0), 0))}</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Clear</Button>
          <Button variant="destructive" className="ml-auto" loading={previewBusy} onClick={() => void openPreview()}><Trash2 className="h-4 w-4" aria-hidden /> Review &amp; delete</Button>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o && !busy) { setPreview(null); setOutcome(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{outcome ? "Result" : "Confirm deletion"}</DialogTitle><DialogDescription>{outcome ? "Files are removed from cloud storage first; a record is only changed once its file is gone." : "This permanently removes the files from cloud storage. It cannot be undone."}</DialogDescription></DialogHeader>
          {preview && !outcome && (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto">
              <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                {preview.items.map((i) => (
                  <li key={i.id} className="p-3 text-sm">
                    <div className="font-semibold text-zinc-900 break-all">{i.name}</div>
                    <div className="text-zinc-500">{formatBytes(i.bytes)} · {i.type}{i.jobSerial ? ` · Job ${i.jobSerial}` : ""} · {i.referenced ? "used by a record" : "unused"}</div>
                    <div className="mt-1 flex items-start gap-1.5">{i.protection.level === "LOCKED" ? <Lock className="h-4 w-4 text-red-600 mt-0.5" aria-hidden /> : i.protection.level === "PROTECTED" ? <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5" aria-hidden /> : null}<span className={i.protection.level === "LOCKED" ? "text-red-700" : i.protection.level === "PROTECTED" ? "text-amber-800" : "text-zinc-600"}>{LEVEL[i.protection.level].label}: {i.protection.reasons.join(" ")}</span></div>
                  </li>
                ))}
              </ul>
              {preview.counts.locked > 0 && <Notice tone="warning">{preview.counts.locked} file(s) are locked and will be skipped.</Notice>}
              {needsOverride && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" aria-hidden /> {preview.counts.protected} protected business record file(s)</div>
                  <p className="text-sm text-amber-900">These are evidence or financial records. Deleting them is recorded permanently with your name and reason.</p>
                  <Input aria-label="Reason" placeholder="Reason (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Input aria-label="Type the phrase to confirm" placeholder={`Type: ${PROTECTED_DELETE_PHRASE}`} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
                </div>
              )}
            </div>
          )}
          {outcome && (
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 max-h-[50vh] overflow-y-auto text-sm">
              {outcome.map((o) => <li key={o.id} className="p-3 flex items-start justify-between gap-3"><span className="break-all">{o.name}</span><span className="text-right shrink-0"><Pill tone={o.outcome === "DELETED" ? "good" : o.outcome === "REFUSED" ? "warn" : "bad"}>{o.outcome === "DELETED" ? "Deleted" : o.outcome === "REFUSED" ? "Kept" : o.outcome === "NOT_FOUND" ? "Not found" : "Failed"}</Pill>{o.reason && <div className="text-xs text-zinc-500 mt-1 max-w-[16rem]">{o.reason}</div>}</span></li>)}
            </ul>
          )}
          <DialogFooter>
            {outcome ? <Button onClick={() => { setPreview(null); setOutcome(null); }}>Done</Button> : (
              <><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Cancel</Button><Button variant="destructive" loading={busy} disabled={!canConfirm} onClick={() => void confirmDelete()}>Delete {preview?.items.filter((i) => i.protection.level !== "LOCKED").length} file(s)</Button></>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
