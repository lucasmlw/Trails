import type { MapLayerConfig, Trip } from "@trails/shared";
import type { BBox } from "../lib/geo";
import { fetchBlob } from "../api/client";
import { getStoredPhoto, putDownload, putStoredPhoto, putStoredTrip, putTile, type DownloadMeta } from "./db";
import { countTiles, fetchTile, tileKey, tilesInBBox } from "./tiles";

export interface DownloadProgress {
  phase: "trip" | "photos" | "tiles" | "done" | "failed" | "cancelled";
  tilesDone: number;
  tilesTotal: number;
  photosDone: number;
  photosTotal: number;
  bytes: number;
  failed: number;
  message?: string;
}

export interface DownloadRequest {
  trip: Trip;
  layers: MapLayerConfig[];
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
}

/**
 * Stores everything needed to open and navigate the trip without a network:
 * trip JSON (route, waypoints, notes, checklist), waypoint photos, and map
 * tiles for the chosen layers inside the selected area.
 */
export async function downloadTrip(req: DownloadRequest, onProgress: (p: DownloadProgress) => void, signal: AbortSignal): Promise<DownloadMeta> {
  const { trip, layers, bbox, minZoom, maxZoom } = req;
  const tilesTotal = layers.reduce((n, l) => n + countTiles(bbox, Math.max(minZoom, l.minZoom), Math.min(maxZoom, l.maxZoom)), 0);
  const photos = trip.waypoints.flatMap((w) => w.photos.map((p) => ({ ...p, tripId: trip.id })));
  const progress: DownloadProgress = { phase: "trip", tilesDone: 0, tilesTotal, photosDone: 0, photosTotal: photos.length, bytes: 0, failed: 0 };
  const meta: DownloadMeta = {
    tripId: trip.id,
    layerIds: layers.map((l) => l.id),
    bbox,
    minZoom,
    maxZoom,
    tileCount: tilesTotal,
    tilesStored: 0,
    bytes: 0,
    photoCount: photos.length,
    status: "downloading",
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  await putDownload(meta);
  onProgress({ ...progress });
  // Ask the browser not to evict our data under storage pressure; granted silently for installed PWAs.
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);

  const checkCancelled = () => {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  };

  try {
    await putStoredTrip(trip, false);
    checkCancelled();

    progress.phase = "photos";
    for (const p of photos) {
      checkCancelled();
      if (!(await getStoredPhoto(p.id))) {
        try {
          const [blob, thumb] = await Promise.all([fetchBlob(p.url), fetchBlob(p.thumbnailUrl)]);
          await putStoredPhoto({ id: p.id, waypointId: p.waypointId, tripId: trip.id, blob, thumb, mimeType: blob.type || "image/jpeg" });
          progress.bytes += blob.size + thumb.size;
        } catch {
          progress.failed++;
        }
      }
      progress.photosDone++;
      onProgress({ ...progress });
    }

    progress.phase = "tiles";
    const queue: { layer: MapLayerConfig; z: number; x: number; y: number }[] = [];
    for (const layer of layers) {
      for (let z = Math.max(minZoom, layer.minZoom); z <= Math.min(maxZoom, layer.maxZoom); z++) {
        for (const t of tilesInBBox(bbox, z)) queue.push({ layer, ...t });
      }
    }
    // Low zooms first so the map is usable even if the download is interrupted.
    queue.sort((a, b) => a.z - b.z);

    const concurrency = 6;
    let index = 0;
    let lastFlush = Date.now();
    const worker = async () => {
      while (index < queue.length) {
        checkCancelled();
        const item = queue[index++];
        const key = tileKey(item.layer.id, item);
        try {
          const blob = await fetchTile(item.layer, item, signal);
          const fresh = await putTile({ key, layerId: item.layer.id, tripIds: [trip.id], blob, bytes: blob.size });
          if (fresh) progress.bytes += blob.size;
          meta.tilesStored++;
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          progress.failed++;
        }
        progress.tilesDone++;
        if (Date.now() - lastFlush > 150 || progress.tilesDone === tilesTotal) {
          lastFlush = Date.now();
          onProgress({ ...progress });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    meta.status = "complete";
    meta.bytes = progress.bytes;
    meta.completedAt = new Date().toISOString();
    await putDownload(meta);
    progress.phase = "done";
    onProgress({ ...progress });
    return meta;
  } catch (err) {
    const cancelled = (err as Error).name === "AbortError";
    meta.status = cancelled ? "cancelled" : "failed";
    meta.bytes = progress.bytes;
    meta.error = cancelled ? undefined : (err as Error).message;
    await putDownload(meta);
    progress.phase = cancelled ? "cancelled" : "failed";
    progress.message = meta.error;
    onProgress({ ...progress });
    return meta;
  }
}
