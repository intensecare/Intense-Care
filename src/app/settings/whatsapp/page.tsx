"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, XCircle, RefreshCw, Copy, PlugZap, FileText } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Pill, callApi, useApiList } from "@/components/biz/Bits";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/utils";
import type { WhatsAppHealth } from "@/lib/server/whatsapp/config";

const section = "rounded-2xl border border-zinc-200 bg-white p-5 space-y-3";
const when = (iso: string | null) => (iso ? formatDateTime(iso) : "never");

function SecretRow({ name, set, what }: { name: string; set: boolean; what: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3">
      <span className="min-w-0"><code className="text-sm font-semibold text-zinc-950">{name}</code><span className="block text-sm text-zinc-500">{what}</span></span>
      {set ? <Pill tone="good"><CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden />Configured</Pill> : <Pill tone="bad"><XCircle className="h-3.5 w-3.5 mr-1" aria-hidden />Not set</Pill>}
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const { can } = useAuth();
  const h = useApiList<WhatsAppHealth>(() => "/api/integrations/whatsapp", []);
  const [waba, setWaba] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const d = h.data;
  useEffect(() => { if (d) { setWaba(d.ids.wabaId ?? ""); setPhone(d.ids.phoneNumberId ?? ""); } }, [d?.ids.wabaId, d?.ids.phoneNumberId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can("integrations.manage")) return <AdminLayout><Notice tone="error">Only an Admin can manage the WhatsApp integration.</Notice></AdminLayout>;
  if (h.error) return <AdminLayout><ErrorState message={h.error} onRetry={() => void h.reload()} /></AdminLayout>;
  if (!d) return <AdminLayout><SkeletonList rows={4} /></AdminLayout>;

  const run = async (key: string, url: string, init: RequestInit & { json?: unknown }, done: (data: Record<string, unknown>) => string) => {
    setBusy(key); setMsg(null);
    const r = await callApi<Record<string, unknown>>(url, init);
    setBusy(null);
    if (r.error) setMsg({ tone: "error", text: r.error });
    else setMsg({ tone: "success", text: done(r.data ?? {}) });
    await h.reload();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(d.webhook.callbackUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-4 pb-10">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10"><ChevronLeft className="h-4 w-4" aria-hidden /> Settings</Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-zinc-950">WhatsApp Business (Meta Cloud API)</h1>
          {d.ready ? <Pill tone="good">Ready</Pill> : <Pill tone="warn">Needs attention</Pill>}
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {d.problems.length > 0 && (
          <Notice tone="warning">
            <strong className="block mb-1">What to fix</strong>
            <ul className="list-disc pl-5 space-y-1">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </Notice>
        )}

        <section className={section} aria-labelledby="wa-sec">
          <h2 id="wa-sec" className="font-semibold text-zinc-950">Credentials (server environment)</h2>
          <p className="text-sm text-zinc-600">These are stored only as environment variables / your secret manager on the server. They are never shown here, stored in the database or sent to browsers or phones — only whether they are set.</p>
          <SecretRow name="WHATSAPP_ACCESS_TOKEN" set={d.secrets.accessToken} what="Permanent system-user token (whatsapp_business_messaging + whatsapp_business_management)." />
          <SecretRow name="WHATSAPP_APP_SECRET" set={d.secrets.appSecret} what="Meta app secret — used to verify the signature of every webhook post." />
          <SecretRow name="WHATSAPP_WEBHOOK_VERIFY_TOKEN" set={d.secrets.verifyToken} what="A random string you choose; Meta sends it once to verify the callback URL." />
        </section>

        <section className={section} aria-labelledby="wa-ids">
          <h2 id="wa-ids" className="font-semibold text-zinc-950">Account IDs</h2>
          <form className="grid sm:grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void run("ids", "/api/integrations/whatsapp", { method: "PATCH", json: { wabaId: waba, phoneNumberId: phone } }, () => "IDs saved."); }}>
            <Field label="Phone Number ID" htmlFor="wa-pn" hint={d.ids.phoneSource === "env" ? "Currently from the server environment." : "WhatsApp Manager → API setup."}><Input id="wa-pn" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="WhatsApp Business Account ID" htmlFor="wa-waba" hint={d.ids.wabaSource === "env" ? "Currently from the server environment." : "Needed to sync message templates."}><Input id="wa-waba" inputMode="numeric" value={waba} onChange={(e) => setWaba(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Button type="submit" loading={busy === "ids"}>Save IDs</Button></div>
          </form>
        </section>

        <section className={section} aria-labelledby="wa-hook">
          <h2 id="wa-hook" className="font-semibold text-zinc-950">Webhook</h2>
          <p className="text-sm text-zinc-600">In Meta for Developers → your app → WhatsApp → Configuration, set the callback URL below, enter your verify token, then subscribe to the <strong>messages</strong> field (this carries incoming messages and delivery statuses).</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-zinc-100 px-3 py-2 text-sm">{d.webhook.callbackUrl}</code>
            <Button type="button" variant="secondary" onClick={() => void copy()} aria-label="Copy callback URL"><Copy className="h-4 w-4" aria-hidden /> {copied ? "Copied" : "Copy"}</Button>
          </div>
          {!d.webhook.callbackUrl.startsWith("https://") && <Notice tone="warning">Meta requires a public HTTPS address. Set APP_BASE_URL to your https domain.</Notice>}
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-zinc-500">Meta verified the URL</dt><dd className="font-medium">{when(d.webhook.lastVerifiedAt)}</dd></div>
            <div><dt className="text-zinc-500">Last webhook received</dt><dd className="font-medium">{when(d.webhook.lastReceivedAt)}</dd></div>
            <div><dt className="text-zinc-500">Last event processed</dt><dd className="font-medium">{when(d.webhook.lastProcessedAt)}</dd></div>
            <div><dt className="text-zinc-500">Last rejected (bad signature)</dt><dd className="font-medium">{when(d.webhook.lastSignatureFailureAt)}</dd></div>
          </dl>
        </section>

        <section className={section} aria-labelledby="wa-conn">
          <h2 id="wa-conn" className="font-semibold text-zinc-950 flex items-center gap-2">Connection {d.connection.status === "CONNECTED" ? <Pill tone="good">Connected</Pill> : d.connection.status === "ERROR" ? <Pill tone="bad">Error</Pill> : <Pill>Not tested</Pill>}</h2>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-zinc-500">Business number</dt><dd className="font-medium">{d.connection.displayPhone ?? "—"}</dd></div>
            <div><dt className="text-zinc-500">Verified name</dt><dd className="font-medium">{d.connection.verifiedName ?? "—"}</dd></div>
            <div><dt className="text-zinc-500">Quality rating</dt><dd className="font-medium">{d.connection.qualityRating ?? "—"}</dd></div>
            <div><dt className="text-zinc-500">Last tested</dt><dd className="font-medium">{when(d.connection.checkedAt)}</dd></div>
          </dl>
          {d.connection.error && <Notice tone="error">{d.connection.error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={busy === "test"} onClick={() => void run("test", "/api/integrations/whatsapp", { method: "POST", json: { action: "test" } }, (x) => ((x.test as { message: string }).message))}><PlugZap className="h-4 w-4" aria-hidden /> Test connection</Button>
            <Button type="button" variant="secondary" loading={busy === "tpl"} onClick={() => void run("tpl", "/api/integrations/whatsapp", { method: "POST", json: { action: "sync-templates" } }, (x) => `${x.synced} template(s) synced.`)}><FileText className="h-4 w-4" aria-hidden /> Sync templates</Button>
            <Button type="button" variant="ghost" onClick={() => void h.reload()}><RefreshCw className="h-4 w-4" aria-hidden /> Refresh</Button>
          </div>
        </section>

        <section className={section} aria-labelledby="wa-q">
          <h2 id="wa-q" className="font-semibold text-zinc-950">Health</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {([["Events waiting", d.queue.pendingEvents], ["Events failed", d.queue.failedEvents], ["Attachments downloading", d.queue.pendingMedia], ["Attachments failed", d.queue.failedMedia], ["Send failures (24 h)", d.queue.failedOutbound24h], ["No delivery update >15 min", d.queue.stuckAccepted]] as const).map(([l, v]) => (
              <div key={l} className="rounded-xl border border-zinc-200 p-3"><dt className="text-zinc-500">{l}</dt><dd className={v ? "text-lg font-semibold text-amber-700" : "text-lg font-semibold text-zinc-950"}>{v}</dd></div>
            ))}
          </dl>
          <p className="text-sm text-zinc-500">Meta charges per template conversation category (marketing, utility, authentication, service) and may add taxes; free-form replies inside the 24-hour customer-service window are not charged per message. See docs/WHATSAPP.md.</p>
        </section>
      </div>
    </AdminLayout>
  );
}
