import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { LngLat, Position } from "@trails/shared";
import { TopBar } from "../components/TopBar";
import { MapView } from "../components/map/MapView";
import { LayerSwitcher } from "../components/map/LayerSwitcher";
import { RouteDisplayLayer } from "../components/map/RouteLayer";
import { WaypointMarkers } from "../components/map/WaypointMarkers";
import { MapCapture, TrackLayer } from "../components/map/MapHelpers";
import { GpsMarker } from "../components/map/GpsMarker";
import { useTrip } from "../store/trip";
import { useRecorder } from "../store/recorder";
import { useNetwork } from "../store/network";
import { getLocationProvider, requestWakeLock, type LocationError, type LocationFix } from "../location/provider";
import { bboxOf, bearing, estimateDuration, haversine, lineLength, nearestPointOnLine, padBBox, routeCoordinates } from "../lib/geo";
import { formatCoords, formatDistance, formatDuration, formatElevation, formatSpeed, type CoordFormat } from "../lib/format";
import { categoryStyle } from "../lib/waypoints";

export function NavigationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { trip, loading, error, load, clear } = useTrip();
  const recorder = useRecorder();
  const online = useNetwork((s) => s.online);

  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [gpsError, setGpsError] = useState<{ kind: LocationError; message: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [coordFormat, setCoordFormat] = useState<CoordFormat>((localStorage.getItem("trails_coord_format") as CoordFormat) || "dd");
  const [selectedWp, setSelectedWp] = useState<string | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const prevFix = useRef<LocationFix | null>(null);
  const [computedHeading, setComputedHeading] = useState<number | null>(null);
  const speedWindow = useRef<{ t: number; d: number }[]>([]);

  useEffect(() => {
    void load(id);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // GPS watch (always on while this screen is open).
  useEffect(() => {
    let stop: (() => void) | null = null;
    let releaseWake: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      releaseWake = await requestWakeLock();
      stop = await getLocationProvider().watch(
        (f) => {
          if (cancelled) return;
          setGpsError(null);
          setFix(f);
          setLastFixAt(Date.now());
          const prev = prevFix.current;
          if (prev) {
            const d = haversine([prev.lng, prev.lat], [f.lng, f.lat]);
            if (d > Math.max(3, (f.accuracy ?? 10) / 2)) setComputedHeading(bearing([prev.lng, prev.lat], [f.lng, f.lat]));
            speedWindow.current.push({ t: f.timestamp, d });
            speedWindow.current = speedWindow.current.filter((s) => f.timestamp - s.t < 5 * 60_000);
          }
          prevFix.current = f;
          useRecorder.getState().addFix(f);
        },
        (kind, message) => {
          if (!cancelled) setGpsError({ kind, message });
        },
      );
    })();
    return () => {
      cancelled = true;
      stop?.();
      releaseWake?.();
    };
  }, []);

  // Follow the user.
  useEffect(() => {
    if (!map || !fix || !follow) return;
    map.easeTo({ center: [fix.lng, fix.lat], duration: 500, zoom: Math.max(map.getZoom(), 14) });
  }, [map, fix, follow]);

  useEffect(() => {
    if (!map) return;
    const off = () => setFollow(false);
    map.on("dragstart", off);
    return () => {
      map.off("dragstart", off);
    };
  }, [map]);

  const routeCoords: Position[] = useMemo(() => routeCoordinates(trip?.route), [trip?.route]);
  const routeTotal = useMemo(() => lineLength(routeCoords), [routeCoords]);

  const nav = useMemo(() => {
    if (!fix || routeCoords.length < 2) return null;
    const np = nearestPointOnLine(routeCoords, [fix.lng, fix.lat]);
    if (!np) return null;
    const remaining = Math.max(0, routeTotal - np.along);
    const offThreshold = Math.max(40, 3 * (fix.accuracy ?? 15));
    const routeElev = routeCoords[np.index]?.[2] ?? null;
    return { along: np.along, remaining, offRoute: np.distance, isOff: np.distance > offThreshold, progress: routeTotal ? np.along / routeTotal : 0, routeElev };
  }, [fix, routeCoords, routeTotal]);

  const avgSpeed = useMemo(() => {
    const w = speedWindow.current;
    if (w.length < 2) return null;
    const dist = w.reduce((s, x) => s + x.d, 0);
    const time = (w[w.length - 1].t - w[0].t) / 1000;
    return time > 30 && dist > 20 ? dist / time : null;
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  const eta = useMemo(() => {
    if (!nav) return null;
    if (avgSpeed && avgSpeed > 0.3) return nav.remaining / avgSpeed;
    return trip?.route ? estimateDuration(trip.route.routingMode, nav.remaining) : null;
  }, [nav, avgSpeed, trip?.route]);

  const liveTrack = recorder.track?.points ?? [];
  const heading = fix?.heading ?? computedHeading;
  const stale = lastFixAt != null && Date.now() - lastFixAt > 30_000;

  const initialBounds = useMemo(() => {
    if (!trip) return null;
    const b = bboxOf([...routeCoords, ...trip.waypoints.map((w) => [w.lng, w.lat] as LngLat)]);
    return b ? padBBox(b, 300) : null;
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCoordFormat = () => {
    const next = coordFormat === "dd" ? "dms" : "dd";
    setCoordFormat(next);
    localStorage.setItem("trails_coord_format", next);
  };

  if (loading && !trip) {
    return (
      <div className="app">
        <TopBar back="/" title="Loading…" />
        <div className="page center muted">
          <span className="spinner" /> Loading trip…
        </div>
      </div>
    );
  }
  if (error || !trip) {
    return (
      <div className="app">
        <TopBar back="/" title="Navigation" />
        <div className="page">
          <div className="container">
            <div className="error-box">{error ?? "Trip not found"}</div>
            {!online && <div className="info-box mt">You are offline. Only trips downloaded to this device can be opened.</div>}
          </div>
        </div>
      </div>
    );
  }

  const selectedWaypoint = trip.waypoints.find((w) => w.id === selectedWp);
  const recordingThisTrip = recorder.tripId === trip.id;

  return (
    <div className="app">
      <TopBar back={`/trips/${trip.id}`} title={trip.name} />
      <div className="nav-layout">
        <div className="nav-map">
          <MapView bounds={initialBounds} className="map-container">
            <MapCapture onMap={setMap} />
            <TrackLayer tracks={trip.tracks} live={recordingThisTrip ? liveTrack : undefined} />
            <RouteDisplayLayer route={trip.route} />
            <WaypointMarkers waypoints={trip.waypoints} selectedId={selectedWp} onSelect={(wid) => setSelectedWp((cur) => (cur === wid ? null : wid))} />
            <GpsMarker fix={fix} heading={heading} />
            <div className="map-overlay-tl">
              <GpsIndicator fix={fix} error={gpsError} stale={stale} />
              {nav?.isOff && (
                <div className="floating" style={{ padding: "6px 10px", color: "var(--warn)", fontSize: 13 }}>
                  Off route by {formatDistance(nav.offRoute)}
                </div>
              )}
              {selectedWaypoint && (
                <div className="floating" style={{ padding: "8px 10px", maxWidth: 260 }}>
                  <div className="row">
                    <span className="wp-icon" style={{ background: categoryStyle(selectedWaypoint.category).color, width: 22, height: 22, fontSize: 12 }}>
                      {categoryStyle(selectedWaypoint.category).glyph}
                    </span>
                    <strong className="grow truncate">{selectedWaypoint.name}</strong>
                    {fix && <span className="tiny muted">{formatDistance(haversine([fix.lng, fix.lat], [selectedWaypoint.lng, selectedWaypoint.lat]))}</span>}
                  </div>
                  {selectedWaypoint.description && <div className="tiny muted mt">{selectedWaypoint.description}</div>}
                </div>
              )}
            </div>
            <div className="map-overlay-tr" style={{ right: 50 }}>
              <LayerSwitcher />
              <button className={"floating" + (follow ? " active" : "")} onClick={() => setFollow((f) => !f)} title="Keep my position centred">
                ◎ {follow ? "Following" : "Follow"}
              </button>
              {routeCoords.length > 0 && (
                <button className="floating" onClick={() => initialBounds && map?.fitBounds(initialBounds, { padding: 40 })} title="Show whole route">
                  ⤢ Route
                </button>
              )}
            </div>
          </MapView>
        </div>

        <div className="nav-panel">
          <div className="nav-stats">
            <Stat label="Remaining" value={nav ? formatDistance(nav.remaining) : "–"} />
            <Stat label="Travelled" value={recordingThisTrip ? formatDistance(recorder.distance) : nav ? formatDistance(nav.along) : "–"} />
            <Stat label="ETA" value={eta != null ? formatDuration(eta) : "–"} />
            <Stat label="Speed" value={formatSpeed(fix?.speed ?? avgSpeed)} />
            <Stat label="Elevation" value={formatElevation(fix?.altitude ?? nav?.routeElev)} />
            <Stat label="Progress" value={nav ? `${Math.round(nav.progress * 100)}%` : "–"} />
            <Stat label="Accuracy" value={fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : "–"} />
            <Stat label="Route" value={formatDistance(routeTotal)} />
          </div>
          {nav && (
            <div className="progress mb">
              <div style={{ width: `${Math.round(nav.progress * 100)}%` }} />
            </div>
          )}
          <div className="row wrap">
            <span className="small mono muted" style={{ cursor: "pointer" }} onClick={toggleCoordFormat} title="Toggle coordinate format">
              {fix ? formatCoords(fix.lat, fix.lng, coordFormat) : gpsError?.message ?? "Waiting for GPS…"}
            </span>
            <div className="row right">
              {recorder.status === "idle" || !recordingThisTrip ? (
                <button className="primary" onClick={() => void recorder.start(trip.id)} disabled={recorder.status !== "idle"}>
                  ● Start tracking
                </button>
              ) : (
                <>
                  {recorder.status === "recording" ? (
                    <button onClick={() => void recorder.pause()}>❚❚ Pause</button>
                  ) : (
                    <button className="primary" onClick={recorder.resume}>
                      ▶ Resume
                    </button>
                  )}
                  <button
                    className="danger"
                    onClick={async () => {
                      const track = await recorder.stop();
                      if (track) useTrip.getState().setTrip({ ...trip, tracks: [...trip.tracks.filter((t) => t.id !== track.id), track] });
                    }}
                  >
                    ■ Stop & save
                  </button>
                </>
              )}
            </div>
          </div>
          {recordingThisTrip && recorder.status !== "idle" && (
            <div className="tiny muted mt">
              {recorder.status === "paused" ? "Paused · " : "Recording · "}
              {liveTrack.length} points · {formatDistance(recorder.distance)}
            </div>
          )}
          {recorder.status !== "idle" && !recordingThisTrip && <div className="warn-box mt tiny">A track is being recorded for another trip. Stop it there first.</div>}
          {trip.tracks.length > 0 && (
            <div className="tiny muted mt">
              {trip.tracks.length} saved track{trip.tracks.length === 1 ? "" : "s"} shown in blue ·{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), navigate(`/trips/${trip.id}`))}>
                manage in trip
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function GpsIndicator({ fix, error, stale }: { fix: LocationFix | null; error: { kind: LocationError; message: string } | null; stale: boolean }) {
  const acc = fix?.accuracy ?? null;
  const bars = !fix || stale ? 0 : acc == null ? 4 : acc <= 10 ? 4 : acc <= 25 ? 3 : acc <= 50 ? 2 : 1;
  const cls = bars === 0 ? "bad" : bars <= 1 ? "bad" : bars === 2 ? "poor" : "";
  const label = error ? error.message : !fix ? "Searching for GPS…" : stale ? "GPS signal lost" : acc == null ? "GPS" : acc <= 10 ? "GPS good" : acc <= 25 ? "GPS ok" : acc <= 50 ? "GPS poor" : "GPS very poor";
  return (
    <div className={"floating gps-indicator " + cls} style={{ padding: "6px 10px" }}>
      {[6, 9, 12, 15].map((h, i) => (
        <span key={h} className={"bar" + (i < bars ? " on" : "")} style={{ height: h }} />
      ))}
      <span>{label}</span>
    </div>
  );
}
