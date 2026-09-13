import type { Trip } from "@trails/shared";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (n: number) => Number(n.toFixed(6)).toString();

/**
 * Builds a GPX 1.1 document containing the trip's waypoints, the planned route
 * (as both <rte> for routing points and <trk> for the full geometry) and any
 * recorded GPS tracks.
 */
export function tripToGpx(trip: Trip): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="Trails" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );
  lines.push("  <metadata>");
  lines.push(`    <name>${esc(trip.name)}</name>`);
  if (trip.description) lines.push(`    <desc>${esc(trip.description)}</desc>`);
  lines.push(`    <time>${trip.updatedAt}</time>`);
  lines.push("  </metadata>");

  for (const w of trip.waypoints) {
    lines.push(`  <wpt lat="${num(w.lat)}" lon="${num(w.lng)}">`);
    lines.push(`    <time>${w.createdAt}</time>`);
    lines.push(`    <name>${esc(w.name)}</name>`);
    if (w.description) lines.push(`    <desc>${esc(w.description)}</desc>`);
    lines.push(`    <type>${esc(w.category)}</type>`);
    lines.push("  </wpt>");
  }

  const route = trip.route;
  if (route && route.points.length > 0) {
    lines.push("  <rte>");
    lines.push(`    <name>${esc(trip.name)} (route points)</name>`);
    lines.push(`    <type>${esc(route.routingMode)}</type>`);
    route.points.forEach((p, i) => {
      lines.push(`    <rtept lat="${num(p.lat)}" lon="${num(p.lng)}"><name>${i === 0 ? "Start" : i === route.points.length - 1 ? "End" : `Point ${i + 1}`}</name></rtept>`);
    });
    lines.push("  </rte>");

    lines.push("  <trk>");
    lines.push(`    <name>${esc(trip.name)}</name>`);
    lines.push(`    <type>${esc(route.routingMode)}</type>`);
    lines.push("    <trkseg>");
    route.segments.forEach((seg, si) => {
      seg.coordinates.forEach((c, ci) => {
        if (si > 0 && ci === 0) return; // shared vertex with previous segment
        const ele = c.length > 2 && c[2] != null ? `<ele>${Number(c[2]).toFixed(1)}</ele>` : "";
        lines.push(`      <trkpt lat="${num(c[1])}" lon="${num(c[0])}">${ele}</trkpt>`);
      });
    });
    lines.push("    </trkseg>");
    lines.push("  </trk>");
  }

  for (const t of trip.tracks) {
    if (t.points.length === 0) continue;
    lines.push("  <trk>");
    lines.push(`    <name>${esc(t.name || "Recorded track")}</name>`);
    lines.push("    <type>recorded</type>");
    lines.push("    <trkseg>");
    for (const p of t.points) {
      const ele = p.altitude != null ? `<ele>${p.altitude.toFixed(1)}</ele>` : "";
      lines.push(`      <trkpt lat="${num(p.lat)}" lon="${num(p.lng)}">${ele}<time>${p.timestamp}</time></trkpt>`);
    }
    lines.push("    </trkseg>");
    lines.push("  </trk>");
  }

  lines.push("</gpx>");
  return lines.join("\n");
}
