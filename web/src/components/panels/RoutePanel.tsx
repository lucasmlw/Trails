import { useMemo } from "react";
import { ROUTING_MODES, type LngLat, type RoutingMode } from "@trails/shared";
import { useRouteEditor } from "../../store/routeEditor";
import { computeStats, routeCoordinates, straightSegment } from "../../lib/geo";
import { RouteStats } from "../route/RouteStats";
import { ElevationProfile } from "../route/ElevationProfile";

interface Props {
  canEdit: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onHover: (p: LngLat | null) => void;
  onExportGpx: () => void;
  onNavigate: () => void;
  offline: boolean;
}

export function RoutePanel({ canEdit, saving, onSave, onCancel, onHover, onExportGpx, onNavigate, offline }: Props) {
  const editor = useRouteEditor();
  const { points, segments, mode, busy, error, dirty, past, future } = editor;

  const complete = useMemo(() => segments.map((s, i) => s ?? straightSegment(mode, points[i], points[i + 1])), [segments, points, mode]);
  const stats = useMemo(() => computeStats(complete), [complete]);
  const coords = useMemo(() => routeCoordinates({ segments: complete }), [complete]);
  const hasStraight = complete.some((s) => s.straight);

  return (
    <div>
      {canEdit ? (
        <>
          <div className="field">
            <label>Routing mode</label>
            <div className="row wrap">
              {ROUTING_MODES.map((m) => (
                <button key={m.id} className={"small" + (mode === m.id ? " active" : "")} onClick={() => editor.setMode(m.id as RoutingMode)} title={m.description}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="row wrap mb">
            <button className="small" onClick={editor.undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button className="small" onClick={editor.redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
              ↷ Redo
            </button>
            <button className="small" onClick={editor.reverse} disabled={points.length < 2}>
              ⇄ Reverse
            </button>
            <button className="small danger" onClick={editor.clear} disabled={points.length === 0}>
              Clear
            </button>
            {busy > 0 && (
              <span className="row small muted right">
                <span className="spinner" /> Routing…
              </span>
            )}
          </div>

          {points.length === 0 && (
            <div className="info-box mb">
              Click on the map to set a start point, then keep clicking to extend the route. The route follows paths and tracks for the selected mode.
              Drag any part of the line to reshape it; drag a point to move it; click a point to delete it.
            </div>
          )}

          {error && (
            <div className="error-box mb row">
              <span className="grow">{error}</span>
              <button className="small" onClick={editor.retryFailed}>
                Retry
              </button>
              <button className="small ghost" onClick={editor.dismissError}>
                ✕
              </button>
            </div>
          )}
          {!error && hasStraight && (
            <div className="warn-box mb row">
              <span className="grow">Some sections use straight lines (dashed red) because no route could be calculated{offline ? " offline" : ""}.</span>
              {!offline && (
                <button className="small" onClick={editor.retryFailed}>
                  Retry
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        points.length === 0 && <div className="info-box mb">This trip has no route yet.</div>
      )}

      {points.length > 0 && (
        <>
          <RouteStats stats={stats} />
          <div className="row small muted mt" style={{ justifyContent: "space-between" }}>
            <span>
              Start {points[0][1].toFixed(4)}, {points[0][0].toFixed(4)}
            </span>
            <span>
              End {points[points.length - 1][1].toFixed(4)}, {points[points.length - 1][0].toFixed(4)}
            </span>
          </div>
          <h3>Elevation profile</h3>
          <ElevationProfile coordinates={coords} onHover={onHover} />
          <div className="tiny muted mt">
            {points.length} routing point{points.length === 1 ? "" : "s"} · {ROUTING_MODES.find((m) => m.id === mode)?.label}
          </div>
        </>
      )}

      <div className="row wrap mt" style={{ position: "sticky", bottom: 0, background: "var(--panel)", paddingTop: 10 }}>
        {canEdit && (
          <>
            <button className="primary" onClick={onSave} disabled={!dirty || saving || busy > 0}>
              {saving ? "Saving…" : dirty ? "Save route" : "Saved"}
            </button>
            <button onClick={onCancel} disabled={!dirty || saving}>
              Cancel changes
            </button>
          </>
        )}
        <button className="right" onClick={onExportGpx} disabled={points.length === 0} title="Download as GPX">
          ⤓ GPX
        </button>
        <button onClick={onNavigate} disabled={points.length === 0}>
          Navigate ▸
        </button>
      </div>
    </div>
  );
}
