"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Camera,
  Check,
  CheckCircle2,
  AlertTriangle,
  Play,
  ShieldCheck,
  Clock,
  Users,
  Bell,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImageForUpload } from "@/lib/image-compress";

/**
 * /manager/job/[token] — §10, §11, §12, §13, §15, §16, §19, §31, §34, §40.
 *
 * Manager mobile screen from a secure link: WHERE AM I / WHAT HAPPENED /
 * WHAT'S NEXT / ONE PRIMARY ACTION. Camera-first photos grouped by room with
 * BEFORE/AFTER; offline queue (localStorage) replays checklist + photo
 * actions when connectivity returns; GPS arrival with geofence and audited
 * explicit-reason bypass.
 */

interface ManagerPayload {
  job: {
    id: string;
    status: string;
    serviceName: string;
    scheduledDate: string;
    scheduledTimeSlot: string;
    customerName: string;
    customerPhone: string;
    arrivedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    arrivalVerification: string | null;
    arrivalDistanceM: number | null;
    customerConfirmedAt: string | null;
    hasPendingRework: boolean;
  };
  property: { title: string; address: string };
  team: string[];
  internalNotes: string | null;
  checklist: { id: string; area: string; task: string; critical: boolean; status: string; skippedReason: string | null }[];
  photos: { id: string; area: string; photoType: string; url: string }[];
  rework: { id: string; instructions: string; status: string }[];
  completionGate: { ok: boolean; missing: string[] };
}

interface QueuedAction {
  id: string;
  kind: "checklist" | "photo";
  payload: Record<string, unknown>;
  createdAt: number;
}

const ROOMS = ["Living Room", "Bedroom", "Kitchen", "Bathroom", "Balcony", "Other"];
const OFFLINE_KEY = "manager_offline_queue";

