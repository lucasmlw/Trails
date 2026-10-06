import { useMemo, useState } from "react";
import type { LngLat, Position } from "@trails/shared";
import { haversine } from "../../lib/geo";
import { formatDistance } from "../../lib/format";

interface Props {
  coordinates: Position[];
  onHover?: (p: LngLat | null) => void;
}

export function ElevationProfile({ coordinates, onHover }: Props) {
  const data = useMemo(() => {
    const pts: { d: number; e: number; c: Position }[] = [];
    let d = 0;
    for (let i = 0; i < coordinates.length; i++) {
      if (i > 0) d += haversine(coordinates[i - 1], coordinates[i]);
      const e = coordinates[i][2];
      if (e != null && !Number.isNaN(e)) pts.push({ d, e, c: coordinates[i] });
    }
    return { pts, total: d };
  }, [coordinates]);

  const [hoverX, setHoverX] = useState<number | null>(null);

  if (data.pts.length < 2) return <div className="info-box">No elevation data available for this route.</div>;

  const W = 400, H = 130, padL = 34, padB = 18, padT = 8, padR = 8;
  const minE = Math.min(...data.pts.map((p) => p.e));
  const maxE = Math.max(...data.pts.map((p) => p.e));
  const span = Math.max(20, maxE - minE);
  const x = (d: number) => padL + (d / data.total) * (W - padL - padR);
  const y = (e: number) => padT + (1 - (e - minE) / span) * (H - padT - padB);
  const path = data.pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.total).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  const hovered = hoverX == null ? null : data.pts.reduce((best, p) => (Math.abs(x(p.d) - hoverX) < Math.abs(x(best.d) - hoverX) ? p : best), data.pts[0]);

  const ticks = [minE, minE + span / 2, minE + span].map((v) => Math.round(v));

  return (
    <svg
      className="elev-profile"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        setHoverX(px);
        const p = data.pts.reduce((best, q) => (Math.abs(x(q.d) - px) < Math.abs(x(best.d) - px) ? q : best), data.pts[0]);
        onHover?.([p.c[0], p.c[1]]);
      }}
      onMouseLeave={() => {
        setHoverX(null);
        onHover?.(null);
      }}
    >
      <defs>
        <linearGradient id="elevFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6cbf8a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#6cbf8a" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#2a4536" strokeWidth="1" />
          <text x={padL - 4} y={y(t) + 3} fontSize="9" fill="#9fb3a7" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#elevFill)" />
      <path d={path} fill="none" stroke="#6cbf8a" strokeWidth="1.5" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={x(data.total * f)} y={H - 5} fontSize="9" fill="#9fb3a7" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>
          {formatDistance(data.total * f)}
        </text>
      ))}
      {hovered && (
        <g>
          <line x1={x(hovered.d)} x2={x(hovered.d)} y1={padT} y2={H - padB} stroke="#f3e9c6" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={x(hovered.d)} cy={y(hovered.e)} r="3.5" fill="#f3e9c6" />
          <rect x={Math.min(x(hovered.d) + 6, W - 96)} y={padT} width="90" height="28" rx="4" fill="#14211b" stroke="#2a4536" />
          <text x={Math.min(x(hovered.d) + 12, W - 90)} y={padT + 12} fontSize="10" fill="#eef4ef">
            {Math.round(hovered.e)} m
          </text>
          <text x={Math.min(x(hovered.d) + 12, W - 90)} y={padT + 23} fontSize="9" fill="#9fb3a7">
            {formatDistance(hovered.d)}
          </text>
        </g>
      )}
    </svg>
  );
}
