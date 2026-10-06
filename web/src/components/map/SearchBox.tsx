import { useEffect, useRef, useState } from "react";
import type { GeocodeResult, LngLat } from "@trails/shared";
import { api } from "../../api/client";
import { parseCoordinates } from "../../lib/coords";
import { formatCoords } from "../../lib/format";
import { useMap } from "./MapView";

interface Props {
  onCreateWaypoint?: (lngLat: LngLat, name: string) => void;
}

export function SearchBox({ onCreateWaypoint }: Props) {
  const map = useMap();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const search = async (text: string) => {
    setError(null);
    const coords = parseCoordinates(text);
    if (coords) {
      setResults([{ name: "Coordinates", displayName: formatCoords(coords[1], coords[0], "dd"), lat: coords[1], lng: coords[0], type: "coordinates" }]);
      setOpen(true);
      return;
    }
    if (text.trim().length < 3) {
      setResults([]);
      return;
    }
    setBusy(true);
    try {
      const { results } = await api<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(text)}`);
      setResults(results);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const onChange = (v: string) => {
    setQ(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void search(v), 350);
  };

  const go = (r: GeocodeResult) => {
    if (!map) return;
    if (r.bbox && r.type !== "coordinates") map.fitBounds(r.bbox, { padding: 40, maxZoom: 14 });
    else map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 14) });
    setOpen(false);
  };

  return (
    <div className="search-box" ref={ref}>
      <input
        type="search"
        placeholder="Search place, road, grid ref or lat, lng"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            window.clearTimeout(timer.current);
            void search(q);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label="Search"
      />
      {busy && <span className="spinner" style={{ position: "absolute", right: 10, top: 11 }} />}
      {open && (results.length > 0 || error) && (
        <div className="floating search-results">
          {error && <div className="small muted" style={{ padding: 8 }}>{error}</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => go(r)}>
              <span className="row" style={{ width: "100%" }}>
                <strong className="truncate grow">{r.name}</strong>
                <span className="badge">{r.type}</span>
              </span>
              <span className="tiny muted truncate" style={{ width: "100%" }}>
                {r.displayName}
              </span>
              {onCreateWaypoint && (
                <span
                  className="tiny"
                  style={{ color: "var(--accent)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateWaypoint([r.lng, r.lat], r.name);
                    go(r);
                  }}
                >
                  + Add waypoint here
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
