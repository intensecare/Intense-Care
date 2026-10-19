"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, Trash2, RefreshCw, Smartphone, UploadCloud, Camera, MapPin, Users } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { MobileLayout } from "@/components/common/MobileLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Pill, callApi } from "@/components/biz/Bits";
import { useAuth } from "@/lib/auth-context";
import { formatBytes } from "@/lib/media";
import { APP_VERSION, isNativeApp } from "@/lib/mobile/platform";
import { clearCache, storageInfo, type StorageInfo } from "@/lib/mobile/device-storage";
import { drainQueue, listQueue, removeQueued, retryFailedUploads, type QueuedPhoto } from "@/lib/mobile/upload-queue";
import { pushPermission, registerForPush, requestPushPermission, type PushPermission } from "@/lib/mobile/push";
import { patchThisDevice, registerThisDevice } from "@/lib/mobile/device";
import { ContactSync } from "@/lib/mobile/contact-sync";
import { useRouter } from "next/navigation";

export default function DeviceStoragePage() {
  const { workspace } = useAuth();
  const body = <Content />;
  return workspace.layout === "mobile" ? <MobileLayout title="Device storage" subtitle="This phone" backHref="/my-jobs?tab=profile">{body}</MobileLayout> : (
    <AdminLayout>
      <PageHeader title="Device storage" description="What this phone is keeping for the app: temporary files, photos waiting to upload, and notification settings." />
      {body}
    </AdminLayout>
  );
}

