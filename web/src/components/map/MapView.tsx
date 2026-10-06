import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MapLayerConfig } from "@trails/shared";
import { useConfig } from "../../store/config";
import { installOfflineProtocol, offlineTileTemplate, registerLayers } from "../../offline/protocol";

const MapContext = createContext<maplibregl.Map | null>(null);

export function useMap() {
  return useContext(MapContext);
}

interface Props {
  center?: [number, number];
  zoom?: number;
  bounds?: [number, number, number, number] | null;
  children?: ReactNode;
  className?: string;
  onMoveEnd?: (view: { center: [number, number]; zoom: number }) => void;
  interactive?: boolean;
}

const BASE_PREFIX = "base-";
const OVERLAY_PREFIX = "overlay-";

function firstAppLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle()?.layers?.find((l) => !l.id.startsWith(BASE_PREFIX) && !l.id.startsWith(OVERLAY_PREFIX))?.id;
}

function addRasterLayer(map: maplibregl.Map, layer: MapLayerConfig, id: string) {
  if (!map.getSource(id)) {
    map.addSource(id, {
      type: "raster",
      tiles: [offlineTileTemplate(layer.id)],
      tileSize: layer.tileSize,
      minzoom: layer.minZoom,
      maxzoom: layer.maxZoom,
      attribution: layer.attribution,
    });
  }
  if (!map.getLayer(id)) {
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 100 } }, firstAppLayerId(map));
  }
}

function applyBaseLayer(map: maplibregl.Map, layers: MapLayerConfig[], activeId: string) {
  const active = layers.find((l) => l.id === activeId && l.kind === "base") ?? layers.find((l) => l.kind === "base");
  if (!active) return;
  const wanted = new Set<string>([BASE_PREFIX + active.id, ...(active.overlays ?? []).map((o) => OVERLAY_PREFIX + o)]);
  for (const l of map.getStyle()?.layers ?? []) {
    if ((l.id.startsWith(BASE_PREFIX) || l.id.startsWith(OVERLAY_PREFIX)) && !wanted.has(l.id)) {
      map.removeLayer(l.id);
      if (map.getSource(l.id)) map.removeSource(l.id);
    }
  }
  addRasterLayer(map, active, BASE_PREFIX + active.id);
  for (const oid of active.overlays ?? []) {
    const ov = layers.find((l) => l.id === oid);
    if (ov) addRasterLayer(map, ov, OVERLAY_PREFIX + ov.id);
  }
  // Ensure the base layer sits underneath overlays.
  const overlayIds = (active.overlays ?? []).map((o) => OVERLAY_PREFIX + o).filter((id) => map.getLayer(id));
  if (overlayIds.length) map.moveLayer(BASE_PREFIX + active.id, overlayIds[0]);
}

export function MapView({ center, zoom, bounds, children, className, onMoveEnd, interactive = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const config = useConfig((s) => s.config);
  const activeLayerId = useConfig((s) => s.activeLayerId);
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;

  useEffect(() => {
    if (!containerRef.current) return;
    installOfflineProtocol();
    registerLayers(config.mapLayers);
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [], glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" },
      center: center ?? config.defaultCenter,
      zoom: zoom ?? config.defaultZoom,
      minZoom: 3,
      maxZoom: 19,
      attributionControl: false,
      interactive,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    if (import.meta.env.DEV) (window as unknown as { __trailsMap?: maplibregl.Map }).__trailsMap = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => {
      applyBaseLayer(m, useConfig.getState().config.mapLayers, useConfig.getState().activeLayerId);
      if (bounds) m.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 15 });
      setMap(m);
    });
    m.on("moveend", () => {
      const c = m.getCenter();
      onMoveEndRef.current?.({ center: [c.lng, c.lat], zoom: m.getZoom() });
    });
    return () => {
      setMap(null);
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    registerLayers(config.mapLayers);
    applyBaseLayer(map, config.mapLayers, activeLayerId);
  }, [map, config.mapLayers, activeLayerId]);

  useEffect(() => {
    if (!map) return;
    const onResize = () => map.resize();
    const ro = new ResizeObserver(onResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [map]);

  return (
    <div className={className ?? "map-container"}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <MapContext.Provider value={map}>{map ? children : null}</MapContext.Provider>
    </div>
  );
}
