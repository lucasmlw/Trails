import { useEffect, useState } from "react";
import type { Photo } from "@trails/shared";
import { fetchBlob } from "../api/client";
import { getStoredPhoto } from "../offline/db";

const cache = new Map<string, string>();

/**
 * Resolves a photo to a displayable URL: the locally stored blob when the
 * trip has been downloaded (works offline), otherwise the authenticated API.
 */
export function usePhotoUrl(photo: Photo, thumb: boolean): string | null {
  const key = `${photo.id}:${thumb ? "t" : "f"}`;
  const [url, setUrl] = useState<string | null>(cache.get(key) ?? null);
  useEffect(() => {
    let cancelled = false;
    if (cache.has(key)) {
      setUrl(cache.get(key)!);
      return;
    }
    (async () => {
      const stored = await getStoredPhoto(photo.id);
      let blob: Blob | null = stored ? (thumb ? stored.thumb : stored.blob) : null;
      if (!blob) {
        try {
          blob = await fetchBlob(thumb ? photo.thumbnailUrl : photo.url);
        } catch {
          blob = null;
        }
      }
      if (cancelled) return;
      if (blob) {
        const u = URL.createObjectURL(blob);
        cache.set(key, u);
        setUrl(u);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, photo, thumb]);
  return url;
}

export function PhotoImg({ photo, thumb, alt, className }: { photo: Photo; thumb: boolean; alt?: string; className?: string }) {
  const url = usePhotoUrl(photo, thumb);
  if (!url) return <div className={className} style={{ background: "#0d1611", width: "100%", height: "100%" }} />;
  return <img src={url} alt={alt ?? ""} className={className} loading="lazy" />;
}

/** Downscale an image file in the browser; returns JPEG blobs for the photo and its thumbnail. */
export async function prepareImage(file: File): Promise<{ photo: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file).catch(async () => {
    // Some browsers can't decode HEIC via createImageBitmap; fall back to <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  const resize = async (max: number, quality: number): Promise<Blob> => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", quality));
  };
  const [photo, thumb] = await Promise.all([resize(1600, 0.85), resize(240, 0.75)]);
  bitmap.close();
  return { photo, thumb };
}
