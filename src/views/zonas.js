import { html, setHTML, $, progressBar } from '../ui/dom.js';
import { app } from '../app/store.js';
import { mastery, streetState } from '../app/analytics.js';
import { createMap } from '../ui/map.js';
import { CLS_LABEL } from '../engine/model.js';

const KIND = { tematica: 'Áreas de estudio', barrio: 'Barrios', pedania: 'Pedanías y núcleos', poligono: 'Polígonos industriales' };
const STATE = { nueva: 'Sin estudiar', estudiada: 'En estudio', dominada: 'Dominada' };

export default {
  title: 'Aprendizaje por zonas',
  render(root, params) {
    const M = app.model;
    if (params.z && M.zone.get(params.z)) return detail(root, M.zone.get(params.z));
    const groups = {};
    for (const z of M.zones) (groups[z.zkind] ||= []).push(z);
    setHTML(root, html`
      <p class="lead">Las zonas se obtienen de OpenStreetMap (barrios, pedanías y polígonos etiquetados) o se derivan de criterios geográficos explícitos. <b>No son delimitaciones oficiales</b>; el método de cada una se indica en su ficha.</p>
      ${Object.keys(KIND).filter((k) => groups[k]?.length).map((k) => html`
        <h3>${KIND[k]}</h3>
        <div class="grid cards3">${groups[k].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((z) => zoneCard(z))}</div>`)}
      ${!M.zones.some((z) => z.zkind !== 'tematica') ? html`<p class="muted">OpenStreetMap no contiene barrios, pedanías ni polígonos con nombre para este municipio. Puedes añadirlos en OSM y volver a importar.</p>` : ''}`);
  },
};

function zoneCard(z) {
  const m = mastery(z.id);
  return html`<div class="card zone">
    <div class="zone-h"><b>${z.name}</b><span class="pct">${m.pct} %</span></div>
    ${progressBar(m.mastered, m.total)}
    <small>${m.total} vías · ${m.studied} estudiadas · ${m.mastered} dominadas</small>
    <div class="row">
      <a class="btn small" href="#/zonas?z=${encodeURIComponent(z.id)}">Estudiar</a>
      <a class="btn small primary" href="#/entrenamiento?zona=${encodeURIComponent(z.id)}">Entrenar</a>
      <a class="btn small ghost" href="#/simulacro?zona=${encodeURIComponent(z.id)}">Simulacro</a>
    </div></div>`;
}

function detail(root, z) {
  const M = app.model;
  const streets = z.streets.map((id) => M.street.get(id)).filter((s) => s && (app.settings.includeRural || !s.rural)).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const m = mastery(z.id);
  const pois = M.pois.filter((p) => p.zones?.includes(z.id));
  setHTML(root, html`
    <p><a href="#/zonas">← Todas las zonas</a></p>
    <div class="card"><h2>${z.name}</h2><p class="small">${z.method}</p>
      <div class="row wrap"><span class="chip">${m.total} vías</span><span class="chip">${m.studied} estudiadas</span><span class="chip ok">${m.mastered} dominadas · ${m.pct} %</span>
        <a class="btn small primary" href="#/entrenamiento?zona=${encodeURIComponent(z.id)}">Entrenar esta zona</a>
        <a class="btn small" href="#/mudo?zona=${encodeURIComponent(z.id)}">Mapa mudo de la zona</a>
        <label class="sw"><input type="checkbox" id="hide"> Ocultar nombres (autoevaluación)</label>
      </div></div>
    <div class="grid cols2 study">
      <div class="map-wrap"><div id="zmap" class="map tall"></div></div>
      <div class="card scroll"><h3>Vías de la zona</h3>
        <ol class="study-list">${streets.map((s) => html`<li data-s="${s.id}" class="st-${streetState(s.id)}"><b class="nm">${s.label}</b><small>${CLS_LABEL[s.cls]} · ${s.length} m · ${M.inter.get(s.id).size} cruces · ${STATE[streetState(s.id)]}</small></li>`)}</ol>
        ${pois.length ? html`<h3>Edificios y servicios</h3><ul class="links">${pois.map((p) => html`<li>${p.name} <small>${p.cat}</small></li>`)}</ul>` : ''}
      </div>
    </div>`);
  const mp = createMap($('#zmap', root), { tiles: false, labels: true, fit: false, onStreetClick: (s) => s && focus(s.id) });
  mp.highlight(z.streets, { color: '#2563eb', weight: 5 });
  if (z.streets.length) mp.fit(z.streets, 17);
  mp.pois(pois);
  function focus(id) {
    mp.clear(); mp.highlight(z.streets, { color: '#2563eb', weight: 5 }); mp.pois(pois);
    mp.highlight([id], { color: '#f59e0b', weight: 9, label: !$('#hide', root).checked });
    root.querySelectorAll('.study-list li').forEach((li) => li.classList.toggle('sel', li.dataset.s === id));
    root.querySelector(`.study-list li[data-s="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  root.querySelector('.study-list').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) { focus(li.dataset.s); mp.fit([li.dataset.s], 17); } });
  $('#hide', root).addEventListener('change', (e) => { mp.setLabels(!e.target.checked); root.querySelector('.study-list').classList.toggle('hidden-names', e.target.checked); });
  return () => mp.destroy();
}
