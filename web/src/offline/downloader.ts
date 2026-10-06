import type { MapLayerConfig, Trip } from "@trails/shared";
import type { BBox } from "../lib/geo";
import { fetchBlob } from "../api/client";
import { requestWakeLock } from "../location/provider";
import { getStoredPhoto, getTile, putDownload, putStoredPhoto, putStoredTrip, putTile, type DownloadMeta } from "./db";
import { countTiles, fetchTile, tileKey, tilesInBBox } from "./tiles";

export interface DownloadProgress {
  phase: "trip" | "photos" | "tiles" | "done" | "failed" | "cancelled";
  tilesDone: number;
  tilesTotal: number;
  /** tiles that were already on the device (resumed or shared with another trip) */
  tilesSkipped: number;
  photosDone: number;
  photosTotal: number;
  bytes: number;
  failed: number;
  message?: string;
}

const isQuotaError = (err: unknown) =>
  err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");

/** Phones have less memory and slower storage; keep fewer tile requests in flight there. */
function tileConcurrency(): number {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || cores <= 4 ? 3 : 6;
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
  const progress: DownloadProgress = { phase: "trip", tilesDone: 0, tilesTotal, tilesSkipped: 0, photosDone: 0, photosTotal: photos.length, bytes: 0, failed: 0 };
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

  // Phones switch the screen off and suspend the page mid-download; keep it awake while we work.
  const releaseWakeLock = await requestWakeLock();

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
        } catch (err) {
          if (isQuotaError(err)) throw new Error("Not enough storage available to download this map.");
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

    const concurrency = tileConcurrency();
    let index = 0;
    let lastFlush = Date.now();
    let lastMetaFlush = Date.now();
    const worker = async () => {
      while (index < queue.length) {
        checkCancelled();
        const item = queue[index++];
        const key = tileKey(item.layer.id, item);
        try {
          // Already on the device (interrupted earlier, or shared with another trip): don't fetch again.
          const existing = await getTile(key);
          if (existing) {
            if (!existing.tripIds.includes(trip.id)) await putTile({ ...existing, tripIds: [trip.id] });
            progress.tilesSkipped++;
          } else {
            const blob = await fetchTile(item.layer, item, signal);
            const fresh = await putTile({ key, layerId: item.layer.id, tripIds: [trip.id], blob, bytes: blob.size });
            if (fresh) progress.bytes += blob.size;
          }
          meta.tilesStored++;
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          if (isQuotaError(err)) throw new Error("Not enough storage available to download this map.");
          progress.failed++;
        }
        progress.tilesDone++;
        const now = Date.now();
        if (now - lastFlush > 150 || progress.tilesDone === tilesTotal) {
          lastFlush = now;
          onProgress({ ...progress });
        }
        // Persist partial progress so an interrupted download can report what it kept.
        if (now - lastMetaFlush > 2000) {
          lastMetaFlush = now;
          meta.bytes = progress.bytes;
          await putDownload({ ...meta });
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
  } finally {
    releaseWakeLock();
  }
}
