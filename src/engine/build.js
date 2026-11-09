// Transforma un volcado de OpenStreetMap (JSON de Overpass) en el conjunto de
// datos del callejero (GeoJSON con relaciones precalculadas).
// Se ejecuta en Node (scripts/build-dataset.mjs) y en las pruebas; no se carga en el navegador.
//
// Principio: no se inventa ningún dato. Todo nombre, cruce o edificio procede de OSM
// (o del archivo de verificaciones mantenido por el usuario) y las zonas derivadas
// se identifican como tales, indicando el método usado para obtenerlas.

import {
  haversine, bearing, axisDiff, lineLength, multiLength, pointToLines, linesToLines,
  bboxOf, midpoint, lineCentroid, principalAxis, projectOnAxis, polygonCentroid,
  pointInRing, GridIndex, densify, round6, normName,
} from './geo.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG = {
  townName: 'Cieza',
  centerRadius: 500,          // m desde el nodo place=town para el área «Centro urbano»
  peripheryDistance: 1500,    // m a partir de los cuales una vía urbana se considera periférica
  peripheryMax: 4000,         // m máximos para «periferia» (más allá: rural)
  neighbourhoodRadius: 600,   // m de asignación a un barrio (nodo place=neighbourhood/suburb/quarter)
  villageRadius: 1500,        // m de asignación a una pedanía (nodo place=village/hamlet)
  publicPoiBuffer: 120,       // m para «Entorno de edificios públicos»
  nearDist: 200,              // m: relaciones de proximidad que se guardan
  neighborDist: 80,           // m: «calle próxima»
  sameNameJoin: 150,          // m: tramos con el mismo nombre a menos de esta distancia = misma vía
  parallelMaxAngle: 12,       // grados
  perpendicularMinAngle: 75,  // grados
};

const HIGHWAY_CLASS = {
  motorway: 'principal', trunk: 'principal', primary: 'principal', secondary: 'principal',
  tertiary: 'secundaria', unclassified: 'local', residential: 'local', living_street: 'local', road: 'local',
  pedestrian: 'peatonal', footway: 'peatonal', steps: 'peatonal', service: 'servicio',
  track: 'camino', path: 'senda', cycleway: 'senda', bridleway: 'senda',
  motorway_link: 'principal', trunk_link: 'principal', primary_link: 'principal', secondary_link: 'principal', tertiary_link: 'secundaria',
};
const CLASS_RANK = { principal: 5, secundaria: 4, local: 3, peatonal: 2, servicio: 1, camino: 1, senda: 0.5 };

export const POI_CATEGORIES = [
  { cat: 'Ayuntamiento y administración', test: (t) => t.amenity === 'townhall' || t.office === 'government', pub: true },
  { cat: 'Juzgados', test: (t) => t.amenity === 'courthouse', pub: true },
  { cat: 'Policía', test: (t) => t.amenity === 'police', pub: true },
  { cat: 'Bomberos y emergencias', test: (t) => t.amenity === 'fire_station' || t.emergency === 'ambulance_station', pub: true },
  { cat: 'Sanidad', test: (t) => ['hospital', 'clinic', 'doctors'].includes(t.amenity) || t.healthcare === 'centre', pub: true },
  { cat: 'Educación', test: (t) => ['school', 'college', 'university', 'kindergarten'].includes(t.amenity), pub: true },
  { cat: 'Cultura', test: (t) => ['library', 'theatre', 'arts_centre', 'community_centre', 'cinema'].includes(t.amenity) || t.tourism === 'museum', pub: true },
  { cat: 'Servicios sociales', test: (t) => t.amenity === 'social_facility', pub: true },
  { cat: 'Correos', test: (t) => t.amenity === 'post_office', pub: true },
  { cat: 'Transporte', test: (t) => t.amenity === 'bus_station' || t.railway === 'station', pub: true },
  { cat: 'Mercados', test: (t) => t.amenity === 'marketplace', pub: true },
  { cat: 'Deportes', test: (t) => ['sports_centre', 'stadium', 'swimming_pool'].includes(t.leisure), pub: true },
  { cat: 'Parques', test: (t) => t.leisure === 'park', pub: false },
  { cat: 'Farmacias', test: (t) => t.amenity === 'pharmacy', pub: false },
  { cat: 'Lugares de culto', test: (t) => t.amenity === 'place_of_worship', pub: false },
  { cat: 'Patrimonio', test: (t) => !!t.historic || t.tourism === 'attraction', pub: false },
];

