// Operaciones geográficas básicas, sin dependencias.
// Convención: coordenadas [lon, lat] (orden GeoJSON). Distancias en metros.
// A escala municipal (< 30 km) se usa una proyección equirectangular local,
// con error inferior al 0,1 %, suficiente para distancias, ángulos y cruces.

const R = 6371008.8;
const D2R = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * D2R;
  const dLon = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Proyector local: convierte [lon,lat] a [x,y] en metros respecto a un origen. */
export function makeProjector(origin) {
  const kx = R * D2R * Math.cos(origin[1] * D2R);
  const ky = R * D2R;
  return {
    fwd: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    inv: (q) => [q[0] / kx + origin[0], q[1] / ky + origin[1]],
  };
}

/** Rumbo inicial de a a b en grados (0 = norte, 90 = este). */
export function bearing(a, b) {
  const f1 = a[1] * D2R, f2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/** Diferencia entre dos ejes no orientados (0–90°). */
export function axisDiff(a, b) {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

export function lineLength(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i]);
  return s;
}

export function multiLength(lines) {
  return lines.reduce((s, l) => s + lineLength(l), 0);
}

/** Distancia de un punto a un segmento, en coordenadas proyectadas. */
function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Distancia mínima (m) de un punto a un conjunto de líneas. */
export function pointToLines(pt, lines) {
  const P = makeProjector(pt);
  const p = [0, 0];
  let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) { best = Math.min(best, haversine(pt, line[0]) ** 2); continue; }
    let prev = P.fwd(line[0]);
    for (let i = 1; i < line.length; i++) {
      const cur = P.fwd(line[i]);
      const d = segDist2(p, prev, cur);
      if (d < best) best = d;
      prev = cur;
    }
  }
  return Math.sqrt(best);
}

/** Distancia mínima (m) entre dos conjuntos de líneas (vértice–segmento en ambos sentidos). */
export function linesToLines(A, B) {
  let best = Infinity;
  for (const l of A) for (const v of l) best = Math.min(best, pointToLines(v, B));
  for (const l of B) for (const v of l) best = Math.min(best, pointToLines(v, A));
  // Comprobación de cruce real de segmentos (distancia 0 aunque ningún vértice coincida)
  if (best > 0 && segmentsCross(A, B)) return 0;
  return best;
}

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