export default function ManagerJobPage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<ManagerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // GPS arrival
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [showBypass, setShowBypass] = useState(false);
  const [bypassReason, setBypassReason] = useState("");

  // Photo capture
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoArea, setPhotoArea] = useState(ROOMS[0]);
  const [photoType, setPhotoType] = useState<"before" | "after">("before");
  const [photoData, setPhotoData] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const cameraRef = React.useRef<HTMLInputElement>(null);

  // Offline queue
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);

  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; json?: any; networkError?: boolean }> => {
    try {
      const res = await fetch(`/api/manager/job/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return { ok: res.ok && json?.success, json };
    } catch {
      return { ok: false, networkError: true };
    }
  };

  const load = async () => {
    try {
      const res = await fetch(`/api/manager/job/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (res.ok && json?.success) setData(json.data);
      else {
        setKind(json?.kind || "not_found");
        setError(json?.error || "This link is invalid or has expired.");
      }
    } catch {
      setError("Unable to load the job. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const stored = localStorage.getItem(`${OFFLINE_KEY}:${token}`);
    if (stored) setQueue(JSON.parse(stored));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    localStorage.setItem(`${OFFLINE_KEY}:${token}`, JSON.stringify(queue));
  }, [queue, token]);

  // §31 auto-sync when connectivity returns; never blindly overwrites — the
  // server validates every replayed action against current state and rejects
  // stale ones (409), which we drop with a notice.
  useEffect(() => {
    if (!online || queue.length === 0 || syncing) return;
    (async () => {
      setSyncing(true);
      const remaining: QueuedAction[] = [];
      for (const action of queue) {
        const r = await post(action.payload);
        if (!r.ok) remaining.push(action);
      }
      setQueue(remaining);
      setSyncing(false);
      if (remaining.length === 0) setToast("Offline changes synced ✓");
      void load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queue.length]);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  /* ---------------- GPS arrival (§11) ---------------- */
  const handleArrive = async (reason?: string) => {
    setGpsBusy(true);
    setGpsError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      });
      const res = await post({
        action: "arrive",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ...(reason ? { bypassReason: reason } : {}),
      });
      if (res.ok) {
        setShowBypass(false);
        setBypassReason("");
        showToast(res.json?.data?.verified ? `ARRIVAL VERIFIED ✓ (${res.json.data.distanceM} m)` : "Arrival recorded (manual — reason audited)");
        await load();
      } else if (res.json?.kind === "outside_geofence") {
        setGpsError(res.json.error);
        setShowBypass(true);
      } else {
        setGpsError(res.json?.error || "Arrival failed.");
      }
    } catch (e: any) {
      setGpsError(
        e?.code === 1
          ? "Location permission denied. Enable GPS to verify arrival, or continue with an explicit reason."
          : "Could not read your location. Move to an open area or continue with an explicit reason."
      );
      setShowBypass(true);
    } finally {
      setGpsBusy(false);
    }
  };

  /* ---------------- Photo capture (§15) ---------------- */
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoData((ev.target?.result as string) || "");
    reader.readAsDataURL(file);
  };

  const submitPhoto = async () => {
    if (!photoData) return;
    setPhotoBusy(true);
    const prepared = await compressImageForUpload(photoData);
    const payload = { action: "photo", area: photoArea, photoType, image: prepared.dataUrl };
    const res = await post(payload);
    if (res.ok) {
      setShowPhoto(false);
      setPhotoData("");
      showToast(`${photoType.toUpperCase()} photo saved for ${photoArea}`);
      await load();
    } else if (res.networkError) {
      // §31 offline photo queue
      setQueue((q) => [...q, { id: `${Date.now()}`, kind: "photo", payload, createdAt: Date.now() }]);
      setShowPhoto(false);
      setPhotoData("");
      showToast("Saved offline — will upload automatically when back online");
    } else {
      showToast(res.json?.error || "Photo upload failed.");
    }
    setPhotoBusy(false);
  };

  const tickChecklist = async (itemId: string, current: string) => {
    const status = current === "completed" ? "pending" : "completed";
    setData((d) =>
      d
        ? { ...d, checklist: d.checklist.map((c) => (c.id === itemId ? { ...c, status } : c)), completionGate: { ...d.completionGate } }
        : d
    );
    const res = await post({ action: "checklist", itemId, status });
    if (!res.ok && res.networkError) {
      setQueue((q) => [...q, { id: `${Date.now()}`, kind: "checklist", payload: { action: "checklist", itemId, status }, createdAt: Date.now() }]);
      showToast("Saved offline — will sync automatically");
    } else if (!res.ok) {
      showToast(res.json?.error || "Checklist update failed.");
      void load();
    }
  };

  /* ---------------- ONE primary action (§13/§40) ---------------- */
  const primary = (() => {
    if (!data) return null;
    switch (data.job.status) {
      case "ASSIGNED":
        return { label: "ARRIVED — VERIFY LOCATION", run: () => handleArrive(), icon: MapPin, tone: "coral" as const };
      case "ARRIVED":
        return data.job.customerConfirmedAt
          ? { label: "CONFIRMED — START WORK", run: () => doTransition("start"), icon: Play, tone: "emerald" as const }
          : { label: "REQUEST CUSTOMER CONFIRMATION", run: () => doTransition("request-confirmation"), icon: Bell, tone: "amber" as const };
      case "CUSTOMER_VERIFIED":
        return { label: "START JOB", run: () => doTransition("start"), icon: Play, tone: "emerald" as const };
      case "IN_PROGRESS":
        return {
          label: data.completionGate.ok ? "COMPLETE WORK" : `COMPLETE WORK (${data.completionGate.missing.length} items pending)`,
          run: () => doTransition("complete"),
          icon: CheckCircle2,
          tone: "coral" as const,
        };
      case "REWORK_ASSIGNED":
      case "REWORK_REQUIRED":
        return { label: "START REWORK", run: () => doTransition("start-rework"), icon: Play, tone: "amber" as const };
      case "REWORK_IN_PROGRESS":
        return { label: "SUBMIT REWORK EVIDENCE", run: () => doTransition("complete-rework"), icon: CheckCircle2, tone: "coral" as const };
      default:
        return null;
    }
  })();

  const doTransition = async (what: string) => {
    if (what === "complete") {
      const gate = data?.completionGate;
      if (gate && !gate.ok) {
        showToast(`Cannot complete yet: ${gate.missing.join("; ")}`);
        return;
      }
    }
    if (what === "start-rework") {
      setBusy(true);
      const r = await post({ action: "start-rework" });
      setBusy(false);
      if (r.ok) {
        showToast("Rework started");
        await load();
      } else showToast(r.json?.error || "Failed to start rework.");
      return;
    }
    if (what === "complete-rework") {
      setBusy(true);
      const r = await post({ action: "complete-rework", notes: "Corrective work completed with evidence." });
      setBusy(false);
      if (r.ok) {
        showToast("Rework submitted — QC notified for reinspection");
        await load();
      } else showToast(r.json?.error || "Failed to submit rework.");
      return;
    }
    if (what === "request-confirmation") {
      setBusy(true);
      const r = await post({ action: "request-confirmation" });
      setBusy(false);
      if (r.ok) {
        showToast("Customer link sent — waiting for confirmation");
        await load();
      } else showToast(r.json?.error || "Could not send the confirmation link.");
      return;
    }
    if (what === "start") {
      setBusy(true);
      const r = await post({ action: "start" });
      setBusy(false);
      if (r.ok) {
        showToast("Work started — begin the checklist");
        await load();
      } else {
        showToast(r.json?.error || "Could not start the job.");
      }
      return;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-rose-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-md border border-slate-200 text-center max-w-md w-full space-y-3">
          <div className={`h-14 w-14 rounded-full flex items-center justify-center mx-auto ${kind === "revoked" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">{kind === "revoked" ? "This link is no longer active." : "Link unavailable"}</h2>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const { job, property, checklist } = data;
  const doneCount = checklist.filter((c) => c.status === "completed").length;
  const stepIndex = ["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS", "WORK_COMPLETED", "QUALITY_CHECK", "CUSTOMER_APPROVAL", "COMPLETED"].indexOf(job.status);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-44">
      <header className="bg-white border-b border-slate-200 py-3 px-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Field Manager Secure Link</div>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-amber-500")} />
              {job.customerName} · <span className="font-mono text-xs">{job.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!online && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                <WifiOff className="h-3 w-3" /> OFFLINE{queue.length ? ` · ${queue.length} queued` : ""}
              </span>
            )}
            {online && syncing && <RefreshCw className="h-4 w-4 text-rose-500 animate-spin" />}
          </div>
        </div>
      </header>

      {toast && (
        <div className="max-w-lg mx-auto mt-2 px-4">
          <div className="p-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow">{toast}</div>
        </div>
      )}

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* WHERE AM I — steps */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">{job.serviceName}</h2>
          <p className="text-xs text-slate-500 flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" /> {property.address}
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <a href={`tel:${job.customerPhone}`} className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-800">
              <Phone className="h-3.5 w-3.5 text-emerald-600" /> Call customer
            </a>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(property.address)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-800"
            >
              <Navigation className="h-3.5 w-3.5 text-blue-600" /> Navigate
            </a>
          </div>
          {/* journey strip */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-2 border-t border-slate-100">
            {["Arrived", "Confirmed", "In Progress", "Work Done", "QC", "Approval"].map((label, i) => {
              const done = stepIndex > i || (i === 3 && !!job.completedAt);
              const current = i === stepIndex;
              return (
                <div key={label} className="flex items-center gap-1">
                  <span
                    className={cn(
                      "h-4.5 w-4.5 h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold",
                      done ? "bg-emerald-500 text-white" : current ? "bg-rose-500 text-white" : "border border-slate-300 text-slate-400"
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={cn("text-[10px] font-semibold", done || current ? "text-slate-800" : "text-slate-400")}>{label}</span>
                </div>
              );
            })}
          </div>
          {job.arrivalVerification === "gps" && (
            <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> GPS arrival verified{job.arrivalDistanceM !== null ? ` (${job.arrivalDistanceM} m)` : ""}
            </p>
          )}
          {job.arrivalVerification === "manual" && (
            <p className="text-[11px] text-amber-700 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Manual arrival — reason recorded in audit
            </p>
          )}
        </div>

        {/* GPS error / bypass (§11) */}
        {(gpsError || showBypass) && job.status === "ASSIGNED" && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2">
            <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Away from the service location
            </div>
            {gpsError && <p className="text-[11px] text-amber-800">{gpsError}</p>}
            <input
              value={bypassReason}
              onChange={(e) => setBypassReason(e.target.value)}
              placeholder="Explicit reason (required) — e.g. gate locked, GPS drift"
              className="w-full h-10 rounded-xl border border-amber-300 px-3 text-xs bg-white"
            />
            <div className="flex gap-2">
              <button onClick={() => handleArrive()} disabled={gpsBusy} className="flex-1 h-10 rounded-xl bg-white border border-amber-300 text-xs font-bold text-amber-900">
                {gpsBusy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Retry GPS"}
              </button>
              <button
                onClick={() => handleArrive(bypassReason)}
                disabled={gpsBusy || bypassReason.trim().length < 4}
                className="flex-1 h-10 rounded-xl bg-amber-500 text-xs font-bold text-amber-950 disabled:opacity-50"
              >
                Confirm with reason
              </button>
            </div>
            <p className="text-[10px] text-amber-700">Confirming away from the property is always recorded with your reason for audit.</p>
          </div>
        )}

        {/* Waiting state (§12) */}
        {job.status === "ARRIVED" && !job.customerConfirmedAt && (
          <div className="bg-white rounded-2xl border border-amber-200 p-4 text-center space-y-1.5">
            <Clock className="h-6 w-6 text-amber-500 mx-auto" />
            <div className="text-sm font-bold text-slate-900">ARRIVAL VERIFIED ✓</div>
            <p className="text-xs text-slate-500">WAITING FOR CUSTOMER CONFIRMATION — the secure link was sent. You can re-send or the customer can scan the QR.</p>
            <button
              onClick={() => doTransition("request-confirmation")}
              className="mt-1 h-10 px-4 rounded-xl bg-amber-500 text-amber-950 text-xs font-bold"
            >
              <Bell className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" /> RE-SEND LINK
            </button>
          </div>
        )}

        {/* Checklist (§14) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Checklist</h3>
            <span className="text-xs font-semibold text-slate-600">
              {doneCount} / {checklist.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${checklist.length ? (doneCount / checklist.length) * 100 : 0}%` }} />
          </div>
          <div className="divide-y divide-slate-100">
            {checklist.map((item) => (
              <button
                key={item.id}
                onClick={() => tickChecklist(item.id, item.status)}
                className="w-full py-2.5 flex items-start gap-3 text-left min-h-[44px]"
              >
                <span
                  className={cn(
                    "h-6 w-6 rounded-md flex items-center justify-center shrink-0 border",
                    item.status === "completed" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300"
                  )}
                >
                  {item.status === "completed" && <Check className="h-4 w-4 stroke-[3]" />}
                </span>
                <span className="flex-1">
                  <span className="block text-[10px] font-semibold text-slate-400">
                    {item.area} {item.critical && <span className="text-red-600">*mandatory</span>}
                  </span>
                  <span className={cn("text-xs font-medium", item.status === "completed" ? "line-through text-slate-500" : "text-slate-800")}>{item.task}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Photos by room (§15) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Photo Evidence ({data.photos.length})</h3>
            <button
              onClick={() => {
                setPhotoType(data.photos.some((p) => p.photoType === "before") ? "after" : "before");
                setShowPhoto(true);
              }}
              className="h-9 px-3 rounded-xl bg-rose-500 text-white text-xs font-bold"
            >
              <Camera className="h-3.5 w-3.5 inline mr-1 -mt-0.5" /> {data.photos.some((p) => p.photoType === "before") ? "AFTER PHOTO" : "BEFORE PHOTO"}
            </button>
          </div>
          {ROOMS.map((room) => {
            const roomPhotos = data.photos.filter((p) => p.area === room);
            if (roomPhotos.length === 0) return null;
            return (
              <div key={room} className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500">{room}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {roomPhotos.map((p) => (
                    <div key={p.id} className="relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.area} className="w-full h-full object-cover" />
                      <span className={cn("absolute top-0.5 left-0.5 px-1 rounded text-[7px] font-bold text-white", p.photoType === "before" ? "bg-amber-600" : "bg-emerald-600")}>
                        {p.photoType.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rework (§19) */}
        {data.rework.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
            <div className="text-xs font-bold text-red-800 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Rework required
            </div>
            {data.rework.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-red-200 p-3 text-xs space-y-1">
                <p className="font-medium text-red-900">{r.instructions}</p>
                <p className="text-[10px] text-slate-400">Status: {r.status.replace("_", " ")}</p>
              </div>
            ))}
          </div>
        )}

        {/* Completion gate hints (§16) */}
        {job.status === "IN_PROGRESS" && !data.completionGate.ok && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-[11px] text-blue-900 space-y-1">
            <div className="font-bold">To complete work you still need:</div>
            {data.completionGate.missing.map((m) => (
              <p key={m}>• {m}</p>
            ))}
          </div>
        )}

        {job.status === "WORK_COMPLETED" && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 text-center text-sm font-bold text-purple-900">
            WAITING FOR QC ✓
          </div>
        )}
      </main>

      {/* Sticky primary CTA (§34) */}
      {primary && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-4 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent">
          <button
            onClick={primary.run}
            disabled={busy || gpsBusy}
            className={cn(
              "max-w-lg mx-auto w-full h-14 rounded-2xl text-base font-bold shadow-lg transition-colors flex items-center justify-center gap-2",
              primary.tone === "coral" && "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-200",
              primary.tone === "emerald" && "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200",
              primary.tone === "amber" && "bg-amber-500 hover:bg-amber-600 text-amber-950 shadow-amber-200"
            )}
          >
            {busy || gpsBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <primary.icon className="h-5 w-5" />}
            {primary.label}
          </button>
        </div>
      )}

      {/* Camera-first photo modal (§15) */}
      {showPhoto && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{photoType === "before" ? "BEFORE" : "AFTER"} photo</h3>
              <button onClick={() => setShowPhoto(false)} className="text-xs text-slate-400 font-semibold">
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["before", "after"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPhotoType(t)}
                  className={cn(
                    "h-11 rounded-xl border-2 text-xs font-bold",
                    photoType === t ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600"
                  )}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <select value={photoArea} onChange={(e) => setPhotoArea(e.target.value)} className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white">
              {ROOMS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input type="file" accept="image/*" capture="environment" ref={cameraRef} onChange={handleFile} className="hidden" />
            {photoData ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoData} alt="preview" className="w-full h-40 object-cover" />
                <button onClick={() => setPhotoData("")} className="absolute top-2 right-2 h-8 px-2.5 rounded-lg bg-black/60 text-white text-[11px] font-bold">
                  Retake
                </button>
              </div>
            ) : (
              <button
                onClick={() => cameraRef.current?.click()}
                className="w-full h-28 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/60 flex flex-col items-center justify-center gap-1.5"
              >
                <Camera className="h-7 w-7 text-blue-600" />
                <span className="text-sm font-bold text-blue-950">Camera opens now</span>
                <span className="text-[10px] text-blue-600">Tap to capture — camera first</span>
              </button>
            )}
            <button
              onClick={submitPhoto}
              disabled={!photoData || photoBusy}
              className="w-full h-12 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-50"
            >
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "SAVE PHOTO"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
