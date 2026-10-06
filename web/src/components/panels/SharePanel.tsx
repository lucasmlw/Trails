import { useEffect, useState } from "react";
import type { Trip, User } from "@trails/shared";
import { api } from "../../api/client";
import { useAuth } from "../../store/auth";
import { useTrip } from "../../store/trip";

export function SharePanel({ trip }: { trip: Trip }) {
  const me = useAuth((s) => s.user);
  const { share, unshare } = useTrip();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isOwner = trip.permission === "owner";

  useEffect(() => {
    api<{ users: User[] }>("/api/auth/users")
      .then((r) => setUsers(r.users.filter((u) => u.id !== me?.id && u.id !== trip.ownerId)))
      .catch((e) => setError((e as Error).message));
  }, [me?.id, trip.ownerId]);

  return (
    <div>
      <h2>Sharing</h2>
      <div className="info-box mb">
        Owner: <strong>{trip.ownerName}</strong>. Trips are private by default; only people listed below can open this trip.
      </div>
      {error && <div className="error-box mb">{error}</div>}

      <h3>Shared with</h3>
      {trip.shares.length === 0 && <div className="tiny muted mb">Not shared with anyone.</div>}
      <div className="list mb">
        {trip.shares.map((s) => (
          <div key={s.userId} className="list-item">
            <div className="grow">
              <div>{s.displayName}</div>
              <div className="tiny muted">@{s.username}</div>
            </div>
            {isOwner ? (
              <>
                <select value={s.permission} onChange={(e) => void share(s.userId, e.target.value as "view" | "edit")} style={{ width: "auto" }}>
                  <option value="edit">Can edit</option>
                  <option value="view">View only</option>
                </select>
                <button className="small danger" onClick={() => void unshare(s.userId)}>
                  Remove
                </button>
              </>
            ) : (
              <span className="badge">{s.permission === "edit" ? "Can edit" : "View only"}</span>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <>
          <h3>Share with</h3>
          {users.filter((u) => !trip.shares.some((s) => s.userId === u.id)).length === 0 ? (
            <div className="tiny muted">Everyone is already on this trip.</div>
          ) : (
            <div className="list">
              {users
                .filter((u) => !trip.shares.some((s) => s.userId === u.id))
                .map((u) => (
                  <div key={u.id} className="list-item">
                    <div className="grow">
                      <div>{u.displayName}</div>
                      <div className="tiny muted">@{u.username}</div>
                    </div>
                    <button className="small primary" onClick={() => void share(u.id, "edit")}>
                      Share (can edit)
                    </button>
                    <button className="small" onClick={() => void share(u.id, "view")}>
                      View only
                    </button>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
