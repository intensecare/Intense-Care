"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Search, Send, Check, CheckCheck, Clock, AlertTriangle, FileText, Paperclip, Ban, MessageCircle } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Pill, SelectField, callApi, textareaCls } from "@/components/biz/Bits";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDateTime } from "@/lib/utils";
import type { WaConversationRow, WaMessageRow } from "@/lib/server/whatsapp/serialize";

interface ListData { rows: WaConversationRow[]; total: number; unreadConversations: number }
interface ThreadData { conversation: WaConversationRow; messages: WaMessageRow[] }
interface Template { id: string; name: string; language: string; category: string; bodyPreview: string | null; paramCount: number }

const FILTERS = [["all", "All"], ["unread", "Unread"], ["unassigned", "Unassigned"], ["mine", "Mine"]] as const;

/** Honest ticks: ACCEPTED means WhatsApp took the request — only SENT/DELIVERED/READ come from WhatsApp's own reports. */
function Ticks({ m }: { m: WaMessageRow }) {
  if (m.direction !== "OUT") return null;
  const label: Record<string, string> = { PENDING: "Sending…", ACCEPTED: "Accepted by WhatsApp — not yet confirmed sent", SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed" };
  const icon = m.status === "READ" ? <CheckCheck className="h-3.5 w-3.5 text-sky-600" aria-hidden /> : m.status === "DELIVERED" ? <CheckCheck className="h-3.5 w-3.5" aria-hidden /> : m.status === "SENT" ? <Check className="h-3.5 w-3.5" aria-hidden /> : m.status === "FAILED" ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />;
  return <span className="inline-flex items-center gap-1" title={label[m.status] ?? m.status} data-status={m.status}>{icon}<span className="sr-only">{label[m.status]}</span><span className="text-[11px]">{label[m.status]?.split(" —")[0]}</span></span>;
}

function Bubble({ m }: { m: WaMessageRow }) {
  const out = m.direction === "OUT";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm space-y-1.5 break-words", out ? (m.status === "FAILED" ? "bg-red-50 border border-red-200" : "bg-emerald-50 border border-emerald-200") : "bg-white border border-zinc-200")}>
        {m.media && (
          m.media.previewable && m.media.mime?.startsWith("image/") ? (
            <a href={m.media.url ?? "#"} target="_blank" rel="noreferrer"><img src={m.media.url ?? ""} alt={m.media.filename ?? "Photo from customer"} className="rounded-xl max-h-64 w-auto" loading="lazy" /></a>
          ) : m.media.url ? (
            <a href={`${m.media.url}${m.media.previewable ? "" : "?download=1"}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-medium text-zinc-800"><FileText className="h-4 w-4" aria-hidden />{m.media.filename ?? m.type}</a>
          ) : (
            <span className="inline-flex items-center gap-2 text-zinc-500"><Paperclip className="h-4 w-4" aria-hidden />{m.media.status === "PENDING" ? "Downloading attachment…" : m.media.note ?? "Attachment not stored"}</span>
          )
        )}
        {m.templateName && <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Template · {m.templateName}</div>}
        {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
        {m.error && <p className="text-xs text-red-700">Not delivered: {m.error}</p>}
        <div className="flex items-center justify-end gap-2 text-[11px] text-zinc-500">
          {out && m.sentByName && <span>{m.sentByName}</span>}
          <time dateTime={m.at}>{formatDateTime(m.at)}</time>
          <Ticks m={m} />
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppInboxPage() {
  return (
    <React.Suspense fallback={<AdminLayout><SkeletonList rows={4} /></AdminLayout>}>
      <Inbox />
    </React.Suspense>
  );
}

function Inbox() {
  const { can } = useAuth();
  const { users } = useApp();
  const manage = can("leads.manage");
  const search = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [q, setQ] = useState("");
  const [list, setList] = useState<ListData | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(search.get("c"));
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplId, setTplId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const reqId = useRef<string>("");

  const loadList = useCallback(async () => {
    const r = await callApi<ListData>(`/api/whatsapp/conversations?filter=${filter}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
    if (r.error) setListError(r.error); else { setListError(null); setList(r.data ?? null); }
  }, [filter, q]);
  const loadThread = useCallback(async (id: string, markRead = true) => {
    const r = await callApi<ThreadData>(`/api/whatsapp/conversations/${id}`);
    if (r.error) { setError(r.error); return; }
    setThread(r.data ?? null);
    if (markRead && r.data && r.data.conversation.unreadCount > 0) { await callApi(`/api/whatsapp/conversations/${id}`, { method: "PATCH", json: { read: true } }); void loadList(); }
  }, [loadList]);

  useEffect(() => { const t = setTimeout(() => void loadList(), q ? 250 : 0); return () => clearTimeout(t); }, [loadList, q]);
  useEffect(() => { const i = setInterval(() => { void loadList(); if (selected) void loadThread(selected, false); }, 15000); return () => clearInterval(i); }, [loadList, loadThread, selected]);
  useEffect(() => { if (selected) { setThread(null); setError(null); void loadThread(selected); } }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length]);
  useEffect(() => {
    const lead = search.get("lead");
    if (lead && !search.get("c")) void callApi<ListData>(`/api/whatsapp/conversations?leadId=${encodeURIComponent(lead)}`).then((r) => { if (r.data?.rows[0]) setSelected(r.data.rows[0].id); });
  }, [search]);
  useEffect(() => { void callApi<Template[]>("/api/whatsapp/templates").then((r) => setTemplates(r.data ?? [])); }, []);

  const conv = thread?.conversation;
  const tpl = templates.find((t) => t.id === tplId);
  useEffect(() => setParams(Array(tpl?.paramCount ?? 0).fill("")), [tplId]); // eslint-disable-line react-hooks/exhaustive-deps
  const admins = useMemo(() => users.filter((u) => u.role === "admin" && u.active !== false), [users]);

  const send = async (body: Record<string, unknown>) => {
    if (!conv) return;
    setBusy(true); setError(null);
    if (!reqId.current) reqId.current = crypto.randomUUID();
    const r = await callApi<{ message: WaMessageRow }>("/api/whatsapp/send", { method: "POST", json: { contactId: conv.id, clientRequestId: reqId.current, ...body } });
    setBusy(false);
    if (r.error) { setError(r.error); reqId.current = ""; await loadThread(conv.id, false); return; }
    reqId.current = ""; setText(""); setTplId("");
    await loadThread(conv.id, false); void loadList();
  };
  const patch = async (json: Record<string, unknown>) => {
    if (!conv) return;
    const r = await callApi(`/api/whatsapp/conversations/${conv.id}`, { method: "PATCH", json });
    if (r.error) setError(r.error); else { await loadThread(conv.id, false); void loadList(); }
  };

  const showThread = !!selected;
  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto pb-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/leads" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10"><ChevronLeft className="h-4 w-4" aria-hidden /> Leads</Link>
          <h1 className="text-lg font-semibold text-zinc-950 flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" aria-hidden /> WhatsApp inbox {list && list.unreadConversations > 0 && <Pill tone="good">{list.unreadConversations} unread</Pill>}</h1>
        </div>
        <div className="grid lg:grid-cols-[340px_1fr] gap-3 min-h-[70vh]">
          {/* conversations */}
          <section className={cn("rounded-2xl border border-zinc-200 bg-white flex flex-col min-h-0", showThread && "hidden lg:flex")} aria-label="Conversations">
            <div className="p-3 space-y-2 border-b border-zinc-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden />
                <Input aria-label="Search conversations" placeholder="Search name, phone or message" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
              </div>
              <div className="flex gap-1.5 flex-wrap" role="tablist">
                {FILTERS.map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("min-h-9 rounded-full px-3 text-sm font-semibold border", filter === k ? "bg-zinc-950 text-white border-zinc-950" : "bg-white text-zinc-700 border-zinc-200")}>{l}</button>
                ))}
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {listError ? <ErrorState message={listError} onRetry={() => void loadList()} /> : !list ? <SkeletonList rows={5} /> : list.rows.length === 0 ? (
                <p className="p-6 text-sm text-zinc-500 text-center">{q || filter !== "all" ? "No conversations match." : "No WhatsApp conversations yet. Customer messages to your business number appear here."}</p>
              ) : (
                <ul>
                  {list.rows.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setSelected(c.id)} className={cn("w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 min-h-16", selected === c.id && "bg-emerald-50")}>
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-sm text-zinc-950", c.unreadCount ? "font-bold" : "font-semibold")}>{c.name}</span>
                          <span className="shrink-0 text-xs text-zinc-500">{c.lastMessageAt ? formatDateTime(c.lastMessageAt) : ""}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2 mt-0.5">
                          <span className={cn("truncate text-sm", c.unreadCount ? "text-zinc-900" : "text-zinc-500")}>{c.lastDirection === "OUT" ? "You: " : ""}{c.lastPreview ?? ""}</span>
                          {c.unreadCount > 0 && <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold grid place-items-center" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</span>}
                        </span>
                        <span className="flex gap-1.5 mt-1 flex-wrap">
                          {!c.assignedUserId && c.leadId && <Pill tone="warn">Unassigned</Pill>}
                          {c.optedOut && <Pill tone="bad">Opted out</Pill>}
                          {!c.windowOpen && !c.optedOut && <Pill>Template only</Pill>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* thread */}
          <section className={cn("rounded-2xl border border-zinc-200 bg-zinc-50 flex flex-col min-h-[60vh]", !showThread && "hidden lg:flex")} aria-label="Conversation">
            {!selected ? (
              <div className="m-auto text-center text-sm text-zinc-500 p-8"><MessageCircle className="h-8 w-8 mx-auto mb-2 text-zinc-300" aria-hidden />Pick a conversation.</div>
            ) : !conv ? (error ? <ErrorState message={error} onRetry={() => void loadThread(selected)} /> : <SkeletonList rows={4} />) : (
              <>
                <header className="bg-white rounded-t-2xl border-b border-zinc-200 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <button className="lg:hidden min-h-10 min-w-10 grid place-items-center" onClick={() => { setSelected(null); setThread(null); }} aria-label="Back to conversations"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-zinc-950 truncate">{conv.name}</div>
                      <div className="text-sm text-zinc-500">{conv.phone}{conv.leadNumber && <> · <Link className="font-semibold text-rose-700" href={`/leads/${conv.leadId}`}>{conv.leadNumber}</Link></>}</div>
                    </div>
                    {conv.optedOut ? <Pill tone="bad">Opted out</Pill> : conv.windowOpen ? <Pill tone="good" className="hidden sm:inline-flex">Reply window open</Pill> : <Pill tone="warn">Window closed</Pill>}
                  </div>
                  {manage && (
                    <div className="flex flex-wrap items-end gap-3">
                      {conv.leadId && (
                        <SelectField label="Assigned to" id="wa-assign" value={conv.assignedUserId ?? ""} onChange={(v) => void patch({ assignedUserId: v || null })} className="min-w-44">
                          <option value="">Unassigned</option>
                          {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </SelectField>
                      )}
                      <label className="flex items-center gap-2 text-sm min-h-10"><input type="checkbox" checked={conv.optedOut} onChange={(e) => void patch({ optedOut: e.target.checked })} /> Customer opted out</label>
                      {!conv.optedOut && <label className="flex items-center gap-2 text-sm min-h-10"><input type="checkbox" checked={conv.marketingConsent} onChange={(e) => void patch({ marketingConsent: e.target.checked })} /> Agreed to marketing messages</label>}
                    </div>
                  )}
                </header>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[55vh]" aria-live="polite">
                  {thread!.messages.map((m) => <Bubble key={m.id} m={m} />)}
                  <div ref={endRef} />
                </div>
                <footer className="bg-white rounded-b-2xl border-t border-zinc-200 p-3 space-y-2">
                  {error && <Notice tone="error">{error}</Notice>}
                  {!manage ? <p className="text-sm text-zinc-500">You can read this conversation but not reply.</p> : conv.optedOut ? (
                    <p className="text-sm text-red-700 inline-flex items-center gap-2"><Ban className="h-4 w-4" aria-hidden /> This customer opted out. Nothing can be sent to them.</p>
                  ) : (
                    <>
                      {conv.windowOpen ? (
                        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send({ kind: "text", text }); }} className="flex gap-2 items-end">
                          <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4096} placeholder="Write a reply…" className={cn(textareaCls, "flex-1")} />
                          <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" aria-hidden /></Button>
                        </form>
                      ) : (
                        <Notice tone="warning">The 24-hour reply window is closed{conv.lastInboundAt ? ` (customer last wrote ${formatDateTime(conv.lastInboundAt)})` : ""}. WhatsApp only allows an approved template message now.</Notice>
                      )}
                      {templates.length > 0 && (
                        <details className="rounded-xl border border-zinc-200 px-3 py-2" open={!conv.windowOpen}>
                          <summary className="text-sm font-semibold cursor-pointer min-h-8 flex items-center">Send an approved template</summary>
                          <div className="space-y-2 mt-2">
                            <SelectField label="Template" id="wa-tpl" value={tplId} onChange={setTplId}>
                              <option value="">Choose…</option>
                              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language}) · {t.category.toLowerCase()}</option>)}
                            </SelectField>
                            {tpl?.bodyPreview && <p className="text-sm text-zinc-600 rounded-lg bg-zinc-50 p-2">{tpl.bodyPreview}</p>}
                            {tpl && params.map((p, i) => <Input key={i} aria-label={`Value ${i + 1}`} placeholder={`Value for {{${i + 1}}}`} value={p} onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))} />)}
                            {tpl?.category === "MARKETING" && !conv.marketingConsent && <p className="text-sm text-amber-800">Marketing templates need the customer's recorded consent (tick “Agreed to marketing messages” above).</p>}
                            <Button type="button" variant="secondary" loading={busy} disabled={!tpl || params.some((p) => !p.trim())} onClick={() => void send({ kind: "template", templateId: tplId, params })}>Send template</Button>
                          </div>
                        </details>
                      )}
                      <p className="text-xs text-zinc-500">“Accepted” only means WhatsApp took the message. Sent, delivered and read are shown when WhatsApp reports them.</p>
                    </>
                  )}
                </footer>
              </>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