function Content() {
  const router = useRouter();
  const native = typeof window !== "undefined" && isNativeApp();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [push, setPush] = useState<PushPermission>("unsupported");
  const [perms, setPerms] = useState<{ camera: string; location: string; contacts: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [rationale, setRationale] = useState(false);
  const [removing, setRemoving] = useState<QueuedPhoto | null>(null);

  const refresh = useCallback(async () => {
    setInfo(await storageInfo());
    setQueue(await listQueue().catch(() => []));
    setPush(await pushPermission());
    if (native) {
      try {
        const [{ Camera }, { Geolocation }, c] = await Promise.all([import("@capacitor/camera"), import("@capacitor/geolocation"), ContactSync.getStatus()]);
        setPerms({ camera: (await Camera.checkPermissions()).camera, location: (await Geolocation.checkPermissions()).location, contacts: c.permission });
      } catch {}
    }
  }, [native]);

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener("ic:uploads", on);
    return () => window.removeEventListener("ic:uploads", on);
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "That didn't work." });
    }
    setBusy(null);
    await refresh();
  };

  const pending = queue.filter((q) => q.status !== "FAILED");
  const failed = queue.filter((q) => q.status === "FAILED");
  const queueBytes = queue.reduce((a, q) => a + q.bytes, 0);

  const enablePush = () =>
    run("push", async () => {
      setRationale(false);
      const p = await requestPushPermission();
      if (p !== "granted") {
        setMsg({ tone: "error", text: "Notifications are off. You can allow them in Android Settings → Apps → Intense Care → Notifications." });
        return;
      }
      await registerThisDevice();
      await patchThisDevice({ notificationsEnabled: true });
      const ok = await registerForPush((r) => router.push(r), () => {});
      setMsg(ok ? { tone: "success", text: "Notifications are on for this phone." } : { tone: "error", text: "Couldn't register this phone for notifications." });
    });

  return (
    <div className="space-y-4 max-w-2xl">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-1">
        <div className="flex items-center gap-2 font-semibold text-zinc-950"><Smartphone className="h-5 w-5 text-rose-600" aria-hidden /> This device</div>
        <div className="text-sm text-zinc-600">{native ? "Intense Care Android app" : "Web browser"} · version {APP_VERSION}</div>
        {info?.freeBytes != null && <div className="text-sm text-zinc-600">Free space on the phone: {formatBytes(info.freeBytes)}</div>}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-zinc-950"><UploadCloud className="h-5 w-5 text-rose-600" aria-hidden /> Photos waiting to upload</div>
        {queue.length === 0 ? <p className="text-sm text-zinc-600">Nothing is waiting. Every photo you took has been saved on the server.</p> : (
          <>
            <p className="text-sm text-zinc-600">{pending.length} waiting · {failed.length} failed · {formatBytes(queueBytes)}. These are kept on this phone at full quality until the server confirms them. Signing out does not delete them.</p>
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              {queue.map((q) => (
                <li key={q.id} className="p-3 text-sm flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-900">{q.area} · {q.photoType} <Pill tone={q.status === "FAILED" ? "bad" : q.status === "UPLOADING" ? "info" : "warn"}>{q.status === "FAILED" ? "Failed" : q.status === "UPLOADING" ? "Uploading" : "Waiting"}</Pill></div>
                    <div className="text-zinc-500">{formatBytes(q.bytes)} · {new Date(q.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{q.attempts ? ` · ${q.attempts} attempt(s)` : ""}</div>
                    {q.lastError && <div className="text-red-700">{q.lastError}</div>}
                  </div>
                  <button className="text-zinc-500 p-2 -m-2" aria-label="Remove this photo from the phone" onClick={() => setRemoving(q)}><Trash2 className="h-4 w-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void run("up", async () => void (await drainQueue()))} loading={busy === "up"} disabled={pending.length === 0}><RefreshCw className="h-4 w-4" aria-hidden /> Upload now</Button>
              <Button variant="outline" onClick={() => void run("retry", async () => void (await retryFailedUploads()))} loading={busy === "retry"} disabled={failed.length === 0}>Retry failed</Button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
        <div className="font-semibold text-zinc-950">Storage on this phone</div>
        <dl className="text-sm grid grid-cols-[1fr_auto] gap-y-1.5">
          <dt className="text-zinc-600">Temporary cache (images, downloads)</dt><dd className="font-medium">{info?.cacheBytes != null ? formatBytes(info.cacheBytes) : "—"}</dd>
          <dt className="text-zinc-600">Photos waiting to upload</dt><dd className="font-medium">{formatBytes(queueBytes)}</dd>
          <dt className="text-zinc-600">App data (kept)</dt><dd className="font-medium">{info?.filesBytes != null ? formatBytes(info.filesBytes) : info?.webUsage != null ? formatBytes(info.webUsage) : "—"}</dd>
        </dl>
        <p className="text-xs text-zinc-500">Clearing the cache removes only files the app can download again. It never removes your sign-in, photos waiting to upload, unsent contact changes or pending updates.</p>
        <Button variant="outline" onClick={() => setConfirmClear(true)}><Trash2 className="h-4 w-4" aria-hidden /> Clear temporary cache</Button>
      </section>

      {native && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-zinc-950"><Bell className="h-5 w-5 text-rose-600" aria-hidden /> Notifications</div>
          <p className="text-sm text-zinc-600">{push === "granted" ? "On. You'll be told about new jobs, reassignments, reminders and QC updates. Messages never show customer names, addresses or amounts." : push === "denied" ? "Off. Allow notifications for Intense Care in Android Settings to turn them on." : "Off. Turn them on to hear about new jobs and QC updates."}</p>
          <div className="flex flex-wrap gap-2">
            {push !== "granted" && push !== "denied" && <Button onClick={() => setRationale(true)} loading={busy === "push"}>Turn on notifications</Button>}
            {push === "granted" && <Button variant="outline" loading={busy === "test"} onClick={() => void run("test", async () => { const r = await callApi("/api/push/test", { method: "POST" }); setMsg(r.error ? { tone: "error", text: r.error } : { tone: "success", text: "Test notification sent." }); })}>Send test notification</Button>}
          </div>
        </section>
      )}

      {native && perms && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-2">
          <div className="font-semibold text-zinc-950">App permissions</div>
          {([["Camera", perms.camera, Camera, "Needed to photograph work."], ["Location", perms.location, MapPin, "Needed to verify you are at the job site."], ["Contacts", perms.contacts, Users, "Only if an Admin turns on contact sync."]] as const).map(([name, state, Icon, why]) => (
            <div key={name} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-400" aria-hidden />{name} <span className="text-zinc-500">— {why}</span></span><Pill tone={state === "granted" ? "good" : "neutral"}>{state === "granted" ? "Allowed" : "Not allowed"}</Pill></div>
          ))}
          <Button variant="outline" size="sm" onClick={() => void ContactSync.openAppSettings()}>Open Android settings</Button>
        </section>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clear temporary cache?</DialogTitle><DialogDescription>Only downloadable, temporary files are removed. Photos waiting to upload and your sign-in stay.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button><Button onClick={() => void run("clear", async () => { setConfirmClear(false); const r = await clearCache(); setMsg({ tone: "success", text: r.freedBytes ? `Freed ${formatBytes(r.freedBytes)}.` : "Cache cleared." }); })}>Clear cache</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rationale} onOpenChange={setRationale}>
        <DialogContent>
          <DialogHeader><DialogTitle>Turn on notifications?</DialogTitle><DialogDescription>Android will ask for permission next.</DialogDescription></DialogHeader>
          <p className="text-sm text-zinc-700">You&apos;ll get short alerts for new or changed job assignments, upcoming jobs, QC and rework. They never include customer names, addresses or amounts.</p>
          <DialogFooter><Button variant="outline" onClick={() => setRationale(false)}>Not now</Button><Button onClick={() => void enablePush()}>Continue</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this photo from the phone?</DialogTitle><DialogDescription>It has NOT been uploaded. Removing it deletes the only copy.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Keep it</Button><Button variant="destructive" onClick={() => void run("rm", async () => { await removeQueued(removing!.id); setRemoving(null); window.dispatchEvent(new Event("ic:uploads")); })}>Delete photo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
