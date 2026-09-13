import { useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../../store/config";

export function LayerSwitcher() {
  const allLayers = useConfig((s) => s.config.mapLayers);
  const layers = useMemo(() => allLayers.filter((l) => l.kind === "base"), [allLayers]);
  const active = useConfig((s) => s.activeLayerId);
  const setActive = useConfig((s) => s.setActiveLayer);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = layers.find((l) => l.id === active);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="floating" onClick={() => setOpen((o) => !o)} title="Map layers" aria-haspopup="menu" aria-expanded={open}>
        <LayersIcon /> <span className="layer-label">{current?.name ?? "Layers"}</span>
      </button>
      {open && (
        <div className="floating layer-menu" role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)" }}>
          {layers.map((l) => (
            <button
              key={l.id}
              role="menuitemradio"
              aria-checked={l.id === active}
              className={l.id === active ? "active" : ""}
              onClick={() => {
                setActive(l.id);
                setOpen(false);
              }}
              title={l.description}
            >
              <span style={{ width: 14 }}>{l.id === active ? "●" : ""}</span>
              <span>
                {l.name}
                {l.description && <div className="tiny muted">{l.description}</div>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="m2 12 10 5 10-5" />
      <path d="m2 16 10 5 10-5" />
    </svg>
  );
}
