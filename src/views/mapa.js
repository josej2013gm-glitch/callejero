import { html, setHTML, $, $$, esc } from '../ui/dom.js';
import { app } from '../app/store.js';
import { createMap, CAT_COLORS } from '../ui/map.js';
import { CLS_LABEL, VER_LABEL } from '../engine/model.js';
import { normName } from '../engine/geo.js';
import { streetState } from '../app/analytics.js';

const STATE = { nueva: 'Sin estudiar', estudiada: 'En estudio', dominada: 'Dominada' };

export default {
  title: 'Mapa interactivo',
  render(root, params) {
    const M = app.model;
    const zonesSorted = M.zones.slice().sort((a, b) => (a.zkind === 'tematica' ? 0 : 1) - (b.zkind === 'tematica' ? 0 : 1) || a.name.localeCompare(b.name, 'es'));
    const cats = [...new Set(M.pois.map((p) => p.cat))].sort();
    setHTML(root, html`
      <div class="map-page">
        <aside class="map-side card">
          <label class="search"><span class="sr">Buscar calle o edificio</span>
            <input type="search" id="q" placeholder="Buscar calle o edificio…" autocomplete="off">
          </label>
          <ul id="results" class="results"></ul>
          <details open><summary>Capas</summary>
            <label class="sw"><input type="checkbox" id="lyTiles" ${app.settings.baseTiles && navigator.onLine ? 'checked' : ''} ${navigator.onLine ? '' : 'disabled'}> Mapa base OpenStreetMap ${navigator.onLine ? '' : '(sin conexión)'}</label>
            <label class="sw"><input type="checkbox" id="lyLabels" checked> Nombres de calles</label>
            <label class="sw"><input type="checkbox" id="lyStreets" checked> Vías</label>
            <label class="sw"><input type="checkbox" id="lyBuild" checked> Edificios (contornos)</label>
            <label class="sw"><input type="checkbox" id="lyPois" checked> Puntos de interés</label>
            <label class="sw"><input type="checkbox" id="lyMudo"> <b>Modo mapa mudo</b></label>
          </details>
          <details><summary>Filtrar edificios</summary>
            ${cats.map((c) => html`<label class="sw"><input type="checkbox" class="cat" value="${c}" checked> <i class="dot" style="background:${CAT_COLORS[c] || '#334155'}"></i>${c}</label>`)}
          </details>
          <label>Zona
            <select id="zone"><option value="">Todo el municipio</option>${zonesSorted.map((z) => html`<option value="${z.id}" ${params.zona === z.id ? 'selected' : ''}>${z.zkind === 'tematica' ? '◆ ' : ''}${z.name} (${z.streets.length})</option>`)}</select>
          </label>
          <div id="info" class="info"><p class="muted">Toca una vía o un edificio para ver su información.</p></div>
        </aside>
        <div class="map-wrap"><div id="map" class="map big"></div></div>
      </div>`);

    let mp = null, current = null, zoneId = params.zona || '';
    const build = () => {
      mp?.destroy();
      const muted = $('#lyMudo', root).checked;
      mp = createMap($('#map', root), { muted, tiles: $('#lyTiles', root).checked, labels: $('#lyLabels', root).checked, onStreetClick: (s) => s && select(s.id) });
      drawPois(); if (zoneId) showZone(zoneId, false);
      if (current) select(current, false);
    };
    const drawPois = () => {
      if (!$('#lyPois', root).checked) return;
      const on = new Set($$('.cat', root).filter((c) => c.checked).map((c) => c.value));
      mp.pois(M.pois.filter((p) => on.has(p.cat)), { labels: !$('#lyMudo', root).checked, onClick: (p) => selectPoi(p.id) });
    };
    const redraw = () => { mp.clear(); drawPois(); if (zoneId) showZone(zoneId, false); if (current) highlightStreet(current); };

    function highlightStreet(id) {
      const s = M.street.get(id);
      mp.highlight([id], { color: '#f59e0b', weight: 8, label: !$('#lyMudo', root).checked });
      for (const x of M.inter.get(id)) { const p = M.pairOf(id, x); if (p && p.ver.status !== 'erroneo') mp.point(p.c, { color: '#1d4ed8', radius: 5 }); }
      return s;
    }
    function select(id, fit = true) {
      current = id; redraw();
      const s = highlightStreet(id);
      if (fit) mp.fit([id], 17);
      const inter = [...M.inter.get(id)].map((x) => M.street.get(x)).sort((a, b) => a.label.localeCompare(b.label, 'es'));
      const near = [...M.near.get(id)].filter(([x, d]) => d > 0 && d <= 80 && !M.intersects(id, x)).map(([x, d]) => [M.street.get(x), d]);
      const par = [...M.par.get(id)].map((x) => M.street.get(x));
      const pois = M.poisOf.get(id) || [];
      const zones = s.zones.map((z) => M.zone.get(z)?.name).filter(Boolean);
      setHTML($('#info', root), html`
        <h3>${s.label}</h3>
        <ul class="kv small">
          <li><span>Tipo</span><b>${CLS_LABEL[s.cls] || s.cls} (highway=${s.highway})</b></li>
          <li><span>Longitud</span><b>${s.length} m</b></li>
          ${s.ref ? html`<li><span>Referencia</span><b>${s.ref}</b></li>` : ''}
          <li><span>Zonas</span><b>${zones.join(', ') || '—'}</b></li>
          <li><span>Tu estado</span><b>${STATE[streetState(id)]}</b></li>
          <li><span>Datos</span><b class="ver ${s.ver.status}">${VER_LABEL[s.ver.status]}</b></li>
          <li><span>Fuente</span><b>${s.ver.source} · ${s.ver.date}</b></li>
        </ul>
        ${s.alt?.length ? html`<p class="small">Otros nombres en OSM: ${s.alt.join(', ')}</p>` : ''}
        <h4>Cruces (${inter.length})</h4>${list(inter)}
        <h4>Calles próximas sin cruce (≤ 80 m)</h4>${near.length ? html`<ul class="links">${near.map(([o, d]) => html`<li><a href="#" data-s="${o.id}">${o.label}</a> <small>${d} m</small></li>`)}</ul>` : html`<p class="muted small">Ninguna.</p>`}
        <h4>Paralelas</h4>${list(par)}
        <h4>Edificios y servicios</h4>${pois.length ? html`<ul class="links">${pois.map((p) => html`<li><a href="#" data-p="${p.id}">${p.name}</a> <small>${p.cat}</small></li>`)}</ul>` : html`<p class="muted small">Ninguno asociado.</p>`}
        <p class="small"><a href="https://www.openstreetmap.org/${s.osm[0]}" target="_blank" rel="noopener">Ver en OpenStreetMap ↗</a> · <a href="#/entrenamiento?calle=${s.id}">Practicar esta calle</a></p>`);
    }
    const list = (arr) => arr.length ? html`<ul class="links">${arr.map((o) => html`<li><a href="#" data-s="${o.id}">${o.label}</a></li>`)}</ul>` : html`<p class="muted small">Ninguna.</p>`;

    function selectPoi(id) {
      const p = M.poi.get(id); current = null; redraw();
      mp.point(p.c, { color: CAT_COLORS[p.cat] || '#1d4ed8', label: $('#lyMudo', root).checked ? null : p.name, radius: 10 });
      if (p.street) mp.highlight([p.street], { color: '#f59e0b', label: !$('#lyMudo', root).checked });
      mp.map.setView([p.c[1], p.c[0]], Math.max(mp.map.getZoom(), 17));
      const st = p.street ? M.street.get(p.street) : null;
      setHTML($('#info', root), html`
        <h3>${p.name}</h3>
        <ul class="kv small">
          <li><span>Categoría</span><b>${p.cat}</b></li>
          <li><span>Dirección (OSM)</span><b>${p.addr || '—'}</b></li>
          <li><span>Vía asociada</span><b>${st ? html`<a href="#" data-s="${st.id}">${st.label}</a> <small>(${p.streetMethod}${p.streetDist != null ? ', ' + p.streetDist + ' m' : ''})</small>` : 'sin asignar (ambigua)'}</b></li>
          <li><span>Datos</span><b class="ver ${p.ver.status}">${VER_LABEL[p.ver.status]}</b></li>
        </ul>
        <p class="small"><a href="https://www.openstreetmap.org/${p.osm}" target="_blank" rel="noopener">Ver en OpenStreetMap ↗</a></p>`);
    }
    function showZone(id, fit = true) {
      const z = M.zone.get(id); if (!z) return;
      mp.highlight(z.streets, { color: '#2563eb', weight: 5 });
      if (fit) mp.fit(z.streets, 16);
      if (fit) setHTML($('#info', root), html`<h3>${z.name}</h3><p class="small">${z.method}</p><p><b>${z.streets.length}</b> vías.</p><a class="btn small" href="#/zonas?z=${encodeURIComponent(id)}">Estudiar esta zona</a>`);
    }

    // Búsqueda
    const qIn = $('#q', root), res = $('#results', root);
    qIn.addEventListener('input', () => {
      const t = normName(qIn.value);
      if (t.length < 2) { res.innerHTML = ''; return; }
      const parts = t.split(' ');
      const sm = M.streets.filter((s) => parts.every((p) => normName(s.label).includes(p) || s.alt?.some((a) => normName(a).includes(p)))).slice(0, 12);
      const pm = M.pois.filter((p) => parts.every((x) => normName(p.name).includes(x))).slice(0, 6);
      res.innerHTML = [...sm.map((s) => `<li><a href="#" data-s="${s.id}">${esc(s.label)}</a></li>`), ...pm.map((p) => `<li><a href="#" data-p="${p.id}">🏛 ${esc(p.name)}</a></li>`)].join('') || '<li class="muted">Sin resultados</li>';
    });
    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-s],a[data-p]'); if (!a) return;
      e.preventDefault();
      if (a.dataset.s) select(a.dataset.s); else selectPoi(a.dataset.p);
      res.innerHTML = '';
    });
    $('#lyTiles', root).addEventListener('change', (e) => { if (!$('#lyMudo', root).checked) { mp.setTiles(e.target.checked); mp.setLabels($('#lyLabels', root).checked && !e.target.checked); } });
    $('#lyLabels', root).addEventListener('change', (e) => mp.setLabels(e.target.checked && !$('#lyTiles', root).checked));
    $('#lyStreets', root).addEventListener('change', (e) => mp.setBaseVisible(e.target.checked));
    $('#lyBuild', root).addEventListener('change', (e) => mp.setBuildings(e.target.checked));
    $('#lyPois', root).addEventListener('change', redraw);
    $$('.cat', root).forEach((c) => c.addEventListener('change', redraw));
    $('#lyMudo', root).addEventListener('change', (e) => {
      if (e.target.checked) { $('#lyTiles', root).checked = false; $('#lyLabels', root).checked = false; }
      build();
    });
    $('#zone', root).addEventListener('change', (e) => { zoneId = e.target.value; redraw(); if (zoneId) showZone(zoneId); });

    build();
    if (params.calle && M.street.has(params.calle)) select(params.calle);
    else if (zoneId) showZone(zoneId);
    return () => mp?.destroy();
  },
};
