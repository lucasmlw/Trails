import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LocationFix } from "../../location/provider";
import { useMap } from "./MapView";

/** Current position: heading arrow + accuracy circle. */
export function GpsMarker({ fix, heading }: { fix: LocationFix | null; heading: number | null }) {
  const map = useMap();
  const marker = useRef<maplibregl.Marker | null>(null);
  const arrow = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map) return;
    const el = document.createElement("div");
    el.className = "gps-marker";
    const dot = document.createElement("div");
    dot.className = "dot";
    const ar = document.createElement("div");
    ar.className = "arrow";
    ar.style.display = "none";
    el.append(ar, dot);
    arrow.current = ar;
    marker.current = new maplibregl.Marker({ element: el, anchor: "center" });
    if (!map.getSource("gps-accuracy")) {
      map.addSource("gps-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "gps-accuracy-fill",
        type: "fill",
        source: "gps-accuracy",
        paint: { "fill-color": "#3c8cff", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "gps-accuracy-line",
        type: "line",
        source: "gps-accuracy",
        paint: { "line-color": "#3c8cff", "line-opacity": 0.4, "line-width": 1 },
      });
    }
    return () => {
      marker.current?.remove();
      marker.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !marker.current) return;
    if (!fix) {
      marker.current.remove();
      return;
    }
    marker.current.setLngLat([fix.lng, fix.lat]).addTo(map);
    if (arrow.current) {
      arrow.current.style.display = heading == null ? "none" : "block";
      if (heading != null) arrow.current.style.transform = `rotate(${heading - map.getBearing()}deg)`;
    }
    const src = map.getSource("gps-accuracy") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(accuracyCircle(fix));
  }, [map, fix, heading]);

  return null;
}

function accuracyCircle(fix: LocationFix): GeoJSON.FeatureCollection {
  const r = fix.accuracy ?? 0;
  if (r < 8) return { type: "FeatureCollection", features: [] };
  const coords: [number, number][] = [];
  const kx = 111_320 * Math.cos((fix.lat * Math.PI) / 180);
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    coords.push([fix.lng + (r * Math.cos(a)) / kx, fix.lat + (r * Math.sin(a)) / 111_320]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } }] };
}
