// Mapa del callejero con Leaflet. Las vías y edificios se dibujan desde los datos vectoriales
// locales (funciona sin conexión). El mapa base de OpenStreetMap es opcional: se carga en
// línea bajo demanda, con atribución, y nunca se descarga ni se guarda en caché de forma masiva.

import L from 'leaflet';
import { app } from '../app/store.js';
import { pointToLines, haversine } from '../engine/geo.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a>';
const LL = (c) => [c[1], c[0]];
const linesLL = (lines) => lines.map((l) => l.map(LL));

export const CAT_COLORS = {
  'Ayuntamiento y administración': '#1d4ed8', 'Juzgados': '#4338ca', 'Policía': '#0f172a', 'Bomberos y emergencias': '#dc2626',
  'Sanidad': '#16a34a', 'Educación': '#ea580c', 'Cultura': '#9333ea', 'Servicios sociales': '#db2777', 'Correos': '#ca8a04',
  'Transporte': '#0891b2', 'Mercados': '#65a30d', 'Deportes': '#0d9488', 'Parques': '#15803d', 'Farmacias': '#059669',
  'Lugares de culto': '#78716c', 'Patrimonio': '#a16207',
};
const CLS_WEIGHT = { principal: 6, secundaria: 5, local: 3.5, peatonal: 2.5, servicio: 2.5, camino: 2, senda: 1.5 };
export const OPTION_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#9333ea'];

/**
 * Crea un mapa. opts:
 *  muted: sin etiquetas ni mapa base (modo mapa mudo)
 *  tiles: forzar mapa base (por defecto según ajustes y conexión)
 *  onStreetClick(street, latlng): clic sobre una vía (la más cercana a ≤ 30 m)
 *  onMapClick(latlng)
 *  interactive: false para mapas estáticos dentro de preguntas
 */
