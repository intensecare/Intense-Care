"use client";

import React, { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { Search, LocateFixed, Navigation, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LocationValue {
  lat: number | null;
  lng: number | null;
  address: string;
}

/** Map tiles — OpenStreetMap by default; set NEXT_PUBLIC_MAP_TILE_URL to use another provider. */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";
/** Address search (geocoding) — OpenStreetMap Nominatim by default. */
const GEOCODE_URL = process.env.NEXT_PUBLIC_GEOCODE_URL || "https://nominatim.openstreetmap.org";
const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru

export function navigateUrl(v: { lat?: number | null; lng?: number | null; address?: string | null }): string {
  const dest = typeof v.lat === "number" && typeof v.lng === "number" ? `${v.lat},${v.lng}` : v.address ?? "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

const pinIcon = (L: typeof Leaflet) =>
  L.divIcon({
    className: "",
    html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#ea506c;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });

/**
 * Map location: search an address, use the current location, drop / drag the
 * pin, or type latitude and longitude. `readOnly` shows the pin + Navigate.
 */
export function LocationPicker({
  value,
  onChange,
  readOnly = false,
  height = 260,
  idPrefix = "loc",
}: {
  value: LocationValue;
  onChange?: (v: LocationValue) => void;
  readOnly?: boolean;
  height?: number;
  idPrefix?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Typed coordinates stay as text while editing (e.g. "-", "12.").
  const [latText, setLatText] = useState(value.lat?.toString() ?? "");
  const [lngText, setLngText] = useState(value.lng?.toString() ?? "");
  useEffect(() => {
    if (parseCoord(latText, 90) !== value.lat) setLatText(value.lat?.toString() ?? "");
    if (parseCoord(lngText, 180) !== value.lng) setLngText(value.lng?.toString() ?? "");
    // Only react to outside changes (pin, search, GPS).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.lat, value.lng]);

  const set = (patch: Partial<LocationValue>) => onChange?.({ ...valueRef.current, ...patch });

  const placePin = (lat: number, lng: number, pan = true) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: pinIcon(L), draggable: !readOnly, keyboard: !readOnly }).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLatLng();
        set({ lat: round(p.lat), lng: round(p.lng) });
      });
    } else markerRef.current.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  };

  // Create the map once (browser only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current || mapRef.current) return;
      LRef.current = L;
      const has = typeof value.lat === "number" && typeof value.lng === "number";
      const map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true }).setView(has ? [value.lat!, value.lng!] : DEFAULT_CENTER, has ? 16 : 11);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      mapRef.current = map;
      if (has) placePin(value.lat!, value.lng!, false);
      if (!readOnly) {
        map.on("click", (e: Leaflet.LeafletMouseEvent) => {
          placePin(e.latlng.lat, e.latlng.lng, false);
          set({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) });
        });
      }
      setTimeout(() => map.invalidateSize(), 150);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The map is created once; later value changes move the pin below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin in step with typed coordinates.
  useEffect(() => {
    if (typeof value.lat === "number" && typeof value.lng === "number" && mapRef.current) {
      const cur = markerRef.current?.getLatLng();
      if (!cur || Math.abs(cur.lat - value.lat) > 1e-6 || Math.abs(cur.lng - value.lng) > 1e-6) placePin(value.lat, value.lng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.lat, value.lng]);

  const search = async () => {
    const q = query.trim() || value.address.trim();
    if (!q) return;
    setBusy("search");
    setNote(null);
    try {
      const res = await fetch(`${GEOCODE_URL}/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      const list = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      setResults(list);
      if (!list.length) setNote("No match found. Try a nearby landmark, or drop the pin on the map.");
    } catch {
      setNote("Address search isn't available right now. Drop the pin on the map or type the coordinates.");
    } finally {
      setBusy(null);
    }
  };

  const pick = (r: { display_name: string; lat: string; lon: string }) => {
    const lat = round(Number(r.lat));
    const lng = round(Number(r.lon));
    setResults([]);
    setQuery("");
    placePin(lat, lng);
    set({ lat, lng, address: valueRef.current.address || r.display_name });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return setNote("This device can't share its location.");
    setBusy("gps");
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        const lat = round(pos.coords.latitude);
        const lng = round(pos.coords.longitude);
        placePin(lat, lng);
        set({ lat, lng });
      },
      () => {
        setBusy(null);
        setNote("Couldn't get your location. Allow location access, or drop the pin on the map.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const coordsSet = typeof value.lat === "number" && typeof value.lng === "number";

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="Search address or landmark"
              aria-label="Search address"
              className="pl-10"
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void search()} loading={busy === "search"} className="shrink-0">
            Search
          </Button>
        </div>
      )}
      {results.length > 0 && (
        <ul className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 max-h-52 overflow-y-auto">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onClick={() => pick(r)} className="w-full min-h-11 px-3 py-2 text-left text-sm hover:bg-zinc-50 flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-rose-500 shrink-0" aria-hidden /> <span className="break-words">{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div ref={box} style={{ height }} className="w-full rounded-xl border border-zinc-200 bg-zinc-100 overflow-hidden z-0" role="application" aria-label={readOnly ? "Location map" : "Map — tap to drop the pin, drag it to adjust"} />

      {!readOnly && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation} loading={busy === "gps"}>
              <LocateFixed className="h-4 w-4" aria-hidden /> Use current location
            </Button>
            <span className="text-xs text-zinc-500 self-center">Tap the map to drop the pin · drag it to adjust</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Latitude</span>
              <Input id={`${idPrefix}-lat`} inputMode="decimal" value={latText} onChange={(e) => { setLatText(e.target.value); set({ lat: parseCoord(e.target.value, 90) }); }} placeholder="12.9716" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Longitude</span>
              <Input id={`${idPrefix}-lng`} inputMode="decimal" value={lngText} onChange={(e) => { setLngText(e.target.value); set({ lng: parseCoord(e.target.value, 180) }); }} placeholder="77.5946" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-zinc-800">Address</span>
            <textarea value={value.address} onChange={(e) => set({ address: e.target.value })} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="Flat, building, street, area, city" />
          </label>
        </>
      )}
      {note && <p role="status" className="text-sm text-amber-800">{note}</p>}
      {(coordsSet || value.address) && (
        <a href={navigateUrl(value)} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50", readOnly && "w-full justify-center sm:w-auto")}>
          <Navigation className="h-4 w-4 text-rose-500" aria-hidden /> Navigate
        </a>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
function parseCoord(raw: string, max: number): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