const PLACE_KIND = { suburb: 'barrio', neighbourhood: 'barrio', quarter: 'barrio', village: 'pedania', hamlet: 'pedania', isolated_dwelling: 'pedania' };

class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  f(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  u(a, b) { a = this.f(a); b = this.f(b); if (a !== b) this.p[b] = a; }
}

function slug(s) { return normName(s).replace(/ /g, '-').slice(0, 40); }

function expandBbox(b, m) {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}
function bboxOverlap(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }

/** Rumbo local de una vía en un nodo: hacia un punto a ~15 m por cada lado. */
function localBearings(wayCoords, idx) {
  const out = [];
  for (const dir of [1, -1]) {
    let acc = 0, j = idx;
    while (j + dir >= 0 && j + dir < wayCoords.length) {
      acc += haversine(wayCoords[j], wayCoords[j + dir]); j += dir;
      if (acc >= 15) break;
    }
    if (j !== idx) out.push(bearing(wayCoords[idx], wayCoords[j]));
  }
  return out;
}

export function buildDataset(osm, opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const ver = opts.verifications || {};
  const importedAt = opts.importedAt || new Date().toISOString();
  const issues = [];
  const elements = osm.elements || [];

  const nodes = new Map(), ways = new Map(), rels = new Map();
  for (const e of elements) {
    if (e.type === 'node') {
      const prev = nodes.get(e.id);
      nodes.set(e.id, { id: e.id, c: [e.lon, e.lat], tags: e.tags || prev?.tags || {} });
    } else if (e.type === 'way') ways.set(e.id, e);
    else if (e.type === 'relation') rels.set(e.id, e);
  }
  const wayCoords = (w) => (w.nodes || []).map((id) => nodes.get(id)?.c).filter(Boolean);

  // ---------- 1. Vías ----------
  const streetWays = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!t.highway) continue;
    const cls = HIGHWAY_CLASS[t.highway];
    if (!cls) continue;
    if (t.area === 'yes' && t.highway !== 'pedestrian') continue;
    const name = t.name || t.ref;
    if (!name) continue;
    const coords = wayCoords(w);
    if (coords.length < 2) continue;
    streetWays.push({ w, t, cls, name: t.name ? t.name.trim() : t.ref.trim(), refOnly: !t.name, coords });
  }

  // Agrupar por nombre normalizado y unir tramos conectados o cercanos.
  const groups = new Map();
  for (const sw of streetWays) {
    const k = normName(sw.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sw);
  }
  const streets = [];
  for (const [key, list] of groups) {
    const uf = new UF(list.length);
    const nodeOwner = new Map();
    list.forEach((sw, i) => sw.w.nodes.forEach((n) => {
      if (nodeOwner.has(n)) uf.u(nodeOwner.get(n), i); else nodeOwner.set(n, i);
    }));
    const bbs = list.map((sw) => expandBbox(bboxOf([sw.coords]), cfg.sameNameJoin));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (uf.f(i) === uf.f(j) || !bboxOverlap(bbs[i], bbs[j])) continue;
      if (linesToLines([list[i].coords], [list[j].coords]) <= cfg.sameNameJoin) uf.u(i, j);
    }
    const clusters = new Map();
    list.forEach((sw, i) => { const r = uf.f(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(sw); });
    for (const cl of clusters.values()) {
      const wayIds = cl.map((s) => s.w.id).sort((a, b) => a - b);
      const lines = cl.map((s) => s.coords);
      // Nombre más frecuente (respetando mayúsculas/tildes de OSM)
      const freq = {};
      for (const s of cl) freq[s.name] = (freq[s.name] || 0) + lineLength(s.coords);
      const name = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      let best = cl[0];
      for (const s of cl) if (CLASS_RANK[s.cls] > CLASS_RANK[best.cls]) best = s;
      const alt = new Set();
      for (const s of cl) for (const k of ['official_name', 'alt_name', 'old_name', 'loc_name']) if (s.t[k]) alt.add(s.t[k]);
      const refs = new Set(cl.map((s) => s.t.ref).filter(Boolean));
      const { axis, straightness } = principalAxis(lines);
      streets.push({
        id: 'w' + wayIds[0], name, key, osmName: name, alt: [...alt], highway: best.t.highway, cls: best.cls,
        ref: [...refs].join(';') || null, refOnly: cl.every((s) => s.refOnly), ways: wayIds, lines,
        length: Math.round(multiLength(lines)), mid: midpoint(lines), centroid: lineCentroid(lines),
        axis: Math.round(axis), straight: Math.round(straightness * 100) / 100, bbox: bboxOf(lines),
        _members: cl,
      });
    }
  }
  streets.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
  const byId = new Map(streets.map((s) => [s.id, s]));

  // Verificaciones: correcciones de nombre y exclusiones
  for (const s of streets) {
    const v = ver.streets?.[s.id];
    s.ver = { status: 'importado', source: 'OpenStreetMap', date: importedAt.slice(0, 10), notes: '' };
    if (v) {
      s.ver = { status: v.status || 'verificado', source: v.source || '', date: v.date || '', notes: v.notes || '' };
      if (v.nameAtCheck && normName(v.nameAtCheck) !== normName(s.osmName)) {
        issues.push({ type: 'verificacion-desfasada', id: s.id, msg: `La verificación se hizo con el nombre «${v.nameAtCheck}» y OSM ahora dice «${s.osmName}». Revísala.` });
        s.ver.status = 'dudoso';
      }
      if (v.name && v.status === 'corregido') s.name = v.name;
    }
  }

  // ---------- 2. Cruces (nodos compartidos) ----------
  const nodeStreets = new Map(); // nodeId -> Map(streetId -> [bearings])
  for (const s of streets) for (const m of s._members) {
    const cs = m.coords, ids = m.w.nodes.filter((id) => nodes.has(id));
    ids.forEach((nid, idx) => {
      let ms = nodeStreets.get(nid);
      if (!ms) nodeStreets.set(nid, ms = new Map());
      const arr = ms.get(s.id) || [];
      arr.push(...localBearings(cs, idx));
      ms.set(s.id, arr);
    });
  }
  const pairs = new Map();
  const junctionPts = [];
  for (const [nid, ms] of nodeStreets) {
    if (ms.size < 2) continue;
    const ids = [...ms.keys()].sort();
    const c = nodes.get(nid).c;
    junctionPts.push({ c, ids });
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] + '|' + ids[j];
      let p = pairs.get(k);
      if (!p) pairs.set(k, p = { id: k, a: ids[i], b: ids[j], pts: [], angles: [], nodeStreets: [] });
      p.pts.push(c); p.nodeStreets.push(ids.length);
      const ba = ms.get(ids[i]), bb = ms.get(ids[j]);
      // Ángulo local entre los ejes de ambas vías en el nodo (0–90°)
      if (ba.length && bb.length) p.angles.push(axisDiff(ba[0], bb[0]));
    }
  }
  const jIndex = new GridIndex(streets[0]?.mid || [0, 0], 50);
  for (const j of junctionPts) jIndex.insert(j.c, j.ids.join(','));
  for (const p of pairs.values()) {
    const rep = p.pts[0];
    p.angle = p.angles.length ? Math.round(p.angles.sort((x, y) => x - y)[Math.floor(p.angles.length / 2)]) : null;
    p.perp = p.angle != null && p.angle >= cfg.perpendicularMinAngle && byId.get(p.a).straight >= 0.6 && byId.get(p.b).straight >= 0.6;
    // Aislado: ningún cruce de otras vías a menos de 30 m y en el nodo solo concurren estas dos vías
    const near = jIndex.query(rep, 30).filter((x) => x.value !== [p.a, p.b].join(','));
    p.iso = near.length === 0 && p.nodeStreets[0] === 2;
    p.c = rep;
    const v = ver.pairs?.[p.id];
    p.ver = v ? { status: v.status, source: v.source || '', date: v.date || '', notes: v.notes || '' }
      : { status: 'importado', source: 'OpenStreetMap (nodo compartido)', date: importedAt.slice(0, 10), notes: '' };
  }
  const interOf = new Map(streets.map((s) => [s.id, new Set()]));
  // Los cruces marcados como erróneos se conservan (para poder revisarlos) pero no cuentan como cruce
  for (const p of pairs.values()) if (p.ver.status !== 'erroneo') { interOf.get(p.a).add(p.b); interOf.get(p.b).add(p.a); }

  // ---------- 3. Proximidad y paralelismo ----------
  const origin = streets[0]?.mid || [0, 0];
  const vIndex = new GridIndex(origin, 100);
  for (const s of streets) for (const l of s.lines) for (const v of densify(l, 20)) vIndex.insert(v, s.id);
  for (const s of streets) {
    const cand = new Map();
    for (const l of s.lines) for (const v of densify(l, 40)) {
      for (const h of vIndex.query(v, cfg.nearDist + 20)) {
        if (h.value === s.id) continue;
        if (!cand.has(h.value) || cand.get(h.value) > h.d) cand.set(h.value, h.d);
      }
    }
    s.near = [];
    for (const [oid] of cand) {
      const o = byId.get(oid);
      const d = interOf.get(s.id).has(oid) ? 0 : linesToLines(s.lines, o.lines);
      if (d <= cfg.nearDist) s.near.push([oid, Math.round(d)]);
    }
    s.near.sort((a, b) => a[1] - b[1]);
  }
  for (const s of streets) {
    s.par = [];
    if (s.straight < 0.8 || s.length < 80) continue;
    for (const [oid, d] of s.near) {
      const o = byId.get(oid);
      if (d < 15 || interOf.get(s.id).has(oid) || o.straight < 0.8 || o.length < 80) continue;
      if (axisDiff(s.axis, o.axis) > cfg.parallelMaxAngle) continue;
      const ax = s.length >= o.length ? s.axis : o.axis;
      const A = projectOnAxis(s.lines, s.mid, ax), B = projectOnAxis(o.lines, s.mid, ax);
      const ov = Math.min(A[1], B[1]) - Math.max(A[0], B[0]);
      if (ov / Math.min(A[1] - A[0], B[1] - B[0]) >= 0.3) s.par.push(oid);
    }
  }

  // ---------- 4. Puntos de interés ----------
  const pois = [];
  const ringOfWay = (w) => { const c = wayCoords(w); return c.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1] ? c : null; };
  const addPoi = (e, tags, pt, ring) => {
    const def = POI_CATEGORIES.find((d) => d.test(tags));
    if (!def || !tags.name) return;
    pois.push({ id: e.type[0] + e.id, name: tags.name.trim(), cat: def.cat, pub: def.pub, c: pt, ring, tags });
  };
  for (const n of nodes.values()) if (n.tags && Object.keys(n.tags).length) addPoi({ type: 'node', id: n.id }, n.tags, n.c, null);
  for (const w of ways.values()) {
    if (!w.tags || w.tags.highway) continue;
    const ring = ringOfWay(w);
    const coords = wayCoords(w);
    if (!coords.length) continue;
    addPoi(w, w.tags, ring ? polygonCentroid(ring) : coords[Math.floor(coords.length / 2)], ring);
  }
  const relOuter = (r) => {
    const outers = (r.members || []).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => ways.get(m.ref)).filter(Boolean);
    let best = null, bestA = -1;
    for (const w of outers) { const ring = ringOfWay(w); if (ring) { const b = bboxOf([ring]); const a = (b[2] - b[0]) * (b[3] - b[1]); if (a > bestA) { bestA = a; best = ring; } } }
    if (!best && outers.length) best = outers.flatMap(wayCoords);
    return best;
  };
  for (const r of rels.values()) {
    if (!r.tags) continue;
    const ring = relOuter(r);
    if (!ring || !ring.length) continue;
    addPoi(r, r.tags, polygonCentroid(ring), ring.length >= 4 ? ring : null);
  }
  const nameCount = {};
  for (const p of pois) nameCount[normName(p.name)] = (nameCount[normName(p.name)] || 0) + 1;
  const sIndex = new GridIndex(origin, 100);
  for (const s of streets) for (const l of s.lines) for (const v of densify(l, 15)) sIndex.insert(v, s.id);
  const byKey = new Map();
  for (const s of streets) { if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push(s); }
  for (const p of pois) {
    p.dup = nameCount[normName(p.name)] > 1;
    p.addr = p.tags['addr:street'] ? (p.tags['addr:street'] + (p.tags['addr:housenumber'] ? ', ' + p.tags['addr:housenumber'] : '')) : null;
    const dists = new Map();
    for (const h of sIndex.query(p.c, 200)) if (!dists.has(h.value)) dists.set(h.value, 0);
    for (const id of dists.keys()) dists.set(id, pointToLines(p.c, byId.get(id).lines));
    const sorted = [...dists.entries()].sort((a, b) => a[1] - b[1]);
    p.street = null; p.streetMethod = null; p.streetDist = null;
    if (p.tags['addr:street']) {
      const cands = byKey.get(normName(p.tags['addr:street'])) || [];
      if (cands.length) {
        let bst = null, bd = Infinity;
        for (const s of cands) { const d = pointToLines(p.c, s.lines); if (d < bd) { bd = d; bst = s; } }
        if (bd <= 400) { p.street = bst.id; p.streetMethod = 'addr:street'; p.streetDist = Math.round(bd); }
        else issues.push({ type: 'poi-direccion-lejana', id: p.id, msg: `«${p.name}» indica addr:street «${p.tags['addr:street']}» pero esa vía está a ${Math.round(bd)} m.` });
      } else issues.push({ type: 'poi-direccion-desconocida', id: p.id, msg: `«${p.name}» indica addr:street «${p.tags['addr:street']}», que no coincide con ninguna vía importada.` });
    }
    if (!p.street && sorted.length) {
      const [s1, d1] = sorted[0];
      const second = sorted.find(([id]) => byId.get(id).key !== byId.get(s1).key);
      const d2 = second ? second[1] : Infinity;
      if (d1 <= 35 && d2 - d1 >= 25) { p.street = s1; p.streetMethod = 'proximidad'; p.streetDist = Math.round(d1); }
    }
    p.nearest = sorted.slice(0, 3).map(([id, d]) => [id, Math.round(d)]);
    const v = ver.pois?.[p.id];
    p.ver = v ? { status: v.status, source: v.source || '', date: v.date || '', notes: v.notes || '' }
      : { status: 'importado', source: 'OpenStreetMap', date: importedAt.slice(0, 10), notes: '' };
    if (v?.street && byId.has(v.street)) { p.street = v.street; p.streetMethod = 'verificación'; }
    if (v?.name && v.status === 'corregido') p.name = v.name;
  }
  pois.sort((a, b) => a.cat.localeCompare(b.cat, 'es') || a.name.localeCompare(b.name, 'es'));

  // ---------- 5. Zonas ----------
  const zones = [];
  const placeNodes = [], placePolys = [], industrial = [];
  let town = null;
  for (const n of nodes.values()) {
    const t = n.tags || {};
    if (t.place === 'town' || t.place === 'city') { if (!town || normName(t.name) === normName(cfg.townName)) town = { c: n.c, name: t.name, id: 'n' + n.id }; }
    else if (PLACE_KIND[t.place] && t.name) placeNodes.push({ id: 'n' + n.id, name: t.name, kind: PLACE_KIND[t.place], place: t.place, c: n.c });
  }
  const polyOf = (e) => e.type === 'way' ? ringOfWay(e) : relOuter(e);
  for (const e of [...ways.values(), ...rels.values()]) {
    const t = e.tags || {};
    if (t.landuse === 'industrial' && t.name) { const r = polyOf(e); if (r && r.length >= 4) industrial.push({ id: e.type[0] + e.id, name: t.name, ring: r }); }
    else if (PLACE_KIND[t.place] && t.name) { const r = polyOf(e); if (r && r.length >= 4) placePolys.push({ id: e.type[0] + e.id, name: t.name, kind: PLACE_KIND[t.place], place: t.place, ring: r }); }
  }
  if (!town) {
    const th = pois.find((p) => p.cat === 'Ayuntamiento y administración' && /ayuntamiento/i.test(p.name));
    if (th) { town = { c: th.c, name: cfg.townName, id: th.id, fallback: true }; issues.push({ type: 'sin-nodo-town', id: th.id, msg: 'No hay nodo place=town; el centro urbano se calcula desde el Ayuntamiento.' }); }
  }
  const zoneMap = new Map();
  const addZone = (z) => { zoneMap.set(z.id, { ...z, streets: [] }); zones.push(zoneMap.get(z.id)); };
  for (const p of industrial) addZone({ id: 'pol-' + slug(p.name), name: p.name, zkind: 'poligono', method: `Polígono landuse=industrial de OSM (${p.id}). Una vía pertenece si su punto medio queda dentro.`, ring: p.ring, c: polygonCentroid(p.ring) });
  for (const p of placePolys) addZone({ id: 'pl-' + slug(p.name), name: p.name, zkind: p.kind, method: `Polígono place=${p.place} de OSM (${p.id}).`, ring: p.ring, c: polygonCentroid(p.ring) });
  for (const p of placeNodes) if (!zoneMap.has('pl-' + slug(p.name))) {
    const r = p.kind === 'barrio' ? cfg.neighbourhoodRadius : cfg.villageRadius;
    addZone({ id: 'pl-' + slug(p.name), name: p.name, zkind: p.kind, method: `Zona aproximada: vías cuyo punto medio está a menos de ${r} m del punto place=${p.place} de OSM (${p.id}) y más cerca de él que de otro punto del mismo tipo. No es una delimitación oficial.`, c: p.c, radius: r, place: p.place });
  }
  const thematic = [
    ['centro', 'Centro urbano', town ? `Vías cuyo punto medio está a menos de ${cfg.centerRadius} m del ${town.fallback ? 'Ayuntamiento' : 'punto place=town de OSM'}. Delimitación aproximada, no oficial.` : null],
    ['residencial', 'Zonas residenciales', 'Vías clasificadas en OSM como highway=residential o living_street, fuera del centro y de los polígonos.'],
    ['periferia', 'Zonas periféricas', town ? `Vías urbanas cuyo punto medio está entre ${cfg.peripheryDistance} y ${cfg.peripheryMax} m del centro.` : null],
    ['accesos', 'Principales accesos y vías principales', 'Vías clasificadas en OSM como motorway, trunk, primary o secondary, o con referencia de carretera (ref).'],
    ['entorno-publico', 'Entorno de edificios públicos', `Vías a menos de ${cfg.publicPoiBuffer} m de un edificio o servicio público importado de OSM.`],
  ];
  for (const [id, name, method] of thematic) if (method) addZone({ id, name, zkind: 'tematica', method });

  const pubPois = pois.filter((p) => p.pub);
  for (const s of streets) {
    const m = s.mid;
    const dc = town ? haversine(m, town.c) : null;
    s.zones = [];
    let primary = null;
    for (const z of zones) if (z.ring && z.zkind === 'poligono' && pointInRing(m, z.ring)) { primary = z; break; }
    if (!primary) for (const z of zones) if (z.ring && z.zkind !== 'poligono' && pointInRing(m, z.ring)) { primary = z; break; }
    if (!primary) {
      for (const kind of ['barrio', 'pedania']) {
        let best = null, bd = Infinity;
        for (const z of zones) if (!z.ring && z.zkind === kind) { const d = haversine(m, z.c); if (d < bd) { bd = d; best = z; } }
        if (best && bd <= best.radius) { primary = best; break; }
      }
    }
    if (primary) s.zones.push(primary.id);
    s.zone = primary ? primary.id : null;
    const inPol = primary?.zkind === 'poligono';
    const center = dc != null && dc <= cfg.centerRadius;
    if (center) s.zones.push('centro');
    if (!center && !inPol && ['residential', 'living_street'].includes(s.highway)) s.zones.push('residencial');
    s.rural = ['camino', 'senda'].includes(s.cls) || (dc != null && dc > cfg.peripheryMax && primary?.zkind !== 'pedania' && !inPol);
    if (!s.rural && dc != null && dc > cfg.peripheryDistance && dc <= cfg.peripheryMax) s.zones.push('periferia');
    if (s.cls === 'principal' || s.ref) s.zones.push('accesos');
    if (pubPois.some((p) => haversine(p.c, m) < cfg.publicPoiBuffer + s.length && pointToLines(p.c, s.lines) <= cfg.publicPoiBuffer)) s.zones.push('entorno-publico');
    for (const z of s.zones) zoneMap.get(z)?.streets.push(s.id);
    s.dc = dc != null ? Math.round(dc) : null;
  }
  // Etiquetas inequívocas para nombres repetidos en distintos lugares
  for (const list of byKey.values()) {
    if (list.length < 2) { list.forEach((s) => (s.label = s.name)); continue; }
    const used = new Set();
    list.forEach((s, i) => {
      let tag = s.zone ? zoneMap.get(s.zone).name : `tramo ${i + 1}`;
      if (used.has(tag)) tag = `${tag}, tramo ${i + 1}`;
      used.add(tag); s.label = `${s.name} (${tag})`;
    });
    issues.push({ type: 'nombre-repetido', id: list.map((s) => s.id).join(','), msg: `«${list[0].name}» aparece en ${list.length} lugares separados; se distinguen como ${list.map((s) => '«' + s.label + '»').join(', ')}.` });
  }
  for (const p of pois) {
    p.zones = [];
    for (const z of zones) if (z.ring && pointInRing(p.c, z.ring)) p.zones.push(z.id);
    if (p.street) for (const z of byId.get(p.street).zones) if (!p.zones.includes(z)) p.zones.push(z);
  }

  // ---------- 6. Avisos de calidad ----------
  for (const s of streets) {
    if (!interOf.get(s.id).size && !s.rural) issues.push({ type: 'via-sin-cruces', id: s.id, msg: `«${s.label}» no comparte nodos con otras vías importadas (posible error topológico o vía aislada).` });
    if (/^(c\/|avda|av\.|pza|ctra\.)/i.test(s.name) || s.name === s.name.toLowerCase()) issues.push({ type: 'nombre-sospechoso', id: s.id, msg: `Nombre con abreviatura o en minúsculas: «${s.name}».` });
  }
  for (const p of pois) if (!p.street && p.pub) issues.push({ type: 'poi-sin-via', id: p.id, msg: `No se puede asignar una vía inequívoca a «${p.name}».` });

  // ---------- 7. Salida GeoJSON ----------
  const ll = (c) => round6(c);
  const features = [];
  for (const s of streets) features.push({
    type: 'Feature', id: s.id,
    geometry: { type: 'MultiLineString', coordinates: s.lines.map((l) => l.map(ll)) },
    properties: {
      kind: 'street', id: s.id, name: s.name, label: s.label, osmName: s.osmName, alt: s.alt, highway: s.highway, cls: s.cls,
      ref: s.ref, refOnly: s.refOnly, length: s.length, axis: s.axis, straight: s.straight, mid: ll(s.mid),
      zone: s.zone, zones: s.zones, rural: s.rural, dc: s.dc, osm: s.ways.map((w) => 'way/' + w),
      inter: [...interOf.get(s.id)].sort(), near: s.near, par: s.par.sort(), ver: s.ver,
    },
  });
  for (const p of pairs.values()) features.push({
    type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: ll(p.c) },
    properties: { kind: 'pair', id: p.id, a: p.a, b: p.b, n: p.pts.length, angle: p.angle, perp: p.perp, iso: p.iso, pts: p.pts.slice(1, 6).map(ll), ver: p.ver },
  });
  for (const p of pois) features.push({
    type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: ll(p.c) },
    properties: {
      kind: 'poi', id: p.id, name: p.name, cat: p.cat, pub: p.pub, addr: p.addr, street: p.street, streetMethod: p.streetMethod,
      streetDist: p.streetDist, nearest: p.nearest, dup: p.dup, zones: p.zones, ring: p.ring ? p.ring.map(ll) : null,
      osm: (p.id[0] === 'n' ? 'node/' : p.id[0] === 'w' ? 'way/' : 'relation/') + p.id.slice(1), ver: p.ver,
    },
  });
  for (const z of zones) features.push({
    type: 'Feature', id: 'zone:' + z.id,
    geometry: z.ring ? { type: 'Polygon', coordinates: [z.ring.map(ll)] } : z.c ? { type: 'Point', coordinates: ll(z.c) } : null,
    properties: { kind: 'zone', id: z.id, name: z.name, zkind: z.zkind, method: z.method, radius: z.radius || null, streets: z.streets },
  });

  const counts = {
    streets: streets.length, urbanStreets: streets.filter((s) => !s.rural).length, pairs: pairs.size,
    pois: pois.length, zones: zones.length, issues: issues.length,
  };
  return {
    type: 'FeatureCollection',
    metadata: {
      schema: SCHEMA_VERSION, title: `Callejero de ${cfg.townName}`,
      source: 'OpenStreetMap', license: 'ODbL 1.0', attribution: '© colaboradores de OpenStreetMap',
      importedAt, osmBase: osm.osm3s?.timestamp_osm_base || null, builtAt: new Date().toISOString(),
      town: town ? { name: town.name, c: ll(town.c), fallback: !!town.fallback } : null,
      config: cfg, counts, issues: issues.slice(0, 800),
    },
    features,
  };
}
