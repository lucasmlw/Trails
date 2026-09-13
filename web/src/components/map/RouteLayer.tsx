import maplibregl, { type MapLayerMouseEvent, type MapLayerTouchEvent, type MapMouseEvent, type MapTouchEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LngLat, RouteData, RouteSegment } from "@trails/shared";
import { useRouteEditor } from "../../store/routeEditor";
import { nearestPointOnLine } from "../../lib/geo";
import { useMap } from "./MapView";

const SRC_LINE = "route", SRC_POINTS = "route-points", SRC_HOVER = "route-hover";
const L_CASING = "route-casing", L_LINE = "route-line", L_LINE_DASHED = "route-line-dashed", L_HIT = "route-hit", L_POINTS_HALO = "route-points-halo", L_POINTS = "route-points", L_HOVER = "route-hover";
// Interaction is bound to a wide transparent copy of the line so it is easy to grab with a mouse or finger.
const LINE_LAYERS = [L_HIT];

function segmentsToGeoJSON(points: LngLat[], segments: (RouteSegment | null)[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((seg, i) => ({
      type: "Feature",
      properties: { index: i, straight: !!seg?.straight, loading: seg === null },
      geometry: { type: "LineString", coordinates: seg ? seg.coordinates : [points[i], points[i + 1]] },
    })),
  };
}

function pointsToGeoJSON(points: LngLat[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      properties: { index: i, kind: i === 0 ? "start" : i === points.length - 1 ? "end" : "via" },
      geometry: { type: "Point", coordinates: p },
    })),
  };
}

