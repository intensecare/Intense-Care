"use client";

import React, { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Search, LocateFixed, Navigation, MapPin, AlertTriangle, ArrowLeftRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { looksSwapped, navigateUrl as buildNavigateUrl, normalizeCoords, round6, type PropertyLocationSource } from "@/lib/location";

/** Structured parts of an address found by search or at the pin. */
export interface AddressFound {
  display: string;
  addressLine?: string;
  locality?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface LocationValue {
  lat: number | null;
  lng: number | null;
  address: string;
  /** How the pin was last set (saved on the property). */
  source?: PropertyLocationSource;
  /** Address parts from the last search pick or pin lookup (the form decides whether to use them). */
  found?: AddressFound | null;
}

/** Map tiles — OpenStreetMap by default; set NEXT_PUBLIC_MAP_TILE_URL to use another provider. */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";
/** Address search (geocoding) — OpenStreetMap Nominatim by default. */
const GEOCODE_URL = (process.env.NEXT_PUBLIC_GEOCODE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
/** Limit search to these countries (comma-separated ISO codes); empty = worldwide. */
const GEOCODE_COUNTRIES = process.env.NEXT_PUBLIC_GEOCODE_COUNTRIES ?? "in";
const OVERVIEW_CENTER: [number, number] = [12.9716, 77.5946]; // only an initial view for an empty editable map — never saved

/** Directions to the saved pin (or the address). Kept for existing imports. */
export function navigateUrl(v: { lat?: number | null; lng?: number | null; address?: string | null }): string {
  return buildNavigateUrl(v) ?? "#";
}

export const pinIcon = (L: typeof Leaflet, color = "#ea506c") =>
  L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26],
  });

interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

function partsOf(p: NominatimPlace): AddressFound {
  const a = p.address ?? {};
  const line = [a.house_number, a.building, a.road].filter(Boolean).join(" ");
  return {
    display: p.display_name,
    addressLine: line || undefined,
    locality: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || undefined,
    city: a.city || a.town || a.municipality || a.county || a.state_district || undefined,
    state: a.state || undefined,
    postalCode: a.postcode || undefined,
    country: a.country || undefined,
  };
}

/** A plain-language reason the address service failed. */
function geocodeProblem(status: number): string {
  if (status === 429) return "The address search is busy (too many searches). Wait a few seconds and try again, or drop the pin on the map.";
  if (status === 401 || status === 403) return "The address search service refused the request (check NEXT_PUBLIC_GEOCODE_URL / its key and allowed domains). You can still drop the pin on the map.";
  return `The address search failed (error ${status}). Drop the pin on the map or type the coordinates.`;
}

