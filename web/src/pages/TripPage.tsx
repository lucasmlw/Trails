import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { LngLat } from "@trails/shared";
import { api } from "../api/client";
import { TopBar } from "../components/TopBar";
import { MapView } from "../components/map/MapView";
import { LayerSwitcher } from "../components/map/LayerSwitcher";
import { SearchBox } from "../components/map/SearchBox";
import { RouteEditorLayer } from "../components/map/RouteLayer";
import { WaypointMarkers } from "../components/map/WaypointMarkers";
import { MapCapture, MapClickCapture, TrackLayer } from "../components/map/MapHelpers";
import { RoutePanel } from "../components/panels/RoutePanel";
import { WaypointsPanel, type WaypointDraft } from "../components/panels/WaypointsPanel";
import { NotesPanel } from "../components/panels/NotesPanel";
import { ChecklistPanel } from "../components/panels/ChecklistPanel";
import { SharePanel } from "../components/panels/SharePanel";
import { DownloadPanel } from "../components/panels/DownloadPanel";
import { useTrip } from "../store/trip";
import { useRouteEditor } from "../store/routeEditor";
import { useNetwork } from "../store/network";
import { deleteStoredTrip } from "../offline/db";
import { bboxOf, padBBox, routeCoordinates } from "../lib/geo";
import { downloadGpx } from "../lib/gpx";
import type { CoordFormat } from "../lib/format";
import { toast } from "../store/toast";

type Tab = "route" | "waypoints" | "notes" | "checklist" | "offline" | "share";

const TABS: { id: Tab; label: string }[] = [
  { id: "route", label: "Route" },
  { id: "waypoints", label: "Waypoints" },
  { id: "notes", label: "Notes" },
  { id: "checklist", label: "Checklist" },
  { id: "offline", label: "Offline" },
  { id: "share", label: "Share" },
];

