"use client";

import React, { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { normalizeCoords } from "@/lib/location";
import { pinIcon } from "./LocationPicker";

export interface MapPoint {
  id: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  title: string;
  subtitle?: string;
  color?: string;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";

/**
 * Several saved locations on one map. Only points with a valid saved pin are
 * drawn — a point without one is never guessed. Tapping a marker calls
 * `onSelect(id)` for exactly that record.
 */
export function LocationsMap({ points, onSelect, height = 360 }: { points: MapPoint[]; onSelect: (id: string) => void; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const valid = points.flatMap((p) => {
    const c = normalizeCoords(p.lat, p.lng);
    return c ? [{ ...p, lat: c.lat, lng: c.lng }] : [];
  });
  const key = valid.map((p) => `${p.id}:${p.lat},${p.lng}:${p.color ?? ""}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current || mapRef.current) return;
      LRef.current = L;
      // No zoom/fade animations: tapping a marker navigates away, and a map removed mid-animation throws in Leaflet.
      const map = L.map(box.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([12.9716, 77.5946], 11);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (!cancelled && mapRef.current === map) map.invalidateSize();
        });
        ro.observe(box.current);
      }
      draw();
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    for (const p of valid) {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(L, p.color), title: p.title, keyboard: true });
      m.bindTooltip(`${escapeHtml(p.title)}${p.subtitle ? `<br/><span style="color:#71717a">${escapeHtml(p.subtitle)}</span>` : ""}`, { direction: "top", offset: [0, -24] });
      m.on("click", () => selectRef.current(p.id));
      m.addTo(layer);
    }
    if (valid.length === 1) map.setView([valid[0].lat, valid[0].lng], 15);
    else if (valid.length > 1) map.fitBounds(L.latLngBounds(valid.map((p) => [p.lat, p.lng] as [number, number])), { padding: [32, 32], maxZoom: 15 });
  };

  // Redraw only when the set of pins changes (`key` covers ids and coordinates).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(draw, [key]);

  return <div ref={box} style={{ height }} className="w-full rounded-2xl border border-zinc-200 bg-zinc-100 overflow-hidden z-0" role="application" aria-label={`Map of ${valid.length} saved location${valid.length === 1 ? "" : "s"}`} />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