export function createMap(container, opts = {}) {
  const M = app.model;
  const muted = !!opts.muted;
  const map = L.map(container, { zoomControl: opts.zoomControl !== false, preferCanvas: true, attributionControl: true, maxZoom: 19, minZoom: 11 });
  map.attributionControl.setPrefix(false);
  const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
  let tiles = null;
  const wantTiles = !muted && (opts.tiles ?? app.settings.baseTiles) && navigator.onLine;
  if (wantTiles) { tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTR, crossOrigin: true }); tiles.addTo(map); container.classList.remove('no-tiles'); }
  else { container.classList.add('no-tiles'); map.attributionControl.addAttribution('Datos: ' + ATTR); }

  // Capa base vectorial
  const base = L.layerGroup().addTo(map);
  const streetLayers = new Map();
  const visibleStreets = opts.streets ? M.streets.filter((s) => opts.streets.has(s.id)) : M.streets;
  for (const s of visibleStreets) {
    const pl = L.polyline(linesLL(s.lines), { renderer, color: muted || wantTiles ? '#64748b' : '#475569', weight: CLS_WEIGHT[s.cls] || 3, opacity: wantTiles ? 0.35 : 0.85, interactive: false });
    pl.addTo(base); streetLayers.set(s.id, pl);
  }
  const buildings = L.layerGroup();
  for (const p of M.pois) if (p.ring) L.polygon(p.ring.map(LL), { renderer, color: '#94a3b8', weight: 1, fillColor: '#cbd5e1', fillOpacity: 0.6, interactive: false }).addTo(buildings);
  if (muted || opts.buildings !== false) buildings.addTo(map);

  const overlay = L.layerGroup().addTo(map);
  const labels = L.layerGroup().addTo(map);
  let showLabels = !muted && !wantTiles && opts.labels !== false;

  function refreshLabels() {
    labels.clearLayers();
    if (!showLabels) return;
    let b;
    try { if (map.getZoom() < 16) return; b = map.getBounds().pad(-0.05); } catch { return; } // vista aún no fijada

    let n = 0;
    for (const s of visibleStreets) {
      const mid = LL(s.mid);
      if (!b.contains(mid)) continue;
      if (++n > 160) break;
      L.tooltip({ permanent: true, direction: 'center', className: 'street-label', interactive: false }).setLatLng(mid).setContent(s.label).addTo(labels);
    }
  }
  map.on('moveend zoomend', refreshLabels);

  const nearestStreet = (ll, tol = 30, pool = visibleStreets) => {
    const pt = [ll.lng, ll.lat];
    let best = null, bd = Infinity;
    for (const s of pool) {
      const bb = s.bbox, pad = 0.0005;
      if (pt[0] < bb[0] - pad || pt[0] > bb[2] + pad || pt[1] < bb[1] - pad || pt[1] > bb[3] + pad) continue;
      const d = pointToLines(pt, s.lines);
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= tol ? { street: best, d: bd } : null;
  };
  map.on('click', (e) => {
    opts.onMapClick?.(e.latlng);
    if (opts.onStreetClick) { const r = nearestStreet(e.latlng); opts.onStreetClick(r?.street || null, e.latlng); }
  });

  // Leaflet exige una vista inicial antes de consultar límites o zoom
  if (opts.fit !== false) fitAll(); else map.setView(LL(M.meta.town?.c || visibleStreets[0]?.mid || [-1.42, 38.24]), 15);
  function fitAll() {
    const t = M.meta.town?.c;
    if (t && !opts.streets) map.setView(LL(t), 15);
    else { const b = boundsOf(visibleStreets.map((s) => s.id)); if (b) map.fitBounds(b, { padding: [20, 20] }); else map.setView([38.24, -1.42], 14); }
  }
  function boundsOf(ids) {
    let b = null;
    for (const id of ids) { const s = M.street.get(id); if (!s) continue; const bb = L.latLngBounds([s.bbox[1], s.bbox[0]], [s.bbox[3], s.bbox[2]]); b = b ? b.extend(bb) : bb; }
    return b;
  }

  const api = {
    map, L, nearestStreet,
    clear() { overlay.clearLayers(); },
    setLabels(v) { showLabels = v && !muted; refreshLabels(); },
    setTiles(v) {
      if (v && !tiles && !muted) { tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTR }); tiles.addTo(map); tiles.bringToBack(); container.classList.remove('no-tiles'); }
      else if (!v && tiles) { map.removeLayer(tiles); tiles = null; container.classList.add('no-tiles'); }
      for (const pl of streetLayers.values()) pl.setStyle({ opacity: tiles ? 0.35 : 0.85 });
    },
    setBuildings(v) { if (v) buildings.addTo(map); else map.removeLayer(buildings); },
    setBaseVisible(v) { if (v) base.addTo(map); else map.removeLayer(base); },
    highlight(ids, { color = '#f59e0b', weight = 8, label = false, fit = false, letters = null, dash = null, pinColor = null, colors = null } = {}) {
      ids.forEach((id, i) => {
        const s = M.street.get(id); if (!s) return;
        const c = colors ? colors[i] : letters ? (pinColor || OPTION_COLORS[i % 4]) : color;
        L.polyline(linesLL(s.lines), { renderer, color: '#fff', weight: weight + 4, opacity: 0.9, interactive: false }).addTo(overlay);
        L.polyline(linesLL(s.lines), { renderer, color: c, weight, opacity: 1, dashArray: dash, interactive: false }).addTo(overlay);
        if (letters) L.marker(LL(s.mid), { icon: L.divIcon({ className: 'letter-pin', html: `<span style="background:${c}">${letters[i]}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false }).addTo(overlay);
        if (label) L.tooltip({ permanent: true, direction: 'top', className: 'street-label strong', interactive: false }).setLatLng(LL(s.mid)).setContent(s.label).addTo(overlay);
      });
      if (fit) api.fit(ids);
    },
    point(c, { color = '#dc2626', label = null, radius = 9 } = {}) {
      L.circleMarker(LL(c), { renderer, radius, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, interactive: false }).addTo(overlay);
      if (label) L.tooltip({ permanent: true, direction: 'top', offset: [0, -8], className: 'street-label strong', interactive: false }).setLatLng(LL(c)).setContent(label).addTo(overlay);
    },
    pois(list, { labels: lab = true, onClick } = {}) {
      for (const p of list) {
        const m = L.circleMarker(LL(p.c), { radius: 7, color: '#fff', weight: 2, fillColor: CAT_COLORS[p.cat] || '#334155', fillOpacity: 1 }).addTo(overlay);
        if (lab) m.bindTooltip(p.name, { direction: 'top', offset: [0, -6] });
        if (onClick) m.on('click', (e) => { L.DomEvent.stopPropagation(e); onClick(p); });
      }
    },
    fit(ids, maxZoom = 18) { const b = boundsOf(ids); if (b) map.fitBounds(b, { padding: [30, 30], maxZoom }); },
    fitPoints(pts, maxZoom = 17) { if (pts.length) map.fitBounds(L.latLngBounds(pts.map(LL)), { padding: [40, 40], maxZoom }); },
    around(c, radius = 300, jitter = false) {
      let center = c;
      if (jitter) { const a = Math.random() * 2 * Math.PI, r = radius * 0.45 * Math.random(); center = [c[0] + (r * Math.sin(a)) / (111320 * Math.cos(c[1] * Math.PI / 180)), c[1] + (r * Math.cos(a)) / 111320]; }
      const dLat = radius / 111320, dLon = radius / (111320 * Math.cos(center[1] * Math.PI / 180));
      map.fitBounds([[center[1] - dLat, center[0] - dLon], [center[1] + dLat, center[0] + dLon]]);
    },
    invalidate() { setTimeout(() => map.invalidateSize(), 50); },
    destroy() { map.off(); map.remove(); },
  };
  refreshLabels();
  return api;
}

/** Dibuja en un mapa el contexto de una pregunta (antes de responder). */
export function drawQuestion(mp, q) {
  const M = app.model; const m = q.map; if (!m) return;
  mp.clear();
  if (m.mode === 'highlight') { mp.highlight(m.streets, { color: '#f59e0b' }); focus(mp, q); }
  else if (m.mode === 'choices') { mp.highlight(m.streets, { letters: m.letters, weight: 7 }); mp.fit(m.focus, 18); }
  else if (m.mode === 'point') { mp.point(m.points[0], { radius: 10 }); mp.around(m.points[0], m.radius || 250, true); }
  else if (m.mode === 'poi') { mp.point(m.focusPoint, { color: '#1d4ed8', radius: 10 }); mp.around(m.focusPoint, m.radius || 350, true); }
  else if (m.mode === 'tap') { const s = M.street.get(m.focus[0]); mp.around(s.mid, m.radius || 450, !!m.jitter); }
}
function focus(mp, q) {
  const s = app.model.street.get(q.map.focus[0]);
  if (!s) return;
  if (s.length > (q.map.radius || 300) * 1.6) mp.fit([s.id], 17); else mp.around(s.mid, q.map.radius || 300, true);
}

/** Muestra la solución en el mapa tras responder. */
export function drawSolution(mp, q) {
  const M = app.model; const m = q.map || {};
  mp.clear();
  const ids = (m.streets && m.streets.length ? m.streets : q.refs?.streets?.slice(0, 2)) || [];
  if (m.mode === 'choices') { mp.highlight(m.streets, { letters: m.letters, weight: 7 }); mp.highlight([q.tap.id], { color: '#16a34a', weight: 9, label: true }); mp.fit(m.focus, 18); return; }
  if (m.mode === 'point') { const pr = M.pair.get(q.refs.pairs[0]); mp.highlight([pr.a, pr.b], { color: '#16a34a', label: true }); mp.point(pr.c); mp.fitPoints([pr.c], 17); mp.around(pr.c, 220); return; }
  if (q.tap && !q.options) { mp.highlight([q.tap.id], { color: '#16a34a', weight: 9, label: true, fit: true }); return; }
  const colors = ['#16a34a', '#2563eb', '#9333ea'];
  ids.forEach((id, i) => mp.highlight([id], { color: colors[i % 3], label: true }));
  const pts = [...(m.points || [])];
  for (const pid of m.pois || q.refs?.pois?.slice(0, 2) || []) { const p = M.poi.get(pid); if (p) { mp.point(p.c, { color: '#1d4ed8', label: p.name }); pts.push(p.c); } }
  for (const c of m.points || []) mp.point(c);
  if (ids.length) mp.fit(ids, 17); else if (pts.length) mp.fitPoints(pts);
}

export { haversine };
