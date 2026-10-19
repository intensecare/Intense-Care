"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Users, Download, UserPlus, Search } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/data-table";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SelectField, Pill, useApiList, callApi, csvUrl } from "@/components/biz/Bits";
import { ContactSyncPanel } from "@/components/mobile/ContactSyncPanel";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import type { ContactRow } from "@/lib/server/contacts-directory";
import type { ContactSyncStatus } from "@/lib/contacts";

interface ListResponse { rows: ContactRow[]; total: number; page: number; pageSize: number }
interface DupResponse { sharedNumbers: { phone: string; contacts: { id: string; name: string }[] }[]; multipleCustomers: { id: string; name: string; customers: { id: string; name: string }[] }[] }
interface DeviceRow { id: string; owner: string; appVersion: string | null; lastSeenAt: string | null; status: ContactSyncStatus }

export default function ContactsPage() {
  const { can } = useAuth();
  const manage = can("contacts.manage");
  const [tab, setTab] = useState<"directory" | "duplicates" | "phones" | "settings">("directory");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [link, setLink] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [purge, setPurge] = useState<DeviceRow | null>(null);

  const list = useApiList<ListResponse>(() => csvUrl("/api/contacts", { q: q.trim(), status, link, page: String(page), pageSize: "25" }), [q, status, link, page]);
  const dups = useApiList<DupResponse>(() => "/api/contacts/duplicates", []);
  const phones = useApiList<DeviceRow[]>(() => "/api/contacts/devices", []);
  const settings = useApiList<{ contactSync: ContactSyncStatus["policy"] }>(() => "/api/settings", []);
  const [policy, setPolicy] = useState<string>("");
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [days, setDays] = useState<string>("");

  const reloadAll = () => { list.reload(); dups.reload(); phones.reload(); };
  const chosen = Object.keys(sel).filter((k) => sel[k]);

  const importLeads = async () => {
    const r = await callApi<{ created: number; linked: number; alreadyImported: number; alreadyCustomer: number; failed: number }>("/api/contacts/import-leads", { method: "POST", json: { ids: chosen } });
    if (r.error || !r.data) return setFlash({ tone: "error", text: r.error ?? "Import failed." });
    const d = r.data;
    setFlash({ tone: "success", text: `${d.created} lead(s) created. ${d.alreadyCustomer} already customers, ${d.alreadyImported + d.linked} already leads${d.failed ? `, ${d.failed} failed` : ""}.` });
    setSel({});
    reloadAll();
  };

  const saveSettings = async () => {
    const cs = settings.data?.contactSync;
    const body: Record<string, unknown> = {};
    if (policy && policy !== cs?.leadPolicy) { body.leadPolicy = policy; if (policy === "AUTO_NEW_CONTACTS") body.confirmAutoLeads = confirmAuto; }
    if (days && Number(days) !== cs?.removedRetentionDays) body.removedRetentionDays = Number(days);
    const r = await callApi("/api/settings", { method: "PATCH", json: { contactSync: body } });
    setFlash(r.error ? { tone: "error", text: r.error } : { tone: "success", text: "Contact settings saved." });
    settings.reload();
  };

  const dismiss = async (ids: string[]) => {
    await callApi("/api/contacts/duplicates", { method: "POST", json: { contactIds: ids } });
    dups.reload();
    list.reload();
  };

  const rows = list.data?.rows ?? [];
  const cs = settings.data?.contactSync;

  return (
    <AdminLayout>
      <PageHeader title="Contacts" description="People from the phones that sync with the ERP. Contacts are kept separate from customers and leads until you choose to import them." actions={<a href={csvUrl("/api/contacts", { q: q.trim(), status, link, format: "csv" })}><Button variant="outline"><Download className="h-4 w-4" aria-hidden /> Export CSV</Button></a>} />

      <ContactSyncPanel onReviewDuplicates={() => setTab("duplicates")} onChanged={reloadAll} />
      {flash && <Notice tone={flash.tone} className="mb-4">{flash.text}</Notice>}

      <div role="tablist" className="flex flex-wrap gap-2 mb-4">
        {([["directory", "Directory"], ["duplicates", `Duplicates${dups.data ? ` (${dups.data.sharedNumbers.length + dups.data.multipleCustomers.length})` : ""}`], ["phones", "Connected phones"], ["settings", "Settings"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-10 px-4 rounded-xl text-sm font-semibold border ${tab === k ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-700 border-zinc-300"}`}>{label}</button>
        ))}
      </div>

      {tab === "directory" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="col-span-2 relative"><Search className="h-4 w-4 absolute left-3 top-3.5 text-zinc-400" aria-hidden /><Input aria-label="Search contacts" className="pl-9" placeholder="Name, number or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
            <SelectField label="" id="c-status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}><option value="ACTIVE">On the phone</option><option value="REMOVED">Removed from phone</option><option value="ALL">All</option></SelectField>
            <SelectField label="" id="c-link" value={link} onChange={(v) => { setLink(v); setPage(1); }}><option value="">All contacts</option><option value="customer">Already customers</option><option value="lead">Already leads</option><option value="none">Not yet a customer or lead</option></SelectField>
          </div>
          {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
          {list.loading && !list.data && <SkeletonList rows={5} />}
          {!list.loading && rows.length === 0 && !list.error && <EmptyState icon={Users} title="No contacts yet" description="Turn on contact sync in the Android app, or change the filters." />}
          <ul className="space-y-2">
            {rows.map((c) => (
              <li key={c.id} className="rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 flex items-start gap-3">
                {manage && !c.customer && !c.lead && c.status === "ACTIVE" && <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" aria-label={`Select ${c.name}`} checked={!!sel[c.id]} onChange={(e) => setSel((s) => ({ ...s, [c.id]: e.target.checked }))} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-zinc-950">{c.name}</span>
                    {c.customer && <Link href={`/customers/${c.customer.id}`}><Pill tone="good">Customer: {c.customer.name}</Pill></Link>}
                    {c.lead && <Link href={`/leads/${c.lead.id}`}><Pill tone="info">Lead {c.lead.leadNumber}</Pill></Link>}
                    {c.duplicate && <Pill tone="warn">Possible duplicate</Pill>}
                    {c.ambiguousCustomers.length > 1 && <Pill tone="warn">Matches {c.ambiguousCustomers.length} customers</Pill>}
                    {c.status === "REMOVED" && <Pill tone="neutral">Removed from phone</Pill>}
                  </div>
                  <div className="text-sm text-zinc-600 break-words">{c.phones.join(" · ")}{c.emails.length ? ` · ${c.emails.join(", ")}` : ""}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{c.deviceLabel ?? "Phone"} · added {formatDate(c.firstSyncedAt)} · last synced {formatDate(c.lastSyncedAt)}</div>
                </div>
              </li>
            ))}
          </ul>
          {list.data && <Pager page={list.data.page} pages={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
          {manage && chosen.length > 0 && (
            <div className="sticky bottom-3 mt-4 rounded-2xl border border-zinc-300 bg-white shadow-lg p-3 flex flex-wrap items-center gap-3 z-10">
              <span className="text-sm font-semibold">{chosen.length} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSel({})}>Clear</Button>
              <Button className="ml-auto" onClick={() => void importLeads()}><UserPlus className="h-4 w-4" aria-hidden /> Import as leads</Button>
            </div>
          )}
        </>
      )}

      {tab === "duplicates" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">Nothing here is merged automatically. Contacts that share a number may be a duplicate card or one number used by two people.</p>
          {dups.loading && !dups.data && <SkeletonList rows={3} />}
          {dups.data && dups.data.sharedNumbers.length + dups.data.multipleCustomers.length === 0 && <EmptyState icon={Users} title="No duplicates to review" description="Contacts that share a number show up here." />}
          {dups.data?.sharedNumbers.map((g) => (
            <div key={g.phone} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="font-semibold text-zinc-950">{g.phone}</div>
              <div className="text-sm text-zinc-600">Shared by: {g.contacts.map((c) => c.name).join(", ")}</div>
              {manage && <Button size="sm" variant="outline" className="mt-2" onClick={() => void dismiss(g.contacts.map((c) => c.id))}>These are different people — dismiss</Button>}
            </div>
          ))}
          {dups.data?.multipleCustomers.map((m) => (
            <div key={m.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="font-semibold text-amber-900">{m.name} matches several customers</div>
              <div className="text-sm text-amber-900 mt-1 flex flex-wrap gap-2">{m.customers.map((c) => (
                manage ? <Button key={c.id} size="sm" variant="outline" onClick={async () => { await callApi(`/api/contacts/${m.id}`, { method: "PATCH", json: { customerId: c.id } }); reloadAll(); }}>Link to {c.name}</Button> : <span key={c.id}>{c.name}</span>
              ))}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "phones" && (
        <div className="space-y-3">
          {phones.loading && !phones.data && <SkeletonList rows={2} />}
          {phones.data?.length === 0 && <EmptyState icon={Users} title="No phones connected" description="Connect a phone from the Android app." />}
          {phones.data?.map((d) => (
            <div key={d.id} className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-zinc-950">{d.owner} {d.status.connected ? (d.status.paused ? <Pill tone="warn">Paused</Pill> : <Pill tone="good">Connected</Pill>) : <Pill>Disconnected</Pill>}</div>
                <div className="text-sm text-zinc-600">{d.status.activeContacts} contacts · last sync {d.status.lastSuccessAt ? formatDate(d.status.lastSuccessAt) : "never"}{d.appVersion ? ` · app ${d.appVersion}` : ""}</div>
              </div>
              {manage && <Button variant="outline" size="sm" className="text-red-700" onClick={() => setPurge(d)}>Disconnect / delete contacts</Button>}
            </div>
          ))}
        </div>
      )}

      {tab === "settings" && cs && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 max-w-xl">
          <SelectField label="What happens to synced contacts" id="c-policy" value={policy || cs.leadPolicy} onChange={setPolicy} hint="Default: contacts only go to this directory. You import the ones you want as leads.">
            <option value="DIRECTORY_ONLY">Directory only (recommended)</option>
            <option value="AUTO_NEW_CONTACTS">Also create a lead for each NEW contact that appears after this is approved</option>
          </SelectField>
          {(policy || cs.leadPolicy) === "AUTO_NEW_CONTACTS" && cs.leadPolicy !== "AUTO_NEW_CONTACTS" && (
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirmAuto} onChange={(e) => setConfirmAuto(e.target.checked)} /><span>I approve automatic leads. Existing customers and contacts already on the phone are never turned into leads; the first import never creates leads. My name and the time are recorded.</span></label>
          )}
          {cs.autoLeadApprovedBy && <p className="text-xs text-zinc-500">Automatic leads approved by {cs.autoLeadApprovedBy} on {formatDate(cs.autoLeadApprovedAt!)}.</p>}
          <div>
            <label htmlFor="c-days" className="text-sm font-medium text-zinc-800">Keep contacts removed from the phone for (days)</label>
            <Input id="c-days" type="number" min={1} max={3650} value={days || String(cs.removedRetentionDays)} onChange={(e) => setDays(e.target.value)} />
            <p className="text-xs text-zinc-500 mt-1">After this, they are deleted from the directory. Customers and leads are never deleted by sync.</p>
          </div>
          <Button onClick={() => void saveSettings()} disabled={!manage || ((policy || cs.leadPolicy) === "AUTO_NEW_CONTACTS" && cs.leadPolicy !== "AUTO_NEW_CONTACTS" && !confirmAuto)}>Save</Button>
        </div>
      )}

      <Dialog open={!!purge} onOpenChange={(o) => !o && setPurge(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{purge?.owner}&apos;s phone</DialogTitle><DialogDescription>Customers and leads are never deleted by these actions.</DialogDescription></DialogHeader>
          <DialogFooter className="flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setPurge(null)}>Cancel</Button>
            <Button variant="outline" onClick={async () => { await callApi("/api/mobile/devices/revoke", { method: "POST", json: { rowId: purge!.id } }); setPurge(null); reloadAll(); }}>Disconnect only</Button>
            <Button variant="destructive" onClick={async () => { await callApi("/api/mobile/devices/revoke", { method: "POST", json: { rowId: purge!.id, deleteContacts: true } }); setPurge(null); reloadAll(); }}>Disconnect &amp; delete contacts</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
