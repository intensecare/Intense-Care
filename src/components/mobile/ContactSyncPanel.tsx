"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Smartphone, RefreshCw, Pause, Play, Unplug, Users, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Pill, Stat, callApi } from "@/components/biz/Bits";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/mobile/platform";
import { ContactSync, type NativeSyncStatus } from "@/lib/mobile/contact-sync";
import { deviceId, patchThisDevice, registerThisDevice } from "@/lib/mobile/device";
import type { ContactSyncStatus } from "@/lib/contacts";

const when = (t: number | string | null | undefined) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never");
const ERR: Record<string, string> = {
  PERMISSION_DENIED: "Contacts permission is off.",
  NO_NETWORK: "No internet connection.",
  AUTH: "This phone's connection to the ERP expired. Disconnect and connect again.",
  SERVER: "The ERP couldn't be reached.",
  READ_FAILED: "The phone's contacts couldn't be read.",
};

/**
 * The Contact Sync screen: status + controls. The sync itself is done by native Android code (WorkManager),
 * so it keeps running when this page is closed — Android decides exactly when, so no fixed interval is promised.
 */
export function ContactSyncPanel({ onReviewDuplicates, onChanged }: { onReviewDuplicates: () => void; onChanged: () => void }) {
  const { currentUser } = useAuth();
  const native = typeof window !== "undefined" && isNativeApp();
  const [local, setLocal] = useState<NativeSyncStatus | null>(null);
  const [server, setServer] = useState<ContactSyncStatus | null>(null);
  const [rationale, setRationale] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [deleteToo, setDeleteToo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (native) setLocal(await ContactSync.getStatus().catch(() => null));
    const id = await deviceId();
    const r = await callApi<ContactSyncStatus>(`/api/mobile/contacts/status?deviceId=${encodeURIComponent(id)}`);
    if (r.data) setServer(r.data);
  }, [native]);

  useEffect(() => {
    void refresh();
    if (!native) return;
    let handle: { remove: () => Promise<void> } | null = null;
    ContactSync.addListener("syncState", (s) => {
      setLocal(s);
      if (!s.running) void refresh();
    }).then((h) => (handle = h)).catch(() => {});
    const t = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.clearInterval(t);
      void handle?.remove();
    };
  }, [native, refresh]);

  if (!native) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 mb-6">
        <div className="flex items-center gap-2 font-semibold text-zinc-950"><Smartphone className="h-5 w-5 text-rose-600" aria-hidden /> Contact sync</div>
        <p className="text-sm text-zinc-600 mt-1.5">Contacts are synced from the Intense Care Android app (Contacts → Contact sync). Open the app on the phone to connect it. Connected phones are listed below.</p>
      </section>
    );
  }

  const connected = !!local?.enabled && !!server?.connected;
  const perm = local?.permission ?? "prompt";
  const run = server?.lastRun;
  const stale = connected && !local?.paused && server?.lastSuccessAt && Date.now() - new Date(server.lastSuccessAt).getTime() > 24 * 3600 * 1000;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "That didn't work. Try again." });
    }
    setBusy(null);
    await refresh();
    onChanged();
  };

  const start = () =>
    act("start", async () => {
      setRationale(false);
      const p = await ContactSync.requestPermission();
      if (p.permission !== "granted") {
        setMsg({ tone: "error", text: p.blocked ? "Contacts permission was refused. Open Android Settings → Apps → Intense Care → Permissions → Contacts, allow it, then connect again." : "Contacts permission was not given, so nothing was synced. You can try again whenever you like." });
        return;
      }
      const reg = await registerThisDevice({ syncToken: true, label: "Android app" });
      if (reg.error || !reg.data?.syncToken) throw new Error(reg.error ?? "Could not connect this phone.");
      await ContactSync.enable({ baseUrl: window.location.origin, token: reg.data.syncToken, userId: currentUser!.id });
      await ContactSync.syncNow({ trigger: "INITIAL" });
      setMsg({ tone: "success", text: "Connected. The first import is running — you can leave this screen." });
    });

  const pause = () =>
    act("pause", async () => {
      if (local?.paused) {
        await patchThisDevice({ syncPaused: false });
        await ContactSync.resume();
      } else {
        await patchThisDevice({ syncPaused: true });
        await ContactSync.pause();
      }
    });

  const doDisconnect = () =>
    act("disconnect", async () => {
      setDisconnect(false);
      const id = await deviceId();
      const r = await callApi("/api/mobile/devices/revoke", { method: "POST", json: { deviceId: id, deleteContacts: deleteToo } });
      if (r.error && r.status !== 404) throw new Error(r.error);
      await ContactSync.disable();
      setMsg({ tone: "success", text: deleteToo ? "Disconnected. The contacts this phone uploaded were deleted from the ERP. Customers and leads were not touched." : "Disconnected. Contacts already uploaded stay in the ERP directory." });
    });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 mb-6 space-y-4" aria-label="Contact sync">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-zinc-950"><Smartphone className="h-5 w-5 text-rose-600" aria-hidden /> Contact sync</div>
        {!connected ? <Pill>Not connected</Pill> : local?.paused ? <Pill tone="warn">Paused</Pill> : local?.running ? <Pill tone="info">Syncing…</Pill> : perm !== "granted" ? <Pill tone="bad">Permission needed</Pill> : <Pill tone="good">On</Pill>}
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {connected && perm !== "granted" && (
        <Notice tone="error">
          Contacts permission is off, so syncing is stopped. {local?.permissionBlocked ? "Open Android Settings → Apps → Intense Care → Permissions → Contacts and allow it." : "Allow it to continue."}{" "}
          <button className="font-semibold underline" onClick={() => void (local?.permissionBlocked ? ContactSync.openAppSettings() : act("perm", async () => void (await ContactSync.requestPermission())))}>{local?.permissionBlocked ? "Open settings" : "Allow contacts"}</button>
        </Notice>
      )}
      {stale && <Notice tone="info">The last successful sync was {when(server?.lastSuccessAt)}. Android can delay background work when the phone is idle or in battery saver. Tap Sync Now, or just open the app, to catch up.</Notice>}
      {run?.errorCode && connected && <Notice tone="error">Last attempt failed: {ERR[run.errorCode] ?? run.errorCode}. It will be tried again automatically.</Notice>}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">Sync this phone's contacts into the ERP so the team can recognise customers and follow up enquiries. Nothing is changed on the phone, and nothing becomes a customer or lead unless you choose.</p>
          <Button onClick={() => setRationale(true)} loading={busy === "start"}><Users className="h-4 w-4" aria-hidden /> Turn on contact sync</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Last successful sync" value={when(server?.lastSuccessAt)} />
            <Stat label="Next attempt" value={local?.paused ? "Paused" : local?.nextAttemptAt ? `around ${when(local.nextAttemptAt)}` : "Soon"} hint="Android decides the exact time" />
            <Stat label="Contacts scanned" value={run?.scanned ?? local?.lastRun?.scanned ?? 0} hint={local?.contactsOnPhone != null ? `${local.contactsOnPhone} on this phone` : undefined} />
            <Stat label="In ERP directory" value={server?.activeContacts ?? 0} />
            <Stat label="Added" value={run?.added ?? 0} />
            <Stat label="Updated" value={run?.updated ?? 0} />
            <Stat label="Possible duplicates" value={server?.potentialDuplicates ?? 0} tone={server?.potentialDuplicates ? "warn" : undefined} />
            <Stat label="Failed" value={(run?.failed ?? 0) + (local?.failedRecords ?? 0)} tone={run?.failed || local?.failedRecords ? "bad" : undefined} hint={local?.pendingBatches ? `${local.pendingBatches} batch(es) waiting to send` : undefined} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void act("now", async () => void (await ContactSync.syncNow({ trigger: "MANUAL" })))} loading={busy === "now" || !!local?.running} disabled={!!local?.paused || perm !== "granted"}><RefreshCw className="h-4 w-4" aria-hidden /> Sync now</Button>
            <Button variant="outline" onClick={() => void act("retry", async () => void (await ContactSync.retryFailed()))} disabled={!local?.pendingBatches && !local?.failedRecords}>Retry failed</Button>
            <Button variant="outline" onClick={onReviewDuplicates}><AlertTriangle className="h-4 w-4" aria-hidden /> Review duplicates</Button>
            <Button variant="outline" onClick={() => void pause()} loading={busy === "pause"}>{local?.paused ? <><Play className="h-4 w-4" aria-hidden /> Resume sync</> : <><Pause className="h-4 w-4" aria-hidden /> Pause sync</>}</Button>
            <Button variant="outline" className="text-red-700" onClick={() => setDisconnect(true)}><Unplug className="h-4 w-4" aria-hidden /> Disconnect sync</Button>
          </div>
          <p className="text-xs text-zinc-500 flex items-start gap-1.5"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Contacts travel over HTTPS to your ERP only. Pausing or disconnecting stops uploads immediately.</p>
        </>
      )}

      <Dialog open={rationale} onOpenChange={setRationale}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allow Intense Care to read your contacts?</DialogTitle>
            <DialogDescription>Android will ask for permission next.</DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-zinc-700 space-y-2 list-disc pl-5">
            <li>Names, phone numbers and emails from this phone are copied to your ERP&apos;s <strong>Contacts</strong> list.</li>
            <li>New and changed contacts are picked up automatically in the background, whenever Android allows.</li>
            <li>Existing customers are recognised by phone number — nobody is duplicated or merged by name.</li>
            <li>Contacts do <strong>not</strong> become leads unless an Admin chooses (Settings on this screen).</li>
            <li>You can pause or disconnect at any time, and optionally delete what was uploaded.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRationale(false)}>Not now</Button>
            <Button onClick={() => void start()}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnect} onOpenChange={setDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect contact sync?</DialogTitle>
            <DialogDescription>This phone stops uploading contacts straight away.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm text-zinc-800">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={deleteToo} onChange={(e) => setDeleteToo(e.target.checked)} />
            <span>Also delete the contacts this phone uploaded from the ERP directory. Customers and leads are never deleted.</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnect(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void doDisconnect()}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
