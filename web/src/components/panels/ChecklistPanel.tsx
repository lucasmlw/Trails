import { useState } from "react";
import type { Trip } from "@trails/shared";
import { useTrip } from "../../store/trip";

const TEMPLATE = ["Tent", "Sleeping bag", "Sleeping mat", "Stove", "Food", "Water", "First aid kit", "Head torch", "Power bank", "Waterproof jacket", "Map & compass"];

export function ChecklistPanel({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const { addChecklistItem, updateChecklistItem, deleteChecklistItem, reorderChecklist } = useTrip();
  const [text, setText] = useState("");
  const items = [...trip.checklist].sort((a, b) => a.sortOrder - b.sortOrder);
  const done = items.filter((i) => i.completed).length;

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await addChecklistItem(t);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderChecklist(ids);
  };

  return (
    <div>
      <div className="row mb">
        <h2 className="grow" style={{ margin: 0 }}>
          Checklist
        </h2>
        <span className="badge green">
          {done}/{items.length} packed
        </span>
      </div>
      {items.length > 0 && (
        <div className="progress mb">
          <div style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
      )}
      {canEdit && (
        <div className="row mb">
          <input type="text" value={text} placeholder="Add an item…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <button className="primary" onClick={() => void add()} disabled={!text.trim()}>
            Add
          </button>
        </div>
      )}
      {items.length === 0 && canEdit && (
        <div className="info-box mb row wrap">
          <span className="grow">Start from a camping template?</span>
          <button
            className="small"
            onClick={async () => {
              for (const t of TEMPLATE) await addChecklistItem(t);
            }}
          >
            Add {TEMPLATE.length} items
          </button>
        </div>
      )}
      <div className="list">
        {items.map((item, idx) => (
          <div key={item.id} className={"checklist-item" + (item.completed ? " done" : "")}>
            <input type="checkbox" checked={item.completed} disabled={!canEdit} onChange={(e) => void updateChecklistItem(item.id, { completed: e.target.checked })} />
            <input
              className="text"
              type="text"
              defaultValue={item.text}
              key={item.text}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== item.text) void updateChecklistItem(item.id, { text: v });
                else e.target.value = item.text;
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {canEdit && (
              <>
                <div className="reorder">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                    ▲
                  </button>
                  <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} title="Move down">
                    ▼
                  </button>
                </div>
                <button className="ghost small" onClick={() => void deleteChecklistItem(item.id)} title="Delete">
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {items.length > 0 && canEdit && (
        <div className="row mt">
          <button
            className="small"
            onClick={async () => {
              for (const i of items.filter((x) => x.completed)) await updateChecklistItem(i.id, { completed: false });
            }}
            disabled={done === 0}
          >
            Uncheck all
          </button>
        </div>
      )}
    </div>
  );
}