export function segmentsCross(A, B) {
  for (const la of A) for (let i = 1; i < la.length; i++) {
    const p1 = la[i - 1], p2 = la[i];
    for (const lb of B) for (let j = 1; j < lb.length; j++) {
      const q1 = lb[j - 1], q2 = lb[j];
      const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

export function bboxOf(lines) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const [x, y] of l) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Punto situado a mitad del recorrido de la línea más larga (siempre sobre la vía). */
export function midpoint(lines) {
  let longest = lines[0], L = -1;
  for (const l of lines) { const x = lineLength(l); if (x > L) { L = x; longest = l; } }
  if (longest.length === 1) return longest[0];
  let half = L / 2;
  for (let i = 1; i < longest.length; i++) {
    const d = haversine(longest[i - 1], longest[i]);
    if (half <= d) {
      const t = d ? half / d : 0;
      return [longest[i - 1][0] + t * (longest[i][0] - longest[i - 1][0]), longest[i - 1][1] + t * (longest[i][1] - longest[i - 1][1])];
    }
    half -= d;
  }
  return longest[longest.length - 1];
}

/** Centro de masas de los vértices ponderado por longitud de segmento. */
export function lineCentroid(lines) {
  let sx = 0, sy = 0, sw = 0;
  for (const l of lines) {
    if (l.length === 1) { sx += l[0][0]; sy += l[0][1]; sw += 1e-9; continue; }
    for (let i = 1; i < l.length; i++) {
      const w = haversine(l[i - 1], l[i]) || 1e-9;
      sx += w * (l[i - 1][0] + l[i][0]) / 2; sy += w * (l[i - 1][1] + l[i][1]) / 2; sw += w;
    }
  }
  return [sx / sw, sy / sw];
}

/**
 * Eje principal (0–180°) por análisis de componentes principales ponderado
 * y "rectitud" (0–1): 1 = recta, valores bajos = curva o en forma de L.
 */
export function principalAxis(lines) {
  const c = lineCentroid(lines);
  const P = makeProjector(c);
  let sxx = 0, syy = 0, sxy = 0, sw = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = P.fwd(l[i - 1]), b = P.fwd(l[i]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const w = Math.hypot(dx, dy);
    if (!w) continue;
    // Se ponderan las direcciones de los segmentos (no las posiciones),
    // así el eje describe la orientación del trazado.
    sxx += dx * dx / w; syy += dy * dy / w; sxy += dx * dy / w; sw += w;
  }
  if (!sw) return { axis: 0, straightness: 0 };
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l2 = tr - l1;
  const ang = Math.atan2(l1 - sxx, sxy || 1e-12); // ángulo respecto al eje x
  let ax = 90 - ang / D2R; // a rumbo (0 = norte)
  if (sxy === 0) ax = sxx >= syy ? 90 : 0;
  ax = ((ax % 180) + 180) % 180;
  const straightness = l1 > 0 ? (l1 - l2) / (l1 + l2) : 0;
  return { axis: ax, straightness };
}

/** Rectángulo de ocupación proyectado sobre un eje: [min,max] en metros. */
export function projectOnAxis(lines, origin, axisDeg) {
  const P = makeProjector(origin);
  const ux = Math.sin(axisDeg * D2R), uy = Math.cos(axisDeg * D2R);
  let mn = Infinity, mx = -Infinity;
  for (const l of lines) for (const v of l) {
    const q = P.fwd(v); const t = q[0] * ux + q[1] * uy;
    if (t < mn) mn = t; if (t > mx) mx = t;
  }
  return [mn, mx];
}

export function polygonCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-14) {
    const n = ring.length; return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const CARDINALS = [
  { key: 'N', name: 'Norte', deg: 0 }, { key: 'E', name: 'Este', deg: 90 },
  { key: 'S', name: 'Sur', deg: 180 }, { key: 'O', name: 'Oeste', deg: 270 },
];

/** Punto cardinal si el rumbo está a ≤ tol grados de él; si no, null (dirección ambigua). */
export function cardinalOf(deg, tol = 30) {
  for (const c of CARDINALS) {
    let d = Math.abs(deg - c.deg) % 360; if (d > 180) d = 360 - d;
    if (d <= tol) return c;
  }
  return null;
}

/** Índice espacial de rejilla para consultas de proximidad. */
export class GridIndex {
  constructor(origin, cell = 100) {
    this.P = makeProjector(origin); this.cell = cell; this.map = new Map();
  }
  _k(ix, iy) { return ix + ':' + iy; }
  insert(pt, value) {
    const q = this.P.fwd(pt);
    const k = this._k(Math.floor(q[0] / this.cell), Math.floor(q[1] / this.cell));
    let arr = this.map.get(k); if (!arr) this.map.set(k, arr = []);
    arr.push({ q, pt, value });
  }
  /** Devuelve [{value, d}] dentro de radio r (m). */
  query(pt, r) {
    const q = this.P.fwd(pt), out = [];
    const x0 = Math.floor((q[0] - r) / this.cell), x1 = Math.floor((q[0] + r) / this.cell);
    const y0 = Math.floor((q[1] - r) / this.cell), y1 = Math.floor((q[1] + r) / this.cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const arr = this.map.get(this._k(x, y)); if (!arr) continue;
      for (const it of arr) { const d = Math.hypot(it.q[0] - q[0], it.q[1] - q[1]); if (d <= r) out.push({ value: it.value, d }); }
    }
    return out;
  }
}

/** Densifica una línea para que no haya tramos mayores que step metros. */
export function densify(line, step = 20) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = haversine(a, b);
    const n = Math.ceil(d / step);
    for (let k = 1; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    out.push(b);
  }
  return out;
}

export function round6(p) { return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]; }

/** Normaliza un nombre para comparar (minúsculas, sin tildes ni espacios dobles). */
export function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}
