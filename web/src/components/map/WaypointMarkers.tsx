import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LngLat, Waypoint } from "@trails/shared";
import { categoryStyle } from "../../lib/waypoints";
import { useMap } from "./MapView";

interface Props {
  waypoints: Waypoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** when set, the selected waypoint can be dragged to a new position */
  onMove?: (id: string, lngLat: LngLat) => void;
  /** transient marker for a waypoint being created */
  draft?: { lngLat: LngLat; category: string } | null;
  onDraftMove?: (lngLat: LngLat) => void;
}

function buildElement(category: string, name: string, selected: boolean) {
  const style = categoryStyle(category);
  const el = document.createElement("div");
  el.className = "wp-marker" + (selected ? " selected" : "");
  el.title = name;
  const icon = document.createElement("div");
  icon.className = "wp-icon";
  icon.style.background = style.color;
  icon.style.color = "#fff";
  icon.textContent = style.glyph;
  el.appendChild(icon);
  // Do not let the map treat marker interaction as a map click / drag.
  for (const evt of ["mousedown", "touchstart", "click", "dblclick"]) el.addEventListener(evt, (e) => e.stopPropagation());
  return el;
}

export function WaypointMarkers({ waypoints, selectedId, onSelect, onMove, draft, onDraftMove }: Props) {
  const map = useMap();
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const draftMarker = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();
    for (const wp of waypoints) {
      seen.add(wp.id);
      const selected = wp.id === selectedId;
      let marker = markers.current.get(wp.id);
      const el = buildElement(wp.category, wp.name, selected);
      el.addEventListener("click", () => onSelect?.(wp.id));
      if (marker) {
        // Replace the element so category/selection styling is always current.
        marker.remove();
      }
      marker = new maplibregl.Marker({ element: el, anchor: "center", draggable: !!onMove && selected }).setLngLat([wp.lng, wp.lat]).addTo(map);
      marker.on("dragend", () => {
        const ll = marker!.getLngLat();
        onMove?.(wp.id, [ll.lng, ll.lat]);
      });
      markers.current.set(wp.id, marker);
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [map, waypoints, selectedId, onSelect, onMove]);

  useEffect(() => {
    if (!map) return;
    draftMarker.current?.remove();
    draftMarker.current = null;
    if (!draft) return;
    const el = buildElement(draft.category, "New waypoint", true);
    el.style.opacity = "0.9";
    const m = new maplibregl.Marker({ element: el, anchor: "center", draggable: true }).setLngLat(draft.lngLat).addTo(map);
    m.on("dragend", () => {
      const ll = m.getLngLat();
      onDraftMove?.([ll.lng, ll.lat]);
    });
    draftMarker.current = m;
    return () => {
      m.remove();
    };
  }, [map, draft, onDraftMove]);

  useEffect(
    () => () => {
      for (const m of markers.current.values()) m.remove();
      markers.current.clear();
    },
    [],
  );

  return null;
}
