import type { RouteStats as Stats } from "@trails/shared";
import { formatDistance, formatDuration, formatElevation } from "../../lib/format";

export function RouteStats({ stats, compact }: { stats: Stats; compact?: boolean }) {
  const items = [
    { label: "Distance", value: formatDistance(stats.distance) },
    { label: "Est. time", value: formatDuration(stats.duration) },
    { label: "Ascent", value: `+${formatElevation(stats.elevationGain)}` },
    { label: "Descent", value: `−${formatElevation(stats.elevationLoss)}` },
    ...(compact
      ? []
      : [
          { label: "Min elevation", value: formatElevation(stats.minElevation) },
          { label: "Max elevation", value: formatElevation(stats.maxElevation) },
        ]),
  ];
  return (
    <div className="stat-grid">
      {items.map((i) => (
        <div className="stat" key={i.label}>
          <div className="label">{i.label}</div>
          <div className="value">{i.value}</div>
        </div>
      ))}
    </div>
  );
}