function ensureLayers(map: maplibregl.Map) {
  if (map.getSource(SRC_LINE)) return;
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  map.addSource(SRC_LINE, { type: "geojson", data: empty });
  map.addSource(SRC_POINTS, { type: "geojson", data: empty });
  map.addSource(SRC_HOVER, { type: "geojson", data: empty });
  map.addLayer({
    id: L_CASING,
    type: "line",
    source: SRC_LINE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.85 },
  });
  // line-dasharray cannot be data-driven, so routed and provisional segments are separate layers.
  map.addLayer({
    id: L_LINE,
    type: "line",
    source: SRC_LINE,
    filter: ["all", ["!", ["get", "loading"]], ["!", ["get", "straight"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ff7a00", "line-width": 4.5 },
  });
  map.addLayer({
    id: L_LINE_DASHED,
    type: "line",
    source: SRC_LINE,
    filter: ["any", ["get", "loading"], ["get", "straight"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "loading"], "#b3b3b3", "#d94a4a"],
      "line-width": 4.5,
      "line-dasharray": [1.5, 1.5],
    },
  });
  map.addLayer({
    id: L_HIT,
    type: "line",
    source: SRC_LINE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#000000", "line-width": 22, "line-opacity": 0 },
  });
  map.addLayer({
    id: L_POINTS_HALO,
    type: "circle",
    source: SRC_POINTS,
    paint: { "circle-radius": 10, "circle-color": "#ffffff", "circle-opacity": 0.9 },
  });
  map.addLayer({
    id: L_POINTS,
    type: "circle",
    source: SRC_POINTS,
    paint: {
      "circle-radius": ["match", ["get", "kind"], "via", 6, 7.5],
      "circle-color": ["match", ["get", "kind"], "start", "#2ecc71", "end", "#e74c3c", "#ff7a00"],
      "circle-stroke-color": "#1b1b1b",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: L_HOVER,
    type: "circle",
    source: SRC_HOVER,
    paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-opacity": 0.7, "circle-stroke-color": "#ff7a00", "circle-stroke-width": 2 },
  });
}

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

/** Read-only rendering of a saved route (navigation screen). */
export function RouteDisplayLayer({ route }: { route: RouteData | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    const points = route ? route.points.map((p) => [p.lng, p.lat] as LngLat) : [];
    setData(map, SRC_LINE, segmentsToGeoJSON(points, route ? route.segments : []));
    setData(map, SRC_POINTS, pointsToGeoJSON(points.length ? [points[0], points[points.length - 1]] : []));
  }, [map, route]);
  return null;
}

interface EditorProps {
  editable: boolean;
  /** position (lng, lat) to highlight, e.g. hovered on the elevation profile */
  highlight?: LngLat | null;
}

/**
 * Interactive route rendering bound to the route editor store.
 *  - click on empty map: append a point
 *  - drag a point: move it (adjacent segments re-route on release)
 *  - drag the line: insert a new point at that spot and drag it
 *  - click a point: popup with delete
 */
export function RouteEditorLayer({ editable, highlight }: EditorProps) {
  const map = useMap();
  const points = useRouteEditor((s) => s.points);
  const segments = useRouteEditor((s) => s.segments);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    setData(map, SRC_LINE, segmentsToGeoJSON(points, segments));
    setData(map, SRC_POINTS, pointsToGeoJSON(points));
  }, [map, points, segments]);

  useEffect(() => {
    if (!map) return;
    setData(map, SRC_HOVER, {
      type: "FeatureCollection",
      features: highlight ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: highlight } }] : [],
    });
  }, [map, highlight]);

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    const store = useRouteEditor;
    let drag: { index: number; moved: boolean; inserted: boolean; startPx: { x: number; y: number } } | null = null;
    let suppressClickUntil = 0;
    let popup: maplibregl.Popup | null = null;
    let hoveringLine = false;

    const lngLatOf = (e: MapMouseEvent | MapTouchEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];

    const setCursor = () => {
      if (!editableRef.current) {
        canvas.style.cursor = "";
        return;
      }
      canvas.style.cursor = drag ? "grabbing" : hoveringLine ? "pointer" : "crosshair";
    };

    const startDrag = (index: number, e: MapMouseEvent | MapTouchEvent, inserted: boolean) => {
      drag = { index, moved: inserted, inserted, startPx: { x: e.point.x, y: e.point.y } };
      popup?.remove();
      map.dragPan.disable();
      setCursor();
    };

    const onMove = (e: MapMouseEvent | MapTouchEvent) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.point.x - drag.startPx.x, e.point.y - drag.startPx.y) < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        // First real movement of an existing point: record undo snapshot.
        store.getState().beginMove();
      }
      store.getState().movePoint(drag.index, lngLatOf(e));
    };

    const endDrag = () => {
      if (!drag) return;
      const { index, moved } = drag;
      drag = null;
      map.dragPan.enable();
      if (moved) {
        store.getState().commitMove(index);
        suppressClickUntil = Date.now() + 250;
      }
      setCursor();
    };

    const onPointDown = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (!editableRef.current) return;
      const f = e.features?.[0];
      if (!f) return;
      e.preventDefault();
      startDrag(Number(f.properties?.index), e, false);
    };

    const onLineDown = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (!editableRef.current) return;
      // A point on top of the line takes precedence.
      if (map.queryRenderedFeatures(e.point, { layers: [L_POINTS] }).length) return;
      const f = e.features?.[0];
      if (!f) return;
      e.preventDefault();
      const segIndex = Number(f.properties?.index);
      const seg = store.getState().segments[segIndex];
      const snapped = seg ? nearestPointOnLine(seg.coordinates, lngLatOf(e))?.point ?? lngLatOf(e) : lngLatOf(e);
      const newIndex = store.getState().insertPoint(segIndex, snapped);
      // Inserted points always count as "moved" so a plain click on the line also adds a point.
      startDrag(newIndex, e, true);
      suppressClickUntil = Date.now() + 250;
    };

    const onMapClick = (e: MapMouseEvent) => {
      if (!editableRef.current || Date.now() < suppressClickUntil) return;
      if (popup) {
        popup.remove();
        popup = null;
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: [L_POINTS, ...LINE_LAYERS].filter((l) => map.getLayer(l)) });
      if (hits.length) return;
      store.getState().addPoint(lngLatOf(e));
    };

    const onPointClick = (e: MapLayerMouseEvent) => {
      if (!editableRef.current || Date.now() < suppressClickUntil) return;
      const f = e.features?.[0];
      if (!f) return;
      const index = Number(f.properties?.index);
      popup?.remove();
      const el = document.createElement("div");
      el.className = "row";
      const label = document.createElement("span");
      label.className = "small muted";
      label.textContent = index === 0 ? "Start point" : index === store.getState().points.length - 1 ? "End point" : `Point ${index + 1}`;
      const btn = document.createElement("button");
      btn.className = "danger small";
      btn.textContent = "Delete point";
      btn.onclick = () => {
        store.getState().deletePoint(index);
        popup?.remove();
        popup = null;
      };
      el.append(label, btn);
      popup = new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      popup.on("close", () => (popup = null));
    };

    const onLineEnter = () => {
      hoveringLine = true;
      setCursor();
    };
    const onLineLeave = () => {
      hoveringLine = false;
      setCursor();
    };
    const onPointEnter = () => {
      if (editableRef.current) canvas.style.cursor = "move";
    };

    map.on("mousedown", L_POINTS, onPointDown);
    map.on("touchstart", L_POINTS, onPointDown);
    for (const l of LINE_LAYERS) {
      map.on("mousedown", l, onLineDown);
      map.on("touchstart", l, onLineDown);
      map.on("mouseenter", l, onLineEnter);
      map.on("mouseleave", l, onLineLeave);
    }
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("touchcancel", endDrag);
    map.on("click", onMapClick);
    map.on("click", L_POINTS, onPointClick);
    map.on("mouseenter", L_POINTS, onPointEnter);
    map.on("mouseleave", L_POINTS, setCursor);
    setCursor();

    return () => {
      map.off("mousedown", L_POINTS, onPointDown);
      map.off("touchstart", L_POINTS, onPointDown);
      for (const l of LINE_LAYERS) {
        map.off("mousedown", l, onLineDown);
        map.off("touchstart", l, onLineDown);
        map.off("mouseenter", l, onLineEnter);
        map.off("mouseleave", l, onLineLeave);
      }
      map.off("mousemove", onMove);
      map.off("touchmove", onMove);
      map.off("mouseup", endDrag);
      map.off("touchend", endDrag);
      map.off("touchcancel", endDrag);
      map.off("click", onMapClick);
      map.off("click", L_POINTS, onPointClick);
      map.off("mouseenter", L_POINTS, onPointEnter);
      map.off("mouseleave", L_POINTS, setCursor);
      popup?.remove();
      canvas.style.cursor = "";
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    map.getCanvas().style.cursor = editable ? "crosshair" : "";
  }, [map, editable]);

  return null;
}
