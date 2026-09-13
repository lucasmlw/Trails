const R = 6371008.8;

/** Great-circle distance in metres between two lng/lat points. */
export function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function lineLength(coords: number[][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  return d;
}
