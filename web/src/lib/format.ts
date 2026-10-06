export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || Number.isNaN(metres)) return "–";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatElevation(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return "–";
  return `${Math.round(m)} m`;
}

export function formatSpeed(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) return "–";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${days >= 14 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export type CoordFormat = "dd" | "dms";

function toDms(value: number, pos: string, neg: string): string {
  const hemi = value < 0 ? neg : pos;
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}° ${String(m).padStart(2, "0")}′ ${s.padStart(4, "0")}″ ${hemi}`;
}

export function formatCoords(lat: number, lng: number, fmt: CoordFormat): string {
  if (fmt === "dms") return `${toDms(lat, "N", "S")}  ${toDms(lng, "E", "W")}`;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
