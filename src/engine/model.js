// Modelo en memoria del callejero a partir del GeoJSON publicado (public/data/callejero.geojson),
// con las correcciones locales del panel de administración aplicadas encima.

import { linesToLines, pointToLines, haversine, normName } from './geo.js';

export const VER_LABEL = {
  importado: 'Importado (sin verificar)',
  verificado: 'Verificado',
  corregido: 'Corregido',
  dudoso: 'Dudoso',
  excluido: 'Excluido',
  confirmado: 'Confirmado',
  erroneo: 'Erróneo',
};
export const TRUSTED = new Set(['verificado', 'corregido', 'confirmado']);
export const CLS_LABEL = {
  principal: 'Vía principal', secundaria: 'Vía secundaria', local: 'Calle', peatonal: 'Vía peatonal',
  servicio: 'Vía de servicio', camino: 'Camino', senda: 'Senda',
};
const CLS_RANK = { principal: 5, secundaria: 4, local: 3, peatonal: 2, servicio: 1, camino: 1, senda: 0.5 };

export function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

export function createModel(geojson, overrides = {}) {
  const meta = geojson.metadata || {};
  const streets = [], pois = [], pairsArr = [], zones = [];
  for (const f of geojson.features || []) {
    const p = f.properties || {};
    if (p.kind === 'street') streets.push({ ...p, lines: f.geometry.coordinates, ver: { ...p.ver } });
    else if (p.kind === 'poi') pois.push({ ...p, c: f.geometry.coordinates, ver: { ...p.ver } });
    else if (p.kind === 'pair') pairsArr.push({ ...p, c: f.geometry.coordinates, ver: { ...p.ver } });
    else if (p.kind === 'zone') zones.push({ ...p, geom: f.geometry });
  }
  const street = new Map(streets.map((s) => [s.id, s]));
  const poi = new Map(pois.map((p) => [p.id, p]));
  const zone = new Map(zones.map((z) => [z.id, z]));

  // Correcciones locales
  for (const [id, o] of Object.entries(overrides.streets || {})) {
    const s = street.get(id); if (!s) continue;
    if (o.name) { s.name = o.name; s.label = o.name; }
    s.ver = { ...s.ver, ...pick(o, ['status', 'source', 'date', 'notes']), local: true };
  }
  for (const [id, o] of Object.entries(overrides.pois || {})) {
    const p = poi.get(id); if (!p) continue;
    if (o.name) p.name = o.name;
    if (o.street && street.has(o.street)) { p.street = o.street; p.streetMethod = 'corrección'; }
    p.ver = { ...p.ver, ...pick(o, ['status', 'source', 'date', 'notes']), local: true };
  }
  const pair = new Map();
  for (const p of pairsArr) {
    const o = overrides.pairs?.[p.id];
    if (o) p.ver = { ...p.ver, ...pick(o, ['status', 'source', 'date', 'notes']), local: true };
    pair.set(p.id, p);
  }
  const inter = new Map(streets.map((s) => [s.id, new Set()]));
  for (const p of pair.values()) {
    if (p.ver.status === 'erroneo') continue;
    inter.get(p.a)?.add(p.b); inter.get(p.b)?.add(p.a);
  }
  const near = new Map(streets.map((s) => [s.id, new Map(s.near || [])]));
  const par = new Map(streets.map((s) => [s.id, new Set(s.par || [])]));
  for (const s of streets) {
    s.bbox = bbox(s.lines);
    s.importance = (CLS_RANK[s.cls] || 1) * Math.log10(10 + s.length);
    s.key = normName(s.name);
  }
  const poisOf = new Map();
  for (const p of pois) if (p.street) { if (!poisOf.has(p.street)) poisOf.set(p.street, []); poisOf.get(p.street).push(p); }

  const distCache = new Map();
  function minDist(a, b) {
    if (a === b) return 0;
    if (inter.get(a)?.has(b)) return 0;
    const n = near.get(a)?.get(b); if (n !== undefined) return n;
    const k = pairKey(a, b);
    if (distCache.has(k)) return distCache.get(k);
    const A = street.get(a), B = street.get(b);
    const d = Math.round(linesToLines(A.lines, B.lines));
    distCache.set(k, d); return d;
  }
  /** Cota inferior barata de la distancia entre vías (distancia entre rectángulos). */
  function bboxDist(a, b) {
    const A = street.get(a).bbox, B = street.get(b).bbox;
    const dx = Math.max(0, A[0] - B[2], B[0] - A[2]), dy = Math.max(0, A[1] - B[3], B[1] - A[3]);
    const lat = (A[1] + A[3]) / 2;
    return Math.hypot(dx * 111320 * Math.cos(lat * Math.PI / 180), dy * 111320);
  }
  const poiDistCache = new Map();
  function poiDist(poiId, streetId) {
    const k = poiId + '>' + streetId;
    if (!poiDistCache.has(k)) poiDistCache.set(k, Math.round(pointToLines(poi.get(poiId).c, street.get(streetId).lines)));
    return poiDistCache.get(k);
  }

  return {
    meta, streets, pois, zones, street, poi, zone, pair, inter, near, par, poisOf,
    minDist, bboxDist, poiDist,
    pairOf: (a, b) => pair.get(pairKey(a, b)),
    intersects: (a, b) => !!inter.get(a)?.has(b),
    dist: (p, q) => haversine(p, q),
    isEmpty: () => streets.length === 0,
  };
}

function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function bbox(lines) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const [x, y] of l) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

/** Filtro de vías utilizables en preguntas según la configuración del usuario. */
export function eligibleStreets(model, { includeRural = false, onlyVerified = false, zoneId = null } = {}) {
  const z = zoneId ? new Set(model.zone.get(zoneId)?.streets || []) : null;
  return model.streets.filter((s) => {
    if (['excluido', 'dudoso'].includes(s.ver.status)) return false;
    if (onlyVerified && !TRUSTED.has(s.ver.status)) return false;
    if (!includeRural && s.rural) return false;
    if (z && !z.has(s.id)) return false;
    return true;
  });
}
