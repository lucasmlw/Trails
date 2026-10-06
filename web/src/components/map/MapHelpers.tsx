import maplibregl, { type MapMouseEvent } from "maplibre-gl";
import { useEffect } from "react";
import type { LngLat, Track } from "@trails/shared";
import { useMap } from "./MapView";

/** Hands the map instance to a parent component that lives outside <MapView>. */
export function MapCapture({ onMap }: { onMap: (map: maplibregl.Map | null) => void }) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
    return () => onMap(null);
  }, [map, onMap]);
  return null;
}

/** Calls back with the clicked position while `active`. */
export function MapClickCapture({ active, onClick }: { active: boolean; onClick: (lngLat: LngLat) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !active) return;
    const handler = (e: MapMouseEvent) => onClick([e.lngLat.lng, e.lngLat.lat]);
    map.on("click", handler);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      map.getCanvas().style.cursor = "";
    };
  }, [map, active, onClick]);
  return null;
}

/** Renders recorded GPS tracks (blue) beneath the planned route. */
export function TrackLayer({ tracks, live }: { tracks: Track[]; live?: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const features: GeoJSON.Feature[] = tracks
      .filter((t) => t.points.length > 1)
      .map((t) => ({ type: "Feature", properties: { id: t.id, live: false }, geometry: { type: "LineString", coordinates: t.points.map((p) => [p.lng, p.lat]) } }));
    if (live && live.length > 1) features.push({ type: "Feature", properties: { id: "live", live: true }, geometry: { type: "LineString", coordinates: live.map((p) => [p.lng, p.lat]) } });
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
    if (!map.getSource("tracks")) {
      map.addSource("tracks", { type: "geojson", data });
      const before = map.getLayer("route-casing") ? "route-casing" : undefined;
      map.addLayer(
        {
          id: "tracks-line",
          type: "line",
          source: "tracks",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["case", ["get", "live"], "#3c8cff", "#7fb2ff"], "line-width": ["case", ["get", "live"], 4, 3], "line-opacity": 0.9 },
        },
        before,
      );
    } else {
      (map.getSource("tracks") as maplibregl.GeoJSONSource).setData(data);
    }
  }, [map, tracks, live]);
  return null;
}
