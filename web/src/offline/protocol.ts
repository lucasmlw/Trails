import maplibregl from "maplibre-gl";
import type { MapLayerConfig } from "@trails/shared";
import { getTile } from "./db";
import { fetchTile, tileKey } from "./tiles";

export const OFFLINE_PROTOCOL = "offline";

let layers = new Map<string, MapLayerConfig>();

export function registerLayers(list: MapLayerConfig[]) {
  layers = new Map(list.map((l) => [l.id, l]));
}

export function offlineTileTemplate(layerId: string) {
  return `${OFFLINE_PROTOCOL}://${layerId}/{z}/{x}/{y}`;
}

// 1x1 transparent PNG used when nothing at all is available for a tile.
const EMPTY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
).buffer;

async function blobToArrayBuffer(blob: Blob) {
  return blob.arrayBuffer();
}

/**
 * When a tile has not been downloaded but one of its ancestors has, crop and
 * upscale the relevant quadrant so the offline map degrades gracefully when
 * zooming in past the downloaded zoom levels.
 */
async function fromAncestor(layerId: string, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  for (let up = 1; up <= 5 && z - up >= 0; up++) {
    const pz = z - up, px = x >> up, py = y >> up;
    const parent = await getTile(tileKey(layerId, { z: pz, x: px, y: py }));
    if (!parent) continue;
    try {
      const bitmap = await createImageBitmap(parent.blob);
      const size = bitmap.width;
      const scale = 2 ** up;
      const sub = size / scale;
      const sx = (x - px * scale) * sub, sy = (y - py * scale) * sub;
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, sx, sy, sub, sub, 0, 0, size, size);
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type: "image/png" })
          : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
      return blobToArrayBuffer(blob);
    } catch {
      return null;
    }
  }
  return null;
}

let installed = false;

export function installOfflineProtocol() {
  if (installed) return;
  installed = true;
  maplibregl.addProtocol(OFFLINE_PROTOCOL, async (params, abortController) => {
    const m = params.url.match(/^offline:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) throw new Error(`Bad offline tile url ${params.url}`);
    const layerId = m[1];
    const z = Number(m[2]), x = Number(m[3]), y = Number(m[4]);
    const stored = await getTile(tileKey(layerId, { z, x, y }));
    if (stored) return { data: await blobToArrayBuffer(stored.blob) };

    const layer = layers.get(layerId);
    if (layer && navigator.onLine) {
      try {
        const blob = await fetchTile(layer, { z, x, y }, abortController.signal);
        return { data: await blobToArrayBuffer(blob) };
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
      }
    }
    const fallback = await fromAncestor(layerId, z, x, y);
    if (fallback) return { data: fallback };
    return { data: EMPTY_PNG.slice(0) };
  });
}
