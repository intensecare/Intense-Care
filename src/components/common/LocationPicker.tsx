"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin, Move, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/**
 * §1 LOCATION SELECTION — pick the exact service location on a map.
 *
 * Deliberately dependency-free: no map SDK, no API key, no npm package. It
 * draws OpenStreetMap tiles with the standard slippy-map maths, and the pin
 * is the CENTRE of the viewport — so dragging the map IS adjusting the pin,
 * which is the one gesture that works the same with a thumb and a mouse.
 *
 * Admin never types coordinates: they tap "Use my location", drag the map, or
 * leave it alone and keep the address only. Latitude and longitude are
 * reported upward whenever they change.
 */

export interface LocationValue {
  address: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  notes?: string;
}

const TILE = 256;
/** Mangalore — a sensible first view before anything is chosen. */
const FALLBACK = { lat: 12.9141, lng: 74.856 };

const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * Math.pow(2, z);
const latToY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
};
const xToLng = (x: number, z: number) => (x / Math.pow(2, z)) * 360 - 180;
const yToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export function LocationPicker({
  value,
  onChange,
  addressLabel = "Service address",
  disabled,
  className,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  addressLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [zoom, setZoom] = useState(value.lat !== undefined ? 17 : 13);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // The map centre IS the pin. Until one is chosen we centre on the fallback
  // but report nothing upward, so "no pin yet" stays an honest state.
  const centre = useMemo(
    () => ({ lat: value.lat ?? FALLBACK.lat, lng: value.lng ?? FALLBACK.lng }),
    [value.lat, value.lng]
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setPin = useCallback(
    (lat: number, lng: number, accuracy?: number) => {
      onChange({
        ...value,
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        accuracy,
      });
    },
    [onChange, value]
  );

  /* ------------------------------------------------------------ tiles */
  const tiles = useMemo(() => {
    const cx = lngToX(centre.lng, zoom);
    const cy = latToY(centre.lat, zoom);
    const halfW = size.w / 2 / TILE;
    const halfH = size.h / 2 / TILE;
    const max = Math.pow(2, zoom);
    const out: { key: string; src: string; left: number; top: number }[] = [];
    for (let tx = Math.floor(cx - halfW); tx <= Math.floor(cx + halfW); tx++) {
      for (let ty = Math.floor(cy - halfH); ty <= Math.floor(cy + halfH); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wrapped = ((tx % max) + max) % max;
        out.push({
          key: `${zoom}/${tx}/${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
          left: (tx - cx) * TILE + size.w / 2,
          top: (ty - cy) * TILE + size.h / 2,
        });
      }
    }
    return out;
  }, [centre.lat, centre.lng, zoom, size.w, size.h]);

  /* ------------------------------------------------------- dragging */
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      cx: lngToX(centre.lng, zoom),
      cy: latToY(centre.lat, zoom),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || disabled) return;
    const nx = d.cx - (e.clientX - d.x) / TILE;
    const ny = d.cy - (e.clientY - d.y) / TILE;
    const max = Math.pow(2, zoom);
    setPin(yToLat(Math.min(max - 0.0001, Math.max(0.0001, ny)), zoom), xToLng(nx, zoom));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  /* ------------------------------------------------- current location */
  const useMyLocation = () => {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("This device cannot share its location. Drag the map to set the pin instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setZoom(18);
        setPin(pos.coords.latitude, pos.coords.longitude, Math.round(pos.coords.accuracy));
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was refused. Drag the map to set the pin instead."
            : "We could not get a location fix. Drag the map to set the pin instead."
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  };

  const hasPin = value.lat !== undefined && value.lng !== undefined;

  return (
    <div className={cn("space-y-3", className)}>
      <Field label={addressLabel} required hint="The address the crew and the invoice will show.">
        <Input
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="Flat / building, street, area, city"
          disabled={disabled}
          autoComplete="off"
        />
      </Field>

      <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-100">
        <div
          ref={boxRef}
          className={cn(
            "relative h-56 sm:h-64 touch-none select-none",
            disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="application"
          aria-label="Map — drag to move the service location pin"
        >
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.key}
              src={t.src}
              alt=""
              width={TILE}
              height={TILE}
              draggable={false}
              className="absolute pointer-events-none"
              style={{ left: t.left, top: t.top }}
            />
          ))}

          {/* The pin sits at the centre of the viewport. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full pointer-events-none">
            <MapPin
              className={cn("h-9 w-9 drop-shadow", hasPin ? "text-rose-600" : "text-zinc-500")}
              strokeWidth={2.5}
              aria-hidden
            />
          </div>
          {!hasPin && (
            <div className="absolute inset-x-0 bottom-0 bg-zinc-900/75 text-white text-xs px-3 py-2 pointer-events-none">
              Drag the map or tap <strong>Use my location</strong> to drop the pin.
            </div>
          )}

          {/* Zoom. Separate buttons so this works without a wheel or pinch. */}
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(19, z + 1))}
              disabled={disabled}
              className="h-9 w-9 rounded-lg bg-white/95 border border-zinc-300 text-zinc-800 flex items-center justify-center shadow-sm"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(3, z - 1))}
              disabled={disabled}
              className="h-9 w-9 rounded-lg bg-white/95 border border-zinc-300 text-zinc-800 flex items-center justify-center shadow-sm"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-white border-t border-zinc-200">
          <span className="text-[11px] text-zinc-500 truncate">
            <Move className="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden />
            Map data © OpenStreetMap contributors
          </span>
          <span className="text-[11px] tabular-nums text-zinc-600 shrink-0">z{zoom}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={useMyLocation} disabled={disabled || locating}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Crosshair className="h-4 w-4" aria-hidden />}
          Use my location
        </Button>
        {hasPin && (
          <>
            <span className="text-xs font-mono tabular-nums text-zinc-700 rounded-lg bg-zinc-100 px-2.5 py-1.5">
              {value.lat!.toFixed(5)}, {value.lng!.toFixed(5)}
            </span>
            {value.accuracy !== undefined && (
              <span className="text-xs text-zinc-500">±{Math.round(value.accuracy)} m</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...value, lat: undefined, lng: undefined, accuracy: undefined })}
              disabled={disabled}
            >
              Clear pin
            </Button>
          </>
        )}
      </div>

      {geoError && <Notice tone="warning">{geoError}</Notice>}

      <Field label="Location notes" hint="Gate code, landmark, parking, which floor. Shown to the crew.">
        <Input
          value={value.notes ?? ""}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="e.g. Blue gate next to the temple, 3rd floor, lift on the left"
          disabled={disabled}
        />
      </Field>

      {!hasPin && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Without a pin the crew cannot be GPS-verified on arrival — they will have to scan the job QR or give a reason.
        </p>
      )}
    </div>
  );
}

/** Read-only location card with a one-tap navigation button. */
export function LocationCard({
  address,
  lat,
  lng,
  notes,
  showNotes = true,
  className,
}: {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  /** Location notes are internal — never pass true on a customer surface. */
  showNotes?: boolean;
  className?: string;
}) {
  const hasPin = typeof lat === "number" && typeof lng === "number";
  const destination = hasPin ? `${lat},${lng}` : address ? encodeURIComponent(address) : "";
  const navUrl = destination ? `https://www.google.com/maps/dir/?api=1&destination=${destination}` : null;

  return (
    <section className={cn("rounded-2xl border border-zinc-200 bg-white p-4 space-y-3", className)}>
      <div className="flex items-start gap-3">
        <MapPin className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service location</h3>
          <p className="text-sm font-medium text-zinc-950 break-words">{address || "No address on file"}</p>
          {hasPin ? (
            <p className="text-xs font-mono tabular-nums text-zinc-500 mt-0.5">
              {lat!.toFixed(5)}, {lng!.toFixed(5)}
            </p>
          ) : (
            <p className="text-xs text-amber-700 mt-0.5">No map pin — arrival needs a QR scan or a reason.</p>
          )}
          {showNotes && notes && <p className="text-sm text-zinc-600 mt-1.5 break-words">{notes}</p>}
        </div>
      </div>
      {navUrl && (
        <a
          href={navUrl}
          target="_blank"
          rel="noreferrer"
          className="h-11 w-full rounded-xl bg-zinc-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <MapPin className="h-4 w-4" aria-hidden /> OPEN NAVIGATION
        </a>
      )}
    </section>
  );
}
