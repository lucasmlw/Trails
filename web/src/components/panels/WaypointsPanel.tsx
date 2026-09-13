import { useEffect, useRef, useState } from "react";
import { WAYPOINT_CATEGORIES, type LngLat, type Photo, type Trip, type Waypoint, type WaypointCategory } from "@trails/shared";
import { useTrip } from "../../store/trip";
import { categoryStyle } from "../../lib/waypoints";
import { formatCoords, type CoordFormat } from "../../lib/format";
import { PhotoImg, prepareImage } from "../PhotoImg";
import { toast } from "../../store/toast";

export interface WaypointDraft {
  id?: string;
  name: string;
  description: string;
  category: WaypointCategory;
  lngLat: LngLat | null;
}

interface Props {
  trip: Trip;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  draft: WaypointDraft | null;
  onDraftChange: (d: WaypointDraft | null) => void;
  onFlyTo: (lngLat: LngLat) => void;
  coordFormat: CoordFormat;
  onToggleCoordFormat: () => void;
}

export function WaypointsPanel({ trip, canEdit, selectedId, onSelect, draft, onDraftChange, onFlyTo, coordFormat, onToggleCoordFormat }: Props) {
  const selected = trip.waypoints.find((w) => w.id === selectedId) ?? null;

  if (draft) {
    return <WaypointForm draft={draft} onChange={onDraftChange} onCancel={() => onDraftChange(null)} trip={trip} />;
  }

  if (selected) {
    return (
      <WaypointDetail
        wp={selected}
        canEdit={canEdit}
        onBack={() => onSelect(null)}
        onEdit={() => onDraftChange({ id: selected.id, name: selected.name, description: selected.description, category: selected.category, lngLat: [selected.lng, selected.lat] })}
        onFlyTo={onFlyTo}
        coordFormat={coordFormat}
        onToggleCoordFormat={onToggleCoordFormat}
      />
    );
  }

  return (
    <div>
      {canEdit && (
        <button className="primary mb" onClick={() => onDraftChange({ name: "", description: "", category: "custom", lngLat: null })}>
          + Add waypoint
        </button>
      )}
      {trip.waypoints.length === 0 && <div className="empty">No waypoints yet. {canEdit && "Add car parks, campsites, water sources and other key spots."}</div>}
      <div className="list">
        {trip.waypoints.map((w) => {
          const s = categoryStyle(w.category);
          return (
            <div
              key={w.id}
              className="list-item clickable"
              onClick={() => {
                onSelect(w.id);
                onFlyTo([w.lng, w.lat]);
              }}
            >
              <div className="wp-icon" style={{ background: s.color }}>
                {s.glyph}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="truncate">{w.name}</div>
                <div className="tiny muted">
                  {s.label}
                  {w.photos.length > 0 && ` · ${w.photos.length} photo${w.photos.length === 1 ? "" : "s"}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaypointForm({ draft, onChange, onCancel, trip }: { draft: WaypointDraft; onChange: (d: WaypointDraft | null) => void; onCancel: () => void; trip: Trip }) {
  const upsert = useTrip((s) => s.upsertWaypoint);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const save = async () => {
    if (!draft.lngLat) {
      toast("Click on the map to place the waypoint", "warning");
      return;
    }
    const name = draft.name.trim() || categoryStyle(draft.category).label;
    setSaving(true);
    try {
      await upsert({ id: draft.id, name, description: draft.description, category: draft.category, lat: draft.lngLat[1], lng: draft.lngLat[0] });
      onChange(null);
    } catch {
      /* toast shown by store */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>{draft.id ? "Edit waypoint" : "New waypoint"}</h2>
      {!draft.lngLat ? (
        <div className="info-box mb">Click or tap on the map to place the waypoint.</div>
      ) : (
        <div className="info-box mb">
          Position: {draft.lngLat[1].toFixed(5)}, {draft.lngLat[0].toFixed(5)} — drag the marker or click the map to move it.
        </div>
      )}
      <div className="field">
        <label>Name</label>
        <input ref={nameRef} type="text" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="e.g. Car park" />
      </div>
      <div className="field">
        <label>Category</label>
        <div className="row wrap">
          {WAYPOINT_CATEGORIES.map((c) => {
            const s = categoryStyle(c);
            return (
              <button key={c} className={"small" + (draft.category === c ? " active" : "")} onClick={() => onChange({ ...draft, category: c })}>
                <span className="wp-icon" style={{ background: s.color, width: 20, height: 20, fontSize: 11, borderWidth: 1 }}>
                  {s.glyph}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>Description / notes</label>
        <textarea value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="Anything useful about this spot" />
      </div>
      <div className="row">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save waypoint"}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {trip.permission === "view" && <div className="warn-box mt">You only have view access to this trip.</div>}
    </div>
  );
}

function WaypointDetail({
  wp,
  canEdit,
  onBack,
  onEdit,
  onFlyTo,
  coordFormat,
  onToggleCoordFormat,
}: {
  wp: Waypoint;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onFlyTo: (l: LngLat) => void;
  coordFormat: CoordFormat;
  onToggleCoordFormat: () => void;
}) {
  const { deleteWaypoint, addPhoto, deletePhoto } = useTrip();
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const s = categoryStyle(wp.category);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const { photo, thumb } = await prepareImage(f);
        await addPhoto(wp.id, photo, thumb);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <button className="ghost small mb" onClick={onBack}>
        ← All waypoints
      </button>
      <div className="row mb">
        <div className="wp-icon" style={{ background: s.color, width: 40, height: 40, fontSize: 20 }}>
          {s.glyph}
        </div>
        <div className="grow">
          <h2 style={{ margin: 0 }}>{wp.name}</h2>
          <div className="tiny muted">{s.label}</div>
        </div>
      </div>
      <div className="row small mono mb" style={{ cursor: "pointer" }} onClick={onToggleCoordFormat} title="Toggle coordinate format">
        <span className="muted">📍</span> {formatCoords(wp.lat, wp.lng, coordFormat)}
      </div>
      {wp.description && <p style={{ whiteSpace: "pre-wrap", margin: "0 0 12px" }}>{wp.description}</p>}

      <div className="row wrap mb">
        <button className="small" onClick={() => onFlyTo([wp.lng, wp.lat])}>
          Show on map
        </button>
        {canEdit && (
          <>
            <button className="small" onClick={onEdit}>
              Edit
            </button>
            <button
              className="small danger"
              onClick={() => {
                if (confirm(`Delete waypoint "${wp.name}"?`)) void deleteWaypoint(wp.id).then(onBack);
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      <h3>Photos</h3>
      {canEdit && (
        <div className="row mb">
          <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" style={{ display: "none" }} onChange={(e) => void onFiles(e.target.files)} />
          <button className="small" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <>
                <span className="spinner" /> Uploading…
              </>
            ) : (
              "+ Add photo"
            )}
          </button>
          <span className="tiny muted">On Android this opens the camera or gallery.</span>
        </div>
      )}
      {wp.photos.length === 0 ? (
        <div className="tiny muted">No photos.</div>
      ) : (
        <div className="photo-grid">
          {wp.photos.map((p) => (
            <div className="photo-thumb" key={p.id} onClick={() => setLightbox(p)}>
              <PhotoImg photo={p} thumb alt={wp.name} />
              {canEdit && (
                <button
                  className="del"
                  title="Delete photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this photo?")) void deletePhoto(wp.id, p.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <PhotoImg photo={lightbox} thumb={false} alt={wp.name} />
        </div>
      )}
      <div className="tiny muted mt">Added {new Date(wp.createdAt).toLocaleString("en-GB")}</div>
    </div>
  );
}
