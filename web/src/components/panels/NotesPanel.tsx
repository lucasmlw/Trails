import { useEffect, useRef, useState } from "react";
import type { Trip } from "@trails/shared";
import { useTrip } from "../../store/trip";

export function NotesPanel({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const patch = useTrip((s) => s.patch);
  const [name, setName] = useState(trip.name);
  const [description, setDescription] = useState(trip.description);
  const [notes, setNotes] = useState(trip.notes);
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setName(trip.name);
    setDescription(trip.description);
    setNotes(trip.notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const save = async (fields: Partial<Pick<Trip, "name" | "description" | "notes">>) => {
    setState("saving");
    try {
      await patch(fields);
      setState("saved");
      window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setState("dirty");
    }
  };

  const scheduleNotesSave = (value: string) => {
    setNotes(value);
    setState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save({ notes: value }), 900);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div>
      <div className="field">
        <label>Trip name</label>
        <input type="text" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== trip.name && void save({ name: name.trim() })} />
      </div>
      <div className="field">
        <label>Short description</label>
        <input
          type="text"
          value={description}
          disabled={!canEdit}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== trip.description && void save({ description })}
          placeholder="e.g. Two-day loop from Keswick"
        />
      </div>
      <div className="field">
        <label className="row">
          <span className="grow">Notes</span>
          <span className="tiny">
            {state === "saving" && "Saving…"}
            {state === "saved" && "Saved"}
            {state === "dirty" && "Unsaved changes"}
          </span>
        </label>
        <textarea
          value={notes}
          disabled={!canEdit}
          onChange={(e) => scheduleNotesSave(e.target.value)}
          onBlur={() => {
            if (state === "dirty") {
              window.clearTimeout(timer.current);
              void save({ notes });
            }
          }}
          rows={14}
          placeholder={"Weather forecast looks good.\nStart early Saturday.\nParking gets busy after 9am."}
        />
        <div className="tiny muted mt">Plain text. Notes are saved automatically and included in the offline download.</div>
      </div>
      <div className="tiny muted">
        Created by {trip.ownerName} on {new Date(trip.createdAt).toLocaleDateString("en-GB")} · Updated {new Date(trip.updatedAt).toLocaleString("en-GB")}
      </div>
    </div>
  );
}