export function TripPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { trip, loading, error, load, saveRoute, upsertWaypoint, clear } = useTrip();
  const editor = useRouteEditor();
  const { online, pending, sync } = useNetwork();

  const [tab, setTab] = useState<Tab>("route");
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [selectedWp, setSelectedWp] = useState<string | null>(null);
  const [draft, setDraft] = useState<WaypointDraft | null>(null);
  const [hover, setHover] = useState<LngLat | null>(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coordFormat, setCoordFormat] = useState<CoordFormat>((localStorage.getItem("trails_coord_format") as CoordFormat) || "dd");

  useEffect(() => {
    (async () => {
      if (pending > 0 && online) await sync();
      await load(id);
    })();
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Load the saved route into the editor whenever a (different) trip arrives and there are no unsaved edits.
  useEffect(() => {
    if (!trip) return;
    if (!editor.dirty) editor.load(trip.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.route]);

  const canEdit = trip ? trip.permission !== "view" : false;
  const editing = tab === "route" && canEdit;

  // Initial view: saved map position, else route/waypoint extent.
  const initialBounds = useMemo(() => {
    if (!trip) return null;
    const coords = [...routeCoordinates(trip.route), ...trip.waypoints.map((w) => [w.lng, w.lat] as LngLat)];
    const b = bboxOf(coords);
    return b ? padBBox(b, 300) : null;
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editing) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, editor]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [editor.dirty]);

  const onSaveRoute = async () => {
    if (!trip) return;
    setSaving(true);
    try {
      const view = map ? { center: [map.getCenter().lng, map.getCenter().lat] as [number, number], zoom: map.getZoom() } : undefined;
      await saveRoute(editor.toRouteData(), view);
      editor.markSaved();
      toast("Route saved", "success");
    } catch {
      /* toast from store */
    } finally {
      setSaving(false);
    }
  };

  const onCancelRoute = () => {
    if (trip) editor.load(trip.route);
  };

  const flyTo = useCallback(
    (lngLat: LngLat) => {
      map?.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 14) });
    },
    [map],
  );

  const onMapClick = useCallback((lngLat: LngLat) => setDraft((d) => (d ? { ...d, lngLat } : d)), []);
  const onDraftMove = useCallback((lngLat: LngLat) => setDraft((d) => (d ? { ...d, lngLat } : d)), []);

  const onWaypointMove = useCallback(
    (wpId: string, lngLat: LngLat) => {
      const wp = trip?.waypoints.find((w) => w.id === wpId);
      if (!wp) return;
      void upsertWaypoint({ id: wp.id, name: wp.name, description: wp.description, category: wp.category, lat: lngLat[1], lng: lngLat[0] });
    },
    [trip, upsertWaypoint],
  );

  const onSelectWp = useCallback((wpId: string) => {
    setSelectedWp(wpId);
    setTab("waypoints");
    setCollapsed(false);
  }, []);

  const createWaypointFromSearch = useCallback((lngLat: LngLat, name: string) => {
    setTab("waypoints");
    setSelectedWp(null);
    setDraft({ name, description: "", category: "custom", lngLat });
  }, []);

  const toggleCoordFormat = () => {
    const next = coordFormat === "dd" ? "dms" : "dd";
    setCoordFormat(next);
    localStorage.setItem("trails_coord_format", next);
  };

  const duplicate = async () => {
    if (!trip) return;
    try {
      const res = await api<{ trip: { id: string } }>(`/api/trips/${trip.id}/duplicate`, { method: "POST" });
      toast("Trip duplicated", "success");
      navigate(`/trips/${res.trip.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const remove = async () => {
    if (!trip || !confirm(`Delete trip "${trip.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/trips/${trip.id}`, { method: "DELETE" });
      await deleteStoredTrip(trip.id).catch(() => {});
      navigate("/");
    } catch (err) {
      toast((err as Error).message, "error");
    }
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
        <TopBar back="/" title="Trip" />
        <div className="page">
          <div className="container">
            <div className="error-box">{error ?? "Trip not found"}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar back="/" title={trip.name}>
        <div style={{ position: "relative" }}>
          <button className="small" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu">
            ⋯
          </button>
          {menuOpen && (
            <div className="floating layer-menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20 }} onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => navigate(`/trips/${trip.id}/navigate`)}>▸ Navigate</button>
              <button onClick={() => downloadGpx(trip)}>⤓ Export GPX</button>
              <button onClick={() => void duplicate()} disabled={!online}>
                ⧉ Duplicate
              </button>
              {trip.permission === "owner" && (
                <button onClick={() => void remove()} disabled={!online} style={{ color: "#ffd6d2" }}>
                  🗑 Delete trip
                </button>
              )}
            </div>
          )}
        </div>
      </TopBar>

      <div className="trip-layout">
        <aside className={"side-panel" + (collapsed ? " collapsed" : "")}>
          <div className="tabs">
            <button className="panel-toggle ghost" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "Expand" : "Collapse"}>
              {collapsed ? "▲" : "▼"}
            </button>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => {
                  setTab(t.id);
                  setCollapsed(false);
                  if (t.id !== "waypoints") setDraft(null);
                }}
              >
                {t.label}
                {t.id === "checklist" && trip.checklist.length > 0 && (
                  <span className="tiny muted"> {trip.checklist.filter((c) => c.completed).length}/{trip.checklist.length}</span>
                )}
                {t.id === "waypoints" && trip.waypoints.length > 0 && <span className="tiny muted"> {trip.waypoints.length}</span>}
              </button>
            ))}
          </div>
          <div className="panel-body">
            {tab === "route" && (
              <RoutePanel
                tracks={trip.tracks}
                canEdit={canEdit}
                saving={saving}
                onSave={onSaveRoute}
                onCancel={onCancelRoute}
                onHover={setHover}
                onExportGpx={() => downloadGpx({ ...trip, route: editor.toRouteData() })}
                onNavigate={() => navigate(`/trips/${trip.id}/navigate`)}
                offline={!online}
              />
            )}
            {tab === "waypoints" && (
              <WaypointsPanel
                trip={trip}
                canEdit={canEdit}
                selectedId={selectedWp}
                onSelect={setSelectedWp}
                draft={draft}
                onDraftChange={setDraft}
                onFlyTo={flyTo}
                coordFormat={coordFormat}
                onToggleCoordFormat={toggleCoordFormat}
              />
            )}
            {tab === "notes" && <NotesPanel trip={trip} canEdit={canEdit} />}
            {tab === "checklist" && <ChecklistPanel trip={trip} canEdit={canEdit} />}
            {tab === "offline" && <DownloadPanel trip={trip} map={map} online={online} />}
            {tab === "share" && <SharePanel trip={trip} />}
          </div>
        </aside>

        <main className="map-area">
          <MapView center={trip.mapCenter ?? undefined} zoom={trip.mapZoom ?? undefined} bounds={trip.mapCenter ? null : initialBounds}>
            <MapCapture onMap={setMap} />
            <TrackLayer tracks={trip.tracks} />
            <RouteEditorLayer editable={editing && !draft} highlight={hover} />
            <WaypointMarkers
              waypoints={trip.waypoints}
              selectedId={selectedWp}
              onSelect={onSelectWp}
              onMove={canEdit ? onWaypointMove : undefined}
              draft={draft ? { lngLat: draft.lngLat ?? [0, 0], category: draft.category } : null}
              onDraftMove={onDraftMove}
            />
            <MapClickCapture active={!!draft} onClick={onMapClick} />
            <div className="map-overlay-tl">
              <SearchBox onCreateWaypoint={canEdit ? createWaypointFromSearch : undefined} />
              {editing && !draft && (
                <div className="floating toolbar">
                  <button className="small" onClick={editor.undo} disabled={editor.past.length === 0} title="Undo">
                    ↶
                  </button>
                  <button className="small" onClick={editor.redo} disabled={editor.future.length === 0} title="Redo">
                    ↷
                  </button>
                  <span className="sep" />
                  <button className="small primary" onClick={onSaveRoute} disabled={!editor.dirty || saving || editor.busy > 0}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {editor.busy > 0 && <span className="spinner" style={{ margin: "0 6px" }} />}
                </div>
              )}
              {draft && <div className="floating toolbar small" style={{ padding: "6px 10px" }}>Click the map to place the waypoint</div>}
            </div>
            <div className="map-overlay-tr" style={{ top: 10, right: 50 }}>
              <LayerSwitcher />
            </div>
          </MapView>
        </main>
      </div>
    </div>
  );
}
