import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerConfig, Trip } from "@trails/shared";
import { useConfig } from "../../store/config";
import { bboxOf, padBBox, routeCoordinates, type BBox } from "../../lib/geo";
import { averageTileBytes, countTiles } from "../../offline/tiles";
import { deleteStoredTrip, getDownload, storageEstimate, type DownloadMeta } from "../../offline/db";
import { downloadTrip, type DownloadProgress } from "../../offline/downloader";
import { formatBytes } from "../../lib/format";
import { toast } from "../../store/toast";

interface Props {
  trip: Trip;
  map: maplibregl.Map | null;
  online: boolean;
  onDownloadsChanged?: () => void;
}

const AREA_SRC = "download-area";

function drawArea(map: maplibregl.Map | null, bbox: BBox | null) {
  if (!map) return;
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: bbox
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]],
            },
          },
        ]
      : [],
  };
  if (!map.getSource(AREA_SRC)) {
    map.addSource(AREA_SRC, { type: "geojson", data });
    map.addLayer({ id: AREA_SRC + "-fill", type: "fill", source: AREA_SRC, paint: { "fill-color": "#3c8cff", "fill-opacity": 0.08 } });
    map.addLayer({ id: AREA_SRC + "-line", type: "line", source: AREA_SRC, paint: { "line-color": "#3c8cff", "line-width": 2, "line-dasharray": [2, 1.5] } });
  } else {
    (map.getSource(AREA_SRC) as maplibregl.GeoJSONSource).setData(data);
  }
}

