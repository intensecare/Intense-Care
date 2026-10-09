"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, PhoneCall, Search, Download, LayoutGrid, List, CalendarClock, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { DataTable, Pager } from "@/components/ui/data-table";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SelectField, Stat, Pill, useApiList, callApi, inr, csvUrl, textareaCls } from "@/components/biz/Bits";
import { LeadFormDialog, LogCallDialog } from "@/components/leads/LeadDialogs";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate } from "@/lib/utils";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, LEAD_STATUSES, LEAD_STATUS_LABEL, LOST_REASONS, LEAD_STATUS_TONE as STATUS_TONE, todayIST, type LeadRow, type LeadStats, type LeadStatus } from "@/lib/leads";


interface ListResponse { rows: LeadRow[]; total: number; page: number; pageSize: number; stats: LeadStats }
interface GbpResponse { configured: boolean; from: string; to: string; totals: Record<string, number>; error?: string }

function followUpTone(d: string | null, status: LeadStatus) {
  if (!d || status === "WON" || status === "LOST") return null;
  const t = todayIST();
  return d < t ? "overdue" : d === t ? "today" : "later";
}

export default function LeadsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const manage = can("leads.manage");
  const [view, setView] = useState<"list" | "board">("list");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<LeadRow | null>(null);
  const [lostReason, setLostReason] = useState<string>(LOST_REASONS[0]);
  const [lostNote, setLostNote] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const params = { q: q.trim() || undefined, from: from || undefined, to: to || undefined, source: source || undefined, status: view === "board" ? undefined : status || undefined, followUp: followUp || undefined };
  const list = useApiList<ListResponse>(() => csvUrl("/api/leads", { ...params, page: String(page), pageSize: "25", view: view === "board" ? "board" : undefined }), [q, from, to, source, status, followUp, page, view]);
  const gbp = useApiList<GbpResponse>(() => "/api/leads/google-metrics", []);
  const stats = list.data?.stats;
  const rows = list.data?.rows ?? [];

  const moveTo = async (lead: LeadRow, next: LeadStatus, reason?: string) => {
    if (lead.status === next) return;
    if (next === "LOST" && !reason) {
      setLostFor(lead);
      setLostReason(LOST_REASONS[0]);
      setLostNote("");
      return;
    }
    setMoveError(null);
    const r = await callApi(`/api/leads/${lead.id}`, { method: "PATCH", json: { status: next, lostReason: reason, expectedUpdatedAt: lead.updatedAt } });
    if (r.error) setMoveError(`${lead.leadNumber}: ${r.error}`);
    else setFlash(`${lead.leadNumber} moved to ${LEAD_STATUS_LABEL[next]}.`);
    void list.reload();
  };

  const bySource = useMemo(() => (stats ? LEAD_SOURCES.map((s) => ({ s, n: stats.bySource[s] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n) : []), [stats]);
  const maxSource = Math.max(1, ...bySource.map((x) => x.n));

  return (
    <AdminLayout>
      <PageHeader
        title="Leads"
        description="Every enquiry from calls, the website, WhatsApp, Google and referrals — until it becomes a customer and a job."
        actions={manage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setCallOpen(true)}><PhoneCall className="h-5 w-5" aria-hidden /> Log call</Button>
            <Button onClick={() => setCreateOpen(true)}><Plus className="h-5 w-5" aria-hidden /> New lead</Button>
          </div>
        ) : undefined}
      />

      {flash && <Notice tone="success" className="mb-4">{flash}</Notice>}
      {moveError && <Notice tone="error" className="mb-4">{moveError}</Notice>}

      {/* Dashboard */}
      {stats && (
        <section aria-label="Lead dashboard" className="space-y-3 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <Stat label="Total leads" value={stats.total} />
            <Stat label="New" value={stats.new} />
            <button type="button" className="text-left" onClick={() => { setFollowUp(followUp === "today" ? "" : "today"); setPage(1); }}><Stat label="Follow-ups due today" value={stats.followUpsToday} tone={stats.followUpsToday ? "warn" : undefined} hint={followUp === "today" ? "Filtered ✓" : "Tap to filter"} /></button>
            <button type="button" className="text-left" onClick={() => { setFollowUp(followUp === "overdue" ? "" : "overdue"); setPage(1); }}><Stat label="Overdue follow-ups" value={stats.overdueFollowUps} tone={stats.overdueFollowUps ? "bad" : undefined} hint={followUp === "overdue" ? "Filtered ✓" : "Tap to filter"} /></button>
            <Stat label="Quotations sent" value={stats.quotationsSent} />
            <Stat label="Won" value={stats.won} tone="good" />
            <Stat label="Lost" value={stats.lost} />
            <Stat label="Conversion rate" value={stats.conversionRate === null ? "—" : `${stats.conversionRate}%`} hint="Won ÷ (won + lost)" />
            <Stat label="Pipeline value" value={inr(stats.pipelineValue)} hint="Estimated value of open leads" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900 mb-3">Leads by source</h2>
              {bySource.length === 0 ? <p className="text-sm text-zinc-500">No leads in this period.</p> : (
                <ul className="space-y-2">
                  {bySource.map(({ s, n }) => (
                    <li key={s}>
                      <button type="button" onClick={() => { setSource(source === s ? "" : s); setPage(1); }} className="w-full text-left">
                        <div className="flex justify-between text-sm"><span className={cn("text-zinc-800", source === s && "font-semibold")}>{LEAD_SOURCE_LABEL[s]}</span><span className="tabular-nums text-zinc-600">{n}</span></div>
                        <div className="h-2 mt-1 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-rose-500" style={{ width: `${(n / maxSource) * 100}%` }} /></div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-2">
              <h2 className="text-sm font-semibold text-zinc-900">Google Business Profile <span className="font-normal text-zinc-500">(last 30 days)</span></h2>
              {!gbp.data ? <p className="text-sm text-zinc-500">Loading…</p> : !gbp.data.configured ? (
                <p className="text-sm text-zinc-600">Not connected. Add the Business Profile API credentials (see the README) to see calls, website clicks, direction requests and views from Google. These are counts only — Google doesn&apos;t say who searched, so they never create leads.</p>
              ) : gbp.data.error ? (
                <p className="text-sm text-amber-800">{gbp.data.error}</p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {[["Calls from Google", gbp.data.totals.CALL_CLICKS], ["Website clicks", gbp.data.totals.WEBSITE_CLICKS], ["Direction requests", gbp.data.totals.BUSINESS_DIRECTION_REQUESTS], ["Views on Maps", (gbp.data.totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0) + (gbp.data.totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0)], ["Views on Search", (gbp.data.totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0) + (gbp.data.totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0)]].map(([l, v]) => (
                      <div key={String(l)} className="rounded-xl bg-zinc-50 px-3 py-2"><dt className="text-zinc-500">{l}</dt><dd className="text-lg font-semibold text-zinc-950 tabular-nums">{Number(v ?? 0)}</dd></div>
                    ))}
                  </dl>
                  <p className="text-xs text-zinc-500">Aggregate counts from Google ({gbp.data.from} → {gbp.data.to}). They are not leads and don&apos;t identify anyone.</p>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Filters */}
      <section aria-label="Filters" className="rounded-2xl border border-zinc-200 bg-white p-4 mb-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, phone, email, Lead ID, service, area" className="pl-10" aria-label="Search leads" />
          </div>
          <div className="flex gap-2" role="group" aria-label="View">
            <Button variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} aria-pressed={view === "list"}><List className="h-4 w-4" aria-hidden /> List</Button>
            <Button variant={view === "board" ? "default" : "outline"} onClick={() => setView("board")} aria-pressed={view === "board"}><LayoutGrid className="h-4 w-4" aria-hidden /> Kanban</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Field label="From" htmlFor="lf-from"><Input id="lf-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
          <Field label="To" htmlFor="lf-to"><Input id="lf-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
          <SelectField label="Source" id="lf-src" value={source} onChange={(v) => { setSource(v); setPage(1); }}>
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
          </SelectField>
          <SelectField label="Status" id="lf-status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} disabled={view === "board"} hint={view === "board" ? "Columns show every status" : undefined}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </SelectField>
          <SelectField label="Follow-up" id="lf-fu" value={followUp} onChange={(v) => { setFollowUp(v); setPage(1); }}>
            <option value="">Any</option>
            <option value="today">Due today</option>
            <option value="overdue">Overdue</option>
          </SelectField>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="inline-flex items-center gap-1 font-semibold text-rose-600" href={csvUrl("/api/leads", { ...params, format: "csv" })}><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
          <a className="inline-flex items-center gap-1 font-semibold text-zinc-600" href={csvUrl("/api/leads", { ...params, format: "ads-conversions" })} title="Won leads with a Google Ads click id, ready for Google Ads → Conversions → Uploads"><Download className="h-4 w-4" aria-hidden /> Google Ads conversions</a>
        </div>
      </section>

      {list.error ? <ErrorState message={list.error} onRetry={() => void list.reload()} /> : list.loading && !list.data ? <SkeletonList rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={Search} title="No leads found" description={q || source || status || followUp || from || to ? "Try other filters." : "Add a lead, log a call, or connect the website form."} actionLabel={manage ? "New lead" : undefined} onAction={() => setCreateOpen(true)} />
      ) : view === "list" ? (
        <>
          <DataTable
            caption="Leads"
            rows={rows}
            rowKey={(r) => r.id}
            href={(r) => `/leads/${r.id}`}
            pageSize={0}
            columns={[
              { key: "name", header: "Lead", mobile: "title", cell: (r) => <span><span className="font-semibold text-zinc-950">{r.customerName}</span> <span className="text-xs text-zinc-500">{r.leadNumber}</span></span> },
              { key: "phone", header: "Phone", mobile: "subtitle", cell: (r) => r.phone },
              { key: "status", header: "Status", mobile: "badge", cell: (r) => <Pill tone={STATUS_TONE[r.status]}>{LEAD_STATUS_LABEL[r.status]}</Pill> },
              { key: "source", header: "Source", cell: (r) => LEAD_SOURCE_LABEL[r.source] },
              { key: "service", header: "Service", cell: (r) => r.serviceName ?? r.serviceInterest ?? "—" },
              { key: "value", header: "Est. value", align: "right", cell: (r) => (r.estimatedValue ? inr(r.estimatedValue) : "—") },
              { key: "fu", header: "Next follow-up", cell: (r) => { const t = followUpTone(r.nextFollowUpDate, r.status); return r.nextFollowUpDate && t ? <span className={cn(t === "overdue" ? "text-red-700 font-semibold" : t === "today" ? "text-amber-700 font-semibold" : "text-zinc-700")}>{t === "overdue" ? "Overdue · " : t === "today" ? "Today · " : ""}{formatDate(r.nextFollowUpDate)}</span> : "—"; } },
              { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt) },
            ]}
          />
          {list.data && list.data.total > list.data.pageSize && <Pager page={page} pages={Math.ceil(list.data.total / list.data.pageSize)} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
        </>
      ) : (
        // The wide board scrolls inside its box; `relative` keeps its visually-hidden labels from stretching the page.
        <div className="relative w-full max-w-full overflow-x-auto pb-3 [contain:inline-size]" role="region" aria-label="Kanban board — scroll sideways for more columns" tabIndex={0}>
          <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 w-max min-w-full">
            {LEAD_STATUSES.map((s) => {
              const col = rows.filter((r) => r.status === s);
              return (
                <section
                  key={s}
                  aria-label={`${LEAD_STATUS_LABEL[s]} — ${col.length}`}
                  onDragOver={(e) => { if (manage) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); const l = rows.find((r) => r.id === dragId); setDragId(null); if (l) void moveTo(l, s); }}
                  className="rounded-2xl bg-zinc-50 border border-zinc-200 p-2 space-y-2 min-h-40"
                >
                  <h2 className="px-2 pt-1 flex items-center justify-between text-sm font-semibold text-zinc-800"><span>{LEAD_STATUS_LABEL[s]}</span><span className="text-zinc-500 tabular-nums">{col.length}</span></h2>
                  {col.map((r) => {
                    const t = followUpTone(r.nextFollowUpDate, r.status);
                    return (
                      <article key={r.id} draggable={manage && !r.convertedJobId} onDragStart={() => setDragId(r.id)} className="rounded-xl border border-zinc-200 bg-white p-3 space-y-1.5 shadow-sm">
                        <button type="button" onClick={() => router.push(`/leads/${r.id}`)} className="block w-full text-left">
                          <div className="text-sm font-semibold text-zinc-950 break-words">{r.customerName}</div>
                          <div className="text-xs text-zinc-500">{r.leadNumber} · {LEAD_SOURCE_LABEL[r.source]}</div>
                          <div className="text-xs text-zinc-700 break-words">{r.serviceName ?? r.serviceInterest ?? "Service not set"}{r.estimatedValue ? ` · ${inr(r.estimatedValue)}` : ""}</div>
                          {t && t !== "later" && <div className={cn("text-xs font-semibold inline-flex items-center gap-1", t === "overdue" ? "text-red-700" : "text-amber-700")}>{t === "overdue" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden />} Follow-up {t === "overdue" ? `overdue (${r.nextFollowUpDate})` : "today"}</div>}
                          {r.convertedJobNumber && <div className="text-xs text-emerald-700 font-semibold">Job {r.convertedJobNumber}</div>}
                        </button>
                        {manage && !r.convertedJobId && (
                          <label className="block">
                            <span className="sr-only">Move {r.customerName} to</span>
                            <select value={r.status} onChange={(e) => void moveTo(r, e.target.value as LeadStatus)} className="w-full h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs">
                              {LEAD_STATUSES.map((x) => <option key={x} value={x}>{x === r.status ? `Status: ${LEAD_STATUS_LABEL[x]}` : `Move to ${LEAD_STATUS_LABEL[x]}`}</option>)}
                            </select>
                          </label>
                        )}
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(l) => { setFlash(`Lead ${l.leadNumber} added.`); void list.reload(); }} />
      <LogCallDialog open={callOpen} onOpenChange={setCallOpen} onSaved={(r) => { setFlash(r.created ? `Call saved as new lead ${r.lead.leadNumber}.` : `Call added to ${r.lead.leadNumber}.`); void list.reload(); }} />

      <Dialog open={!!lostFor} onOpenChange={(o) => !o && setLostFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {lostFor?.leadNumber} as lost</DialogTitle>
            <DialogDescription>Why was this lead lost? It helps spot patterns in Reports.</DialogDescription>
          </DialogHeader>
          <SelectField label="Reason" id="lost-r" value={lostReason} onChange={setLostReason}>
            {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </SelectField>
          <Field label="Details (optional)" htmlFor="lost-n"><textarea id="lost-n" rows={2} value={lostNote} onChange={(e) => setLostNote(e.target.value)} className={textareaCls} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>Cancel</Button>
            <Button onClick={() => { const l = lostFor!; setLostFor(null); void moveTo(l, "LOST", lostNote.trim() ? `${lostReason} — ${lostNote.trim()}` : lostReason); }}>Mark lost</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="sr-only"><Link href="/leads">Leads</Link></p>
    </AdminLayout>
  );
}
