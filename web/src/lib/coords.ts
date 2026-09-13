import type { LngLat } from "@trails/shared";

/**
 * Parses free-text coordinates typed into the search box. Supports:
 *  - decimal degrees:   54.4609, -3.0886   |  54.4609 -3.0886
 *  - degrees/minutes/seconds:  54°27'39"N 3°05'19"W
 *  - Ordnance Survey grid references:  NY 2150 0750  |  NY215075
 */
export function parseCoordinates(text: string): LngLat | null {
  const t = text.trim();
  if (!t) return null;

  const dec = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (dec) {
    const lat = Number(dec[1]), lng = Number(dec[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lng, lat];
  }

  const dmsRe = /(\d{1,3})[°\s]\s*(\d{1,2})?['′\s]?\s*(\d{1,2}(?:\.\d+)?)?["″\s]?\s*([NSEW])/gi;
  const parts = [...t.matchAll(dmsRe)];
  if (parts.length === 2) {
    const conv = (m: RegExpMatchArray) => {
      const v = Number(m[1]) + (Number(m[2] ?? 0) || 0) / 60 + (Number(m[3] ?? 0) || 0) / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    };
    const a = conv(parts[0]), b = conv(parts[1]);
    const aIsLat = /[NS]/i.test(parts[0][4]);
    const lat = aIsLat ? a : b, lng = aIsLat ? b : a;
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lng, lat];
  }

  const grid = t.toUpperCase().replace(/\s+/g, "").match(/^([HJNOST][A-HJ-Z])(\d{4,10})$/);
  if (grid && grid[2].length % 2 === 0) return osGridToLngLat(grid[1], grid[2]);

  return null;
}

// ---- OSGB36 National Grid -> WGS84 ------------------------------------------

function gridLetterToEN(letters: string, digits: string): { e: number; n: number } {
  const l1 = letters.charCodeAt(0) - 65, l2 = letters.charCodeAt(1) - 65;
  const a = l1 > 7 ? l1 - 1 : l1;
  const b = l2 > 7 ? l2 - 1 : l2;
  const e100 = ((a - 2) % 5) * 5 + (b % 5);
  const n100 = 19 - Math.floor(a / 5) * 5 - Math.floor(b / 5);
  const half = digits.length / 2;
  const scale = Math.pow(10, 5 - half);
  const e = e100 * 100_000 + Number(digits.slice(0, half)) * scale;
  const n = n100 * 100_000 + Number(digits.slice(half)) * scale;
  return { e, n };
}

function osGridToLngLat(letters: string, digits: string): LngLat | null {
  const { e: E, n: N } = gridLetterToEN(letters, digits);
  // Airy 1830 ellipsoid, Transverse Mercator inverse
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat), tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan4 * tan2;
  const secLat = 1 / cosLat;
  const nu3 = nu ** 3, nu5 = nu ** 5, nu7 = nu ** 7;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2, dE6 = dE4 * dE2, dE7 = dE5 * dE2;
  const latOSGB = lat - VII * dE2 + VIII * dE4 - IX * dE6;
  const lonOSGB = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;
  return osgb36ToWgs84(latOSGB, lonOSGB);
}

function osgb36ToWgs84(lat: number, lon: number): LngLat {
  // Helmert transformation (OSGB36 -> WGS84), ~5 m accuracy which is fine for a search jump.
  const a1 = 6377563.396, b1 = 6356256.909;
  const e21 = 1 - (b1 * b1) / (a1 * a1);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const nu = a1 / Math.sqrt(1 - e21 * sinLat * sinLat);
  let x = nu * cosLat * cosLon, y = nu * cosLat * sinLon, z = (1 - e21) * nu * sinLat;
  const tx = 446.448, ty = -125.157, tz = 542.06;
  const rx = (0.1502 / 3600) * (Math.PI / 180), ry = (0.247 / 3600) * (Math.PI / 180), rz = (0.8421 / 3600) * (Math.PI / 180);
  const s = 1 + -20.4894 / 1e6;
  const x2 = tx + x * s - y * rz + z * ry;
  const y2 = ty + x * rz + y * s - z * rx;
  const z2 = tz - x * ry + y * rx + z * s;
  x = x2; y = y2; z = z2;
  const a2 = 6378137, b2 = 6356752.3142;
  const e22 = 1 - (b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x * x + y * y);
  let phi = Math.atan2(z, p * (1 - e22)), phiP = 2 * Math.PI;
  let iterations = 0;
  while (Math.abs(phi - phiP) > 1e-12 && iterations++ < 20) {
    const nu2 = a2 / Math.sqrt(1 - e22 * Math.sin(phi) ** 2);
    phiP = phi;
    phi = Math.atan2(z + e22 * nu2 * Math.sin(phi), p);
  }
  const lambda = Math.atan2(y, x);
  return [(lambda * 180) / Math.PI, (phi * 180) / Math.PI];
}