export function DownloadPanel({ trip, map, online, onDownloadsChanged }: Props) {
  const config = useConfig((s) => s.config);
  const activeLayerId = useConfig((s) => s.activeLayerId);
  const offlineLayers = useMemo(() => config.mapLayers.filter((l) => l.kind === "base" && l.offline), [config.mapLayers]);

  const tripBBox = useMemo(() => {
    const coords = [...routeCoordinates(trip.route), ...trip.waypoints.map((w) => [w.lng, w.lat] as [number, number])];
    return bboxOf(coords);
  }, [trip.route, trip.waypoints]);

  const [padding, setPadding] = useState(1500);
  const [customBBox, setCustomBBox] = useState<BBox | null>(null);
  const [maxZoom, setMaxZoom] = useState(config.offlineZoom.max);
  const [layerIds, setLayerIds] = useState<string[]>(() => (offlineLayers.some((l) => l.id === activeLayerId) ? [activeLayerId] : offlineLayers[0] ? [offlineLayers[0].id] : []));
  const [existing, setExisting] = useState<DownloadMeta | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const bbox: BBox | null = customBBox ?? (tripBBox ? padBBox(tripBBox, padding) : null);
  const minZoom = config.offlineZoom.min;

  const refresh = useCallback(async () => {
    setExisting((await getDownload(trip.id)) ?? null);
    setStorage(await storageEstimate());
  }, [trip.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    drawArea(map, bbox);
    return () => drawArea(map, null);
  }, [map, bbox]);

  const selectedLayers: MapLayerConfig[] = useMemo(() => {
    const out: MapLayerConfig[] = [];
    for (const id of layerIds) {
      const l = config.mapLayers.find((x) => x.id === id);
      if (!l) continue;
      out.push(l);
      for (const o of l.overlays ?? []) {
        const ov = config.mapLayers.find((x) => x.id === o);
        if (ov && ov.offline && !out.includes(ov)) out.push(ov);
      }
    }
    return out;
  }, [layerIds, config.mapLayers]);

  const estimate = useMemo(() => {
    if (!bbox) return { tiles: 0, bytes: 0 };
    let tiles = 0, bytes = 0;
    for (const l of selectedLayers) {
      const n = countTiles(bbox, Math.max(minZoom, l.minZoom), Math.min(maxZoom, l.maxZoom));
      tiles += n;
      bytes += n * averageTileBytes(l);
    }
    return { tiles, bytes };
  }, [bbox, selectedLayers, maxZoom, minZoom]);

  const tooLarge = estimate.tiles > 25_000;
  const insufficient = storage ? storage.quota - storage.usage < estimate.bytes * 1.2 : false;

  const start = async () => {
    if (!bbox) return;
    if (insufficient) {
      toast("Not enough storage available to download this map.", "error", 6000);
      return;
    }
    abortRef.current = new AbortController();
    const meta = await downloadTrip({ trip, layers: selectedLayers, bbox, minZoom, maxZoom }, setProgress, abortRef.current.signal);
    if (meta.status === "complete") toast("Trip downloaded for offline use", "success");
    else if (meta.status === "failed") toast(`Download failed: ${meta.error}`, "error", 8000);
    setProgress(null);
    await refresh();
    onDownloadsChanged?.();
  };

  const remove = async () => {
    if (!confirm("Remove the offline copy of this trip (map tiles and photos) from this device?")) return;
    await deleteStoredTrip(trip.id);
    await refresh();
    onDownloadsChanged?.();
    toast("Offline copy removed", "info");
  };

  const pct = progress ? Math.round(((progress.tilesDone + progress.photosDone) / Math.max(1, progress.tilesTotal + progress.photosTotal)) * 100) : 0;

  return (
    <div>
      <h2>Offline download</h2>
      {existing && (
        <div className={existing.status === "complete" ? "info-box mb" : "warn-box mb"}>
          <div className="row">
            <strong className="grow">{existing.status === "complete" ? "Available offline" : `Download ${existing.status}`}</strong>
            <span className="badge green">{formatBytes(existing.bytes)}</span>
          </div>
          <div className="tiny mt">
            {existing.tilesStored.toLocaleString()} tiles · zoom {existing.minZoom}–{existing.maxZoom} · {existing.photoCount} photos · layers: {existing.layerIds.join(", ")}
            {existing.completedAt && <> · {new Date(existing.completedAt).toLocaleString("en-GB")}</>}
          </div>
          <div className="row mt">
            <button className="small danger" onClick={() => void remove()} disabled={!!progress}>
              Remove from device
            </button>
          </div>
        </div>
      )}

      {!online && <div className="warn-box mb">You are offline – downloads need an internet connection.</div>}
      {!bbox && <div className="info-box mb">Add a route or waypoints first so an area can be chosen.</div>}

      <h3>Area</h3>
      <div className="row wrap mb">
        <select value={customBBox ? "custom" : String(padding)} onChange={(e) => (e.target.value === "custom" ? null : (setCustomBBox(null), setPadding(Number(e.target.value))))} style={{ width: "auto" }}>
          <option value="500">Route + 0.5 km</option>
          <option value="1500">Route + 1.5 km</option>
          <option value="3000">Route + 3 km</option>
          <option value="6000">Route + 6 km</option>
          {customBBox && <option value="custom">Current map view</option>}
        </select>
        <button
          className="small"
          onClick={() => {
            if (!map) return;
            const b = map.getBounds();
            setCustomBBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }}
        >
          Use current map view
        </button>
        {bbox && (
          <button className="small" onClick={() => map?.fitBounds(bbox, { padding: 30 })}>
            Show area
          </button>
        )}
      </div>

      <h3>Detail</h3>
      <div className="field">
        <label>
          Maximum zoom level: <strong>{maxZoom}</strong> {maxZoom >= 16 ? "(very detailed)" : maxZoom >= 15 ? "(detailed)" : maxZoom >= 14 ? "(standard)" : "(overview)"}
        </label>
        <input type="range" min={12} max={17} value={maxZoom} onChange={(e) => setMaxZoom(Number(e.target.value))} style={{ width: "100%" }} />
        <div className="tiny muted">Zoom levels {minZoom}–{maxZoom} are stored. Higher zoom shows more detail but takes much more space.</div>
      </div>

      <h3>Map layers</h3>
      <div className="list mb">
        {offlineLayers.map((l) => (
          <label key={l.id} className="list-item" style={{ cursor: "pointer", margin: 0, color: "inherit", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={layerIds.includes(l.id)}
              onChange={(e) => setLayerIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))}
              style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
            />
            <span className="grow">
              {l.name}
              {l.overlays?.length ? <span className="tiny muted"> (+ overlays)</span> : null}
            </span>
          </label>
        ))}
      </div>

      <div className="stat-grid mb">
        <div className="stat">
          <div className="label">Tiles</div>
          <div className="value">{estimate.tiles.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Approx. size</div>
          <div className="value">{formatBytes(estimate.bytes)}</div>
        </div>
        <div className="stat">
          <div className="label">Photos</div>
          <div className="value">{trip.waypoints.reduce((n, w) => n + w.photos.length, 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Free storage</div>
          <div className="value">{storage ? formatBytes(Math.max(0, storage.quota - storage.usage)) : "–"}</div>
        </div>
      </div>
      {tooLarge && <div className="warn-box mb">That is a lot of tiles. Reduce the area or the maximum zoom to keep downloads quick and within tile-server usage policies.</div>}
      {insufficient && <div className="error-box mb">Not enough storage available to download this map.</div>}

      {progress ? (
        <div>
          <div className="row small mb">
            <span className="grow">
              {progress.phase === "photos" && `Saving photos ${progress.photosDone}/${progress.photosTotal}`}
              {progress.phase === "tiles" && `Downloading tiles ${progress.tilesDone.toLocaleString()}/${progress.tilesTotal.toLocaleString()}`}
              {progress.phase === "trip" && "Saving trip data"}
            </span>
            <span className="mono">{pct}%</span>
          </div>
          <div className="progress mb">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="row">
            <span className="tiny muted grow">
              {formatBytes(progress.bytes)} stored{progress.failed ? ` · ${progress.failed} failed` : ""}
            </span>
            <button className="small" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="primary" onClick={() => void start()} disabled={!online || !bbox || selectedLayers.length === 0 || tooLarge}>
          {existing?.status === "complete" ? "Update offline download" : "Download for offline use"}
        </button>
      )}
      <div className="tiny muted mt">
        The download includes the route, waypoints, photos, notes, checklist and the map tiles for the area above. Everything is stored on this device only.
      </div>
    </div>
  );
}
