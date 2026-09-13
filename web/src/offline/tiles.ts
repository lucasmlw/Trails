import type { MapLayerConfig } from "@trails/shared";
import type { BBox } from "../lib/geo";
import { authHeaders, apiBase } from "../api/client";

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export function lngToTileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
export function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Web-Mercator bbox of a tile, for WMS `{bbox-epsg-3857}` sources. */
export function tileToBBox3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * Math.PI * 6378137) / 2 ** z;
  const origin = -Math.PI * 6378137;
  const minx = origin + x * size;
  const maxy = -origin - y * size;
  return [minx, maxy - size, minx + size, maxy];
}

export function tilesInBBox(bbox: BBox, z: number): TileCoord[] {
  const x0 = lngToTileX(bbox[0], z), x1 = lngToTileX(bbox[2], z);
  const y0 = latToTileY(bbox[3], z), y1 = latToTileY(bbox[1], z);
  const tiles: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  return tiles;
}

export function countTiles(bbox: BBox, minZoom: number, maxZoom: number): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lngToTileX(bbox[0], z), x1 = lngToTileX(bbox[2], z);
    const y0 = latToTileY(bbox[3], z), y1 = latToTileY(bbox[1], z);
    n += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return n;
}

/** Typical compressed tile sizes used for the pre-download estimate. */
export function averageTileBytes(layer: MapLayerConfig): number {
  if (layer.id === "satellite") return 28_000;
  if (layer.kind === "overlay") return 4_000;
  return 22_000;
}

export function tileKey(layerId: string, t: TileCoord) {
  return `${layerId}/${t.z}/${t.x}/${t.y}`;
}

/** Resolve a layer's URL template into a real tile URL. */
export function tileUrl(layer: MapLayerConfig, t: TileCoord): string {
  const template = layer.tiles[(t.x + t.y) % layer.tiles.length];
  let url = template
    .replace("{z}", String(t.z))
    .replace("{x}", String(t.x))
    .replace("{y}", String(t.y))
    .replace("{bbox-epsg-3857}", tileToBBox3857(t.z, t.x, t.y).join(","));
  if (url.startsWith("/")) url = apiBase() + url;
  return url;
}

export async function fetchTile(layer: MapLayerConfig, t: TileCoord, signal?: AbortSignal): Promise<Blob> {
  const url = tileUrl(layer, t);
  const sameOrigin = url.startsWith("/") || url.startsWith(apiBase() + "/api");
  const res = await fetch(url, { signal, headers: sameOrigin ? authHeaders() : undefined, credentials: sameOrigin ? "include" : "omit" });
  if (!res.ok) throw new Error(`Tile ${res.status}`);
  return res.blob();
}
