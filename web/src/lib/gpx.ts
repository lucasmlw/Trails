import type { Trip } from "@trails/shared";
import { routeCoordinates } from "./geo";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => Number(n.toFixed(6)).toString();

/** Client-side GPX 1.1 export so trips can be exported while offline. */
export function tripToGpx(trip: Trip): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push('<gpx version="1.1" creator="Trails" xmlns="http://www.topografix.com/GPX/1/1">');
  out.push(
    `  <metadata><name>${esc(trip.name)}</name>${trip.description ? `<desc>${esc(trip.description)}</desc>` : ""}` +
      '<copyright author="OpenStreetMap contributors"><license>https://www.openstreetmap.org/copyright</license></copyright>' +
      `<time>${trip.updatedAt}</time></metadata>`,
  );
  for (const w of trip.waypoints) {
    out.push(`  <wpt lat="${num(w.lat)}" lon="${num(w.lng)}"><time>${w.createdAt}</time><name>${esc(w.name)}</name>${w.description ? `<desc>${esc(w.description)}</desc>` : ""}<type>${esc(w.category)}</type></wpt>`);
  }
  if (trip.route && trip.route.points.length) {
    out.push(`  <rte><name>${esc(trip.name)} (route points)</name><type>${esc(trip.route.routingMode)}</type>`);
    trip.route.points.forEach((p, i) => out.push(`    <rtept lat="${num(p.lat)}" lon="${num(p.lng)}"><name>${i === 0 ? "Start" : i === trip.route!.points.length - 1 ? "End" : `Point ${i + 1}`}</name></rtept>`));
    out.push("  </rte>");
    out.push(`  <trk><name>${esc(trip.name)}</name><type>${esc(trip.route.routingMode)}</type><trkseg>`);
    for (const c of routeCoordinates(trip.route)) {
      out.push(`    <trkpt lat="${num(c[1])}" lon="${num(c[0])}">${c[2] != null ? `<ele>${Number(c[2]).toFixed(1)}</ele>` : ""}</trkpt>`);
    }
    out.push("  </trkseg></trk>");
  }
  for (const t of trip.tracks) {
    if (!t.points.length) continue;
    out.push(`  <trk><name>${esc(t.name || "Recorded track")}</name><type>recorded</type><trkseg>`);
    for (const p of t.points) out.push(`    <trkpt lat="${num(p.lat)}" lon="${num(p.lng)}">${p.altitude != null ? `<ele>${p.altitude.toFixed(1)}</ele>` : ""}<time>${p.timestamp}</time></trkpt>`);
    out.push("  </trkseg></trk>");
  }
  out.push("</gpx>");
  return out.join("\n");
}

export function downloadGpx(trip: Trip) {
  const blob = new Blob([tripToGpx(trip)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${trip.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "trip"}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