async function reverseLookup(lat: number, lng: number): Promise<AddressFound | null> {
  try {
    const res = await fetch(`${GEOCODE_URL}/reverse?format=jsonv2&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const p = (await res.json()) as NominatimPlace & { error?: string };
    return p && !p.error && p.display_name ? partsOf(p) : null;
  } catch {
    return null;
  }
}

/**
 * Map location: search an address and pick a result, use the device's
 * location, drop / drag the pin, or type latitude and longitude. `readOnly`
 * shows the saved pin + Navigate — and, when there is no saved pin, a warning
 * instead of a map (a map would suggest a location that was never saved).
 */
export function LocationPicker({
  value,
  onChange,
  readOnly = false,
  height = 260,
  idPrefix = "loc",
  showAddress = true,
}: {
  value: LocationValue;
  onChange?: (v: LocationValue) => void;
  readOnly?: boolean;
  height?: number;
  idPrefix?: string;
  /** Show the address box (off when the form has its own address fields). */
  showAddress?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Map handlers are registered once; they must always call the CURRENT onChange
  // (an old one would act on a stale copy of the form).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lookupSeq = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimPlace[] | null>(null);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [suggest, setSuggest] = useState<AddressFound | null>(null);
  // Typed coordinates stay as text while editing (e.g. "-", "12.").
  const [latText, setLatText] = useState(value.lat?.toString() ?? "");
  const [lngText, setLngText] = useState(value.lng?.toString() ?? "");
  useEffect(() => {
    if (parseCoord(latText, 90) !== value.lat) setLatText(value.lat?.toString() ?? "");
    if (parseCoord(lngText, 180) !== value.lng) setLngText(value.lng?.toString() ?? "");
    // Only react to outside changes (pin, search, GPS).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.lat, value.lng]);

  const pin = normalizeCoords(value.lat, value.lng);
  const set = (patch: Partial<LocationValue>) => onChangeRef.current?.({ ...valueRef.current, ...patch });

  /** Look up the address at a pin; fill an empty address, otherwise offer it. */
  const resolveAddressAt = async (lat: number, lng: number) => {
    const seq = ++lookupSeq.current;
    const found = await reverseLookup(lat, lng);
    if (seq !== lookupSeq.current) return;
    if (!found) {
      setNote("Pin saved. We couldn't look up the address there — check the address text yourself.");
      return;
    }
    if (!valueRef.current.address.trim()) set({ address: found.display, found });
    else {
      set({ found });
      if (found.display !== valueRef.current.address) setSuggest(found);
    }
  };

  const placePin = (lat: number, lng: number, pan = true) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: pinIcon(L), draggable: !readOnly, keyboard: !readOnly }).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLatLng();
        const lat2 = round6(p.lat);
        const lng2 = round6(p.lng);
        set({ lat: lat2, lng: lng2, source: "MAP_PIN" });
        void resolveAddressAt(lat2, lng2);
      });
    } else markerRef.current.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  };

  const removePin = () => {
    markerRef.current?.remove();
    markerRef.current = null;
  };

  // Create the map once (browser only). Read-only maps exist only when there is a saved pin.
  const wantMap = !readOnly || !!pin;
  useEffect(() => {
    if (!wantMap) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current || mapRef.current) return;
      LRef.current = L;
      const start = normalizeCoords(valueRef.current.lat, valueRef.current.lng);
      // No zoom/fade animations: a map removed mid-animation (page change, dialog close) throws in Leaflet.
      const map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(start ? [start.lat, start.lng] : OVERVIEW_CENTER, start ? 16 : 11);
      const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      let tileErrors = 0;
      tiles.on("tileerror", () => {
        if (++tileErrors >= 4) setTilesFailed(true);
      });
      tiles.on("load", () => setTilesFailed(false));
      mapRef.current = map;
      if (start) placePin(start.lat, start.lng, false);
      if (!readOnly) {
        map.on("click", (e: Leaflet.LeafletMouseEvent) => {
          const lat = round6(e.latlng.lat);
          const lng = round6(e.latlng.lng);
          placePin(lat, lng, false);
          set({ lat, lng, source: "MAP_PIN" });
          void resolveAddressAt(lat, lng);
        });
      }
      // Dialogs and tabs change the box size after the map is created; keep the tiles in step.
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (!cancelled && mapRef.current === map) map.invalidateSize();
        });
        ro.observe(box.current);
      }
      setTimeout(() => {
        if (!cancelled && mapRef.current === map) map.invalidateSize();
      }, 250);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The map is created once; later value changes move the pin below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantMap]);

  // Keep the pin in step with typed coordinates / outside changes.
  useEffect(() => {
    if (!mapRef.current) return;
    if (pin) {
      const cur = markerRef.current?.getLatLng();
      if (!cur || Math.abs(cur.lat - pin.lat) > 1e-6 || Math.abs(cur.lng - pin.lng) > 1e-6) placePin(pin.lat, pin.lng);
    } else removePin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng]);

  const search = async () => {
    const q = query.trim() || value.address.trim();
    if (!q) return setNote("Type an address, area, city or postal code to search.");
    setBusy("search");
    setNote(null);
    setResults(null);
    try {
      const cc = GEOCODE_COUNTRIES ? `&countrycodes=${encodeURIComponent(GEOCODE_COUNTRIES)}` : "";
      const res = await fetch(`${GEOCODE_URL}/search?format=jsonv2&addressdetails=1&accept-language=en&limit=6${cc}&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        setNote(geocodeProblem(res.status));
        return;
      }
      const list = (await res.json()) as NominatimPlace[];
      setResults(Array.isArray(list) ? list : []);
      if (!Array.isArray(list) || !list.length) setNote("No match found. Try the locality and city, a postal code, a nearby landmark — or drop the pin on the map. Your typed address is kept.");
    } catch {
      setNote("Address search isn't reachable right now (offline, or blocked by the network). Your typed address is kept — drop the pin on the map or type the coordinates.");
    } finally {
      setBusy(null);
    }
  };

  // The user chose this result: the pin moves there; the address fills only if empty, otherwise it is offered.
  const pick = (r: NominatimPlace) => {
    const lat = round6(Number(r.lat));
    const lng = round6(Number(r.lon));
    if (!normalizeCoords(lat, lng)) return setNote("That result has no usable coordinates. Pick another one.");
    const found = partsOf(r);
    setResults(null);
    setQuery("");
    placePin(lat, lng);
    lookupSeq.current++;
    if (!valueRef.current.address.trim()) set({ lat, lng, address: found.display, source: "SEARCH", found });
    else {
      set({ lat, lng, source: "SEARCH", found });
      setSuggest(found.display !== valueRef.current.address ? found : null);
    }
  };

  const useMyLocation = () => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return setNote("Browsers only share location on secure (https) pages. Open the app on its https address, or drop the pin on the map.");
    }
    if (!navigator.geolocation) return setNote("This device can't share its location. Drop the pin on the map instead.");
    setBusy("gps");
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        const lat = round6(pos.coords.latitude);
        const lng = round6(pos.coords.longitude);
        placePin(lat, lng);
        set({ lat, lng, source: "DEVICE_GPS" });
        const acc = Math.round(pos.coords.accuracy);
        setNote(acc > 50 ? `Location found, accurate to about ±${acc} m. Check the pin and drag it onto the building if needed.` : null);
        void resolveAddressAt(lat, lng);
      },
      (err) => {
        setBusy(null);
        setNote(
          err.code === 1
            ? "Location permission is blocked for this site. Allow it in the browser (lock icon by the address bar), or drop the pin on the map."
            : err.code === 3
            ? "Getting your location took too long. Try again near a window, or drop the pin on the map."
            : "Your device couldn't find its location. Turn on Location / GPS, or drop the pin on the map."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const typed = (lat: string, lng: string) => {
    const a = parseCoord(lat, 90);
    const b = parseCoord(lng, 180);
    set({ lat: a, lng: b, source: "MANUAL" });
  };

  const swapped = pin && looksSwapped(pin);
  const halfTyped = !readOnly && (parseCoord(latText, 90) === null) !== (parseCoord(lngText, 180) === null);
  const nav = buildNavigateUrl(value);

  if (readOnly && !pin) {
    return (
      <div className="space-y-2">
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> No saved map pin for this location. Navigation uses the address text, and GPS start checks can&apos;t run until a pin is saved.
        </p>
        {nav && (
          <a href={nav} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
            <Navigation className="h-4 w-4 text-rose-500" aria-hidden /> Navigate by address
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input
              id={`${idPrefix}-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="Search address, area, city or PIN code"
              aria-label="Search address"
              className="pl-10"
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void search()} loading={busy === "search"} className="shrink-0">
            Search
          </Button>
        </div>
      )}
      {results && results.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
            <span className="text-xs font-semibold text-zinc-600">Pick the right place ({results.length})</span>
            <button type="button" onClick={() => setResults(null)} className="min-h-8 px-2 text-xs text-zinc-500 inline-flex items-center gap-1"><X className="h-3.5 w-3.5" aria-hidden /> Close</button>
          </div>
          <ul className="divide-y divide-zinc-100 max-h-56 overflow-y-auto" role="listbox" aria-label="Search results">
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lon},${i}`}>
                <button type="button" role="option" aria-selected={false} onClick={() => pick(r)} className="w-full min-h-11 px-3 py-2 text-left text-sm hover:bg-zinc-50 flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-rose-500 shrink-0" aria-hidden /> <span className="break-words">{r.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative">
        <div ref={box} style={{ height }} className="w-full rounded-xl border border-zinc-200 bg-zinc-100 overflow-hidden z-0" role="application" aria-label={readOnly ? "Saved location map" : "Map — tap to drop the pin, drag it to adjust"} />
        {!readOnly && !pin && (
          <div className="pointer-events-none absolute inset-x-2 top-2 z-[400] rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow">No pin yet — search, use your location, or tap the map.</div>
        )}
      </div>
      {tilesFailed && (
        <p role="status" className="text-sm text-amber-800">The map pictures couldn&apos;t load (network or map provider settings). The saved coordinates are still used for navigation and GPS checks.</p>
      )}

      {!readOnly && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation} loading={busy === "gps"}>
              <LocateFixed className="h-4 w-4" aria-hidden /> Use current location
            </Button>
            {pin && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { removePin(); set({ lat: null, lng: null }); setSuggest(null); }}>
                <X className="h-4 w-4" aria-hidden /> Remove pin
              </Button>
            )}
            <span className="text-xs text-zinc-500">Tap the map to drop the pin · drag it to adjust</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Latitude</span>
              <Input id={`${idPrefix}-lat`} inputMode="decimal" value={latText} onChange={(e) => { setLatText(e.target.value); typed(e.target.value, lngText); }} placeholder="12.9716" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Longitude</span>
              <Input id={`${idPrefix}-lng`} inputMode="decimal" value={lngText} onChange={(e) => { setLngText(e.target.value); typed(latText, e.target.value); }} placeholder="77.5946" />
            </label>
          </div>
          {halfTyped && <p className="text-sm text-amber-800">Enter both latitude and longitude — one alone isn&apos;t saved.</p>}
          {swapped && (
            <p role="alert" className="text-sm text-amber-900 flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden /> These look like longitude, latitude (swapped).
              <Button type="button" size="sm" variant="outline" onClick={() => set({ lat: pin!.lng, lng: pin!.lat, source: "MANUAL" })}><ArrowLeftRight className="h-4 w-4" aria-hidden /> Swap them</Button>
            </p>
          )}
          {showAddress && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-zinc-800">Address</span>
              <textarea id={`${idPrefix}-address`} value={value.address} onChange={(e) => set({ address: e.target.value })} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="Flat, building, street, area, city" />
            </label>
          )}
          {suggest && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 space-y-2">
              <p><span className="font-semibold">Address at the pin:</span> {suggest.display}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => { set({ address: suggest.display, found: suggest }); setSuggest(null); }}>Use this address</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSuggest(null)}>Keep mine</Button>
              </div>
            </div>
          )}
        </>
      )}
      {note && <p role="status" className="text-sm text-amber-800">{note}</p>}
      {pin && <p className="text-xs text-zinc-500 tabular-nums">{readOnly ? "Saved pin" : "Pin"}: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>}
      {nav && (
        <a href={nav} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50", readOnly && "w-full justify-center sm:w-auto")}>
          <Navigation className="h-4 w-4 text-rose-500" aria-hidden /> Navigate
        </a>
      )}
    </div>
  );
}

function parseCoord(raw: string, max: number): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
