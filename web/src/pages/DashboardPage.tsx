import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { TripSummary } from "@trails/shared";
import { api, OfflineError } from "../api/client";
import { fetchTrips, offlineTripSummaries } from "../offline/tripRepo";
import { listDownloads, type DownloadMeta } from "../offline/db";
import { useAuth } from "../store/auth";
import { useNetwork } from "../store/network";
import { TopBar } from "../components/TopBar";
import { formatDistance, relativeTime } from "../lib/format";
import { toast } from "../store/toast";

export function DashboardPage() {
  const me = useAuth((s) => s.user);
  const online = useNetwork((s) => s.online);
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [offlineTrips, setOfflineTrips] = useState<TripSummary[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    const dl = await listDownloads();
    setDownloads(Object.fromEntries(dl.map((d) => [d.tripId, d])));
    setOfflineTrips(await offlineTripSummaries());
    try {
      setTrips(await fetchTrips());
      setError(null);
    } catch (err) {
      if (err instanceof OfflineError) {
        setTrips(null);
        setError("You are offline. Downloaded trips remain available.");
      } else setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, online]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const { trip } = await api<{ trip: { id: string } }>("/api/trips", { method: "POST", json: { name } });
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const all = trips ?? offlineTrips;
  const mine = all.filter((t) => t.ownerId === me?.id);
  const shared = all.filter((t) => t.ownerId !== me?.id);
  const offlineIds = new Set(Object.keys(downloads).filter((id) => downloads[id].status === "complete"));

  return (
    <div className="app">
      <TopBar>
        <button className="primary small" onClick={() => setCreating(true)} disabled={!online}>
          + New trip
        </button>
      </TopBar>
      <div className="page">
        <div className="container">
          {error && <div className="warn-box mb">{error}</div>}

          {creating && (
            <div className="modal-backdrop" onClick={() => setCreating(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>New trip</h2>
                <div className="field">
                  <label>Trip name</label>
                  <input type="text" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Lake District Weekend" onKeyDown={(e) => e.key === "Enter" && void create()} />
                </div>
                <div className="row">
                  <button className="primary" onClick={() => void create()} disabled={!newName.trim()}>
                    Create & plan route
                  </button>
                  <button onClick={() => setCreating(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <Section title="My trips" count={mine.length}>
            {mine.length === 0 && trips && (
              <div className="empty">
                No trips yet.{" "}
                <button className="small primary" onClick={() => setCreating(true)} style={{ marginLeft: 8 }}>
                  Create your first trip
                </button>
              </div>
            )}
            <TripGrid trips={mine} offlineIds={offlineIds} />
          </Section>

          <Section title="Shared with me" count={shared.length}>
            {shared.length === 0 && <div className="empty">Nothing shared with you yet.</div>}
            <TripGrid trips={shared} offlineIds={offlineIds} />
          </Section>

          <Section title="Available offline" count={offlineTrips.filter((t) => offlineIds.has(t.id)).length}>
            {offlineTrips.filter((t) => offlineIds.has(t.id)).length === 0 ? (
              <div className="empty">Open a trip and use the Offline tab to store it on this device.</div>
            ) : (
              <TripGrid trips={offlineTrips.filter((t) => offlineIds.has(t.id))} offlineIds={offlineIds} navigate />
            )}
          </Section>

          {trips === null && offlineTrips.length === 0 && !error && (
            <div className="center muted mt">
              <span className="spinner" /> Loading…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="section-title">
        <h2>{title}</h2>
        <span className="badge">{count}</span>
      </div>
      {children}
    </section>
  );
}

function TripGrid({ trips, offlineIds, navigate }: { trips: TripSummary[]; offlineIds: Set<string>; navigate?: boolean }) {
  if (!trips.length) return null;
  return (
    <div className="trip-grid">
      {trips.map((t) => (
        <Link to={`/trips/${t.id}`} className="trip-card" key={t.id}>
          <div className="row">
            <h3 className="grow truncate">{t.name}</h3>
            {offlineIds.has(t.id) && <span className="badge green">offline</span>}
            {t.permission !== "owner" && <span className="badge blue">{t.permission === "edit" ? "can edit" : "view"}</span>}
            {t.permission === "owner" && t.shared && <span className="badge">shared</span>}
          </div>
          {t.description && <div className="small muted truncate">{t.description}</div>}
          <div className="meta">
            <span>{t.distance != null ? formatDistance(t.distance) : "No route"}</span>
            <span>
              {t.waypointCount} waypoint{t.waypointCount === 1 ? "" : "s"}
            </span>
            <span className="right">Updated {relativeTime(t.updatedAt)}</span>
          </div>
          {t.ownerId && t.permission !== "owner" && <div className="tiny muted">by {t.ownerName}</div>}
          {navigate && (
            <div className="row mt">
              <Link to={`/trips/${t.id}/navigate`} className="badge blue" onClick={(e) => e.stopPropagation()}>
                ▸ Navigate
              </Link>
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
