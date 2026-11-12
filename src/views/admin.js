import { html, setHTML, $, $$, toast, confirmDialog, fmtDate, esc } from '../ui/dom.js';
import { app, saveOverrides, setDatasetOverride } from '../app/store.js';
import { createMap } from '../ui/map.js';
import { VER_LABEL, CLS_LABEL } from '../engine/model.js';
import { normName } from '../engine/geo.js';
import { createGenerator, TYPES } from '../engine/questions.js';
import { checkQuestion } from '../engine/verify.js';

const ST_STATUSES = ['importado', 'verificado', 'corregido', 'dudoso', 'excluido'];
const PAIR_STATUSES = ['importado', 'confirmado', 'erroneo'];
const today = () => new Date().toISOString().slice(0, 10);

function download(name, data) {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default {
  title: 'Administración de datos',
  render(root, params) {
    let mp = null, refreshList = () => {};
    const tab = params.tab || 'calles';
    const M = () => app.model;
    const issues = () => M().meta.issues || [];
    const issueIds = () => new Set(issues().flatMap((i) => String(i.id).split(',')));
    setHTML(root, html`
      <nav class="tabs">${[['calles', 'Calles'], ['edificios', 'Edificios'], ['avisos', `Avisos (${issues().length})`], ['datos', 'Importación y exportación']].map(([k, l]) => html`<a href="#/admin?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</nav>
      <div id="tab"></div>`);
    const T = $('#tab', root);

    // ---------------- Calles ----------------
    function calles() {
      setHTML(T, html`
        <div class="grid cols2 admin">
          <div class="card">
            <div class="row wrap">
              <input type="search" id="fq" placeholder="Buscar…" value="${params.q || ''}">
              <select id="fs"><option value="">Todos los estados</option>${ST_STATUSES.map((s) => html`<option value="${s}">${VER_LABEL[s]}</option>`)}<option value="local">Con corrección local</option><option value="aviso">Con avisos</option></select>
            </div>
            <p class="small muted" id="fcount"></p>
            <ul class="admin-list" id="list"></ul>
          </div>
          <div class="card" id="edit"><p class="muted">Selecciona una vía para revisarla.</p></div>
        </div>`);
      const draw = () => {
        const q = normName($('#fq', T).value), st = $('#fs', T).value, iss = issueIds();
        const list = M().streets.filter((s) => (!q || normName(s.label).includes(q)) && (!st || (st === 'local' ? s.ver.local : st === 'aviso' ? iss.has(s.id) : s.ver.status === st)));
        $('#fcount', T).textContent = `${list.length} vías`;
        $('#list', T).innerHTML = list.slice(0, 300).map((s) => `<li data-id="${s.id}"><span>${esc(s.label)}</span><b class="ver ${s.ver.status}">${esc(VER_LABEL[s.ver.status])}</b></li>`).join('') + (list.length > 300 ? '<li class="muted">… afina la búsqueda para ver más</li>' : '');
      };
      refreshList = draw;
      $('#fq', T).addEventListener('input', draw); $('#fs', T).addEventListener('change', draw);
      $('#list', T).addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) editStreet(li.dataset.id); });
      draw();
      if (params.id && M().street.has(params.id)) editStreet(params.id);
    }
    function editStreet(id) {
      const s = M().street.get(id), o = app.overrides.streets?.[id] || {};
      const inter = [...M().pair.values()].filter((p) => p.a === id || p.b === id);
      const iss = issues().filter((i) => String(i.id).split(',').includes(id));
      mp?.destroy();
      setHTML($('#edit', T), html`
        <h3>${s.label}</h3>
        <p class="small">${CLS_LABEL[s.cls]} · ${s.length} m · OSM: ${s.osm.map((w) => html`<a href="https://www.openstreetmap.org/${w}" target="_blank" rel="noopener">${w}</a> `)}</p>
        ${iss.map((i) => html`<p class="warnbox small">${i.msg}</p>`)}
        <div id="amap" class="map small"></div>
        <form id="sf" class="form">
          <label>Nombre en OSM <input value="${s.osmName}" disabled></label>
          <label>Nombre corregido (solo si es incorrecto) <input name="name" value="${o.name || ''}" placeholder="Dejar vacío si es correcto"></label>
          <label>Estado <select name="status">${ST_STATUSES.map((x) => html`<option value="${x}" ${s.ver.status === x ? 'selected' : ''}>${VER_LABEL[x]}</option>`)}</select></label>
          <label>Fuente de la verificación <input name="source" value="${o.source || (s.ver.status !== 'importado' ? s.ver.source : '')}" placeholder="p. ej. Callejero municipal del Ayuntamiento de ${app.muniInfo?.name || ''}, 2026"></label>
          <label>Fecha <input type="date" name="date" value="${o.date || today()}"></label>
          <label>Observaciones <textarea name="notes" rows="2">${o.notes || s.ver.notes || ''}</textarea></label>
          <div class="row"><button class="btn primary" type="submit">Guardar</button>${o.status ? html`<button class="btn ghost" id="undo" type="button">Quitar corrección local</button>` : ''}</div>
        </form>
        <h4>Cruces (${inter.length})</h4>
        <table class="tbl small"><thead><tr><th>Con</th><th>Ángulo</th><th>Estado</th></tr></thead><tbody>
          ${inter.map((p) => { const other = M().street.get(p.a === id ? p.b : p.a); return html`<tr><td><a href="#" data-pt="${p.id}">${other.label}</a></td><td>${p.angle ?? '—'}°</td><td><select data-pair="${p.id}">${PAIR_STATUSES.map((x) => html`<option value="${x}" ${p.ver.status === x ? 'selected' : ''}>${VER_LABEL[x]}</option>`)}</select></td></tr>`; })}
        </tbody></table>`);
      mp = createMap($('#amap', T), { tiles: true, fit: false });
      mp.highlight([id], { color: '#f59e0b', label: true }); mp.fit([id], 18);
      for (const p of inter) mp.point(p.c, { color: '#1d4ed8', radius: 5 });
      $('#sf', T).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (f.status === 'corregido' && !f.name.trim()) return toast('Indica el nombre corregido.', 'warn');
        if (f.status !== 'importado' && !f.source.trim()) return toast('Indica la fuente con la que has verificado el dato.', 'warn');
        const ov = structuredClone(app.overrides); ov.streets ||= {};
        ov.streets[id] = { status: f.status, name: f.status === 'corregido' ? f.name.trim() : undefined, source: f.source.trim(), date: f.date, notes: f.notes.trim(), nameAtCheck: s.osmName };
        await saveOverrides(ov); toast('Guardado.', 'ok'); refreshList(); editStreet(id);
      });
      $('#undo', T)?.addEventListener('click', async () => { const ov = structuredClone(app.overrides); delete ov.streets[id]; await saveOverrides(ov); refreshList(); editStreet(id); });
      $$('select[data-pair]', T).forEach((sel) => sel.addEventListener('change', async () => {
        const ov = structuredClone(app.overrides); ov.pairs ||= {};
        if (sel.value === 'importado') delete ov.pairs[sel.dataset.pair];
        else ov.pairs[sel.dataset.pair] = { status: sel.value, source: 'Revisión manual', date: today(), notes: '' };
        await saveOverrides(ov); toast(sel.value === 'erroneo' ? 'Cruce marcado como erróneo: no se usará en preguntas.' : 'Cruce actualizado.', 'ok');
      }));
      $$('a[data-pt]', T).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const p = M().pair.get(a.dataset.pt); mp.clear(); mp.highlight([p.a, p.b], { color: '#f59e0b', label: true }); mp.point(p.c); mp.around(p.c, 120); }));
    }

    // ---------------- Edificios ----------------
    function edificios() {
      setHTML(T, html`<div class="grid cols2 admin"><div class="card"><input type="search" id="fq" placeholder="Buscar…"><ul class="admin-list" id="list"></ul></div><div class="card" id="edit"><p class="muted">Selecciona un edificio.</p></div></div>`);
      const draw = () => {
        const q = normName($('#fq', T).value);
        $('#list', T).innerHTML = M().pois.filter((p) => !q || normName(p.name).includes(q)).map((p) => `<li data-id="${p.id}"><span>${esc(p.name)} <small>${esc(p.cat)}</small></span><b class="ver ${p.ver.status}">${esc(VER_LABEL[p.ver.status])}</b></li>`).join('');
      };
      refreshList = draw;
      $('#fq', T).addEventListener('input', draw);
      $('#list', T).addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) editPoi(li.dataset.id); });
      draw();
    }
    function editPoi(id) {
      const p = M().poi.get(id), o = app.overrides.pois?.[id] || {};
      const cands = [...new Set([p.street, ...(p.nearest || []).map((n) => n[0])].filter(Boolean))].map((x) => M().street.get(x)).filter(Boolean);
      mp?.destroy();
      setHTML($('#edit', T), html`
        <h3>${p.name}</h3><p class="small">${p.cat} · Dirección OSM: ${p.addr || '—'} · <a href="https://www.openstreetmap.org/${p.osm}" target="_blank" rel="noopener">${p.osm}</a></p>
        ${p.dup ? html`<p class="warnbox small">Hay otro elemento con el mismo nombre: no se usa en preguntas para evitar ambigüedad.</p>` : ''}
        <div id="amap" class="map small"></div>
        <form id="pf" class="form">
          <label>Nombre corregido <input name="name" value="${o.name || ''}" placeholder="Dejar vacío si es correcto"></label>
          <label>Vía en la que se encuentra <select name="street"><option value="">${p.street ? 'Mantener: ' + M().street.get(p.street).label : 'Sin asignar'}</option>${cands.map((s) => html`<option value="${s.id}" ${o.street === s.id ? 'selected' : ''}>${s.label}</option>`)}</select></label>
          <label>Estado <select name="status">${ST_STATUSES.map((x) => html`<option value="${x}" ${p.ver.status === x ? 'selected' : ''}>${VER_LABEL[x]}</option>`)}</select></label>
          <label>Fuente <input name="source" value="${o.source || ''}" placeholder="p. ej. web municipal, visita"></label>
          <label>Fecha <input type="date" name="date" value="${o.date || today()}"></label>
          <label>Observaciones <textarea name="notes" rows="2">${o.notes || ''}</textarea></label>
          <button class="btn primary" type="submit">Guardar</button>
        </form>`);
      mp = createMap($('#amap', T), { tiles: true, fit: false });
      mp.point(p.c, { label: p.name }); if (p.street) mp.highlight([p.street], { color: '#f59e0b', label: true }); mp.around(p.c, 150);
      $('#pf', T).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (f.status !== 'importado' && !f.source.trim()) return toast('Indica la fuente de la verificación.', 'warn');
        const ov = structuredClone(app.overrides); ov.pois ||= {};
        ov.pois[id] = { status: f.status, name: f.status === 'corregido' && f.name.trim() ? f.name.trim() : undefined, street: f.street || undefined, source: f.source.trim(), date: f.date, notes: f.notes.trim() };
        await saveOverrides(ov); toast('Guardado.', 'ok'); refreshList(); editPoi(id);
      });
    }

    // ---------------- Avisos ----------------
    function avisos() {
      const by = {};
      for (const i of issues()) (by[i.type] ||= []).push(i);
      setHTML(T, html`<div class="card"><p class="small">Avisos generados automáticamente durante la importación. Revísalos con el callejero oficial y corrige en OSM o aquí.</p>
        ${Object.entries(by).map(([k, list]) => html`<details><summary><b>${k}</b> (${list.length})</summary><ul class="small">${list.map((i) => html`<li>${i.msg} ${String(i.id).startsWith('w') ? html`<a href="#/admin?tab=calles&id=${String(i.id).split(',')[0]}">Revisar</a>` : ''}</li>`)}</ul></details>`)}
        ${!issues().length ? html`<p class="muted">Sin avisos.</p>` : ''}</div>`);
    }

    // ---------------- Datos ----------------
    function datos() {
      const meta = M().meta;
      const nLocal = Object.keys(app.overrides.streets || {}).length + Object.keys(app.overrides.pois || {}).length + Object.keys(app.overrides.pairs || {}).length;
      setHTML(T, html`
        <div class="grid cols2">
          <div class="card"><h3>Conjunto de datos en uso</h3>
            <ul class="kv small">
              <li><span>Municipio</span><b>${app.muniInfo?.name || app.muni}</b></li>
              <li><span>Origen</span><b>${app.datasetSource}</b></li>
              <li><span>Fuente</span><b>${meta.source} (${meta.license})</b></li>
              <li><span>Importado</span><b>${fmtDate(meta.importedAt, true)}</b></li>
              <li><span>Datos OSM a fecha de</span><b>${fmtDate(meta.osmBase, true)}</b></li>
              <li><span>Vías / cruces / edificios / zonas</span><b>${meta.counts?.streets} / ${meta.counts?.pairs} / ${meta.counts?.pois} / ${meta.counts?.zones}</b></li>
              <li><span>Correcciones locales</span><b>${nLocal}</b></li>
            </ul>
            <h4>Probar una nueva versión</h4>
            <p class="small">Carga un <code>callejero-${app.muni}.geojson</code> generado con <code>npm run data:import</code> para revisarlo en este dispositivo antes de publicarlo.</p>
            <input type="file" id="dsFile" accept=".geojson,.json,application/json">
            ${app.datasetSource !== 'publicado' ? html`<button class="btn ghost" id="dsRevert" type="button">Volver al conjunto publicado</button>` : ''}
          </div>
          <div class="card"><h3>Exportar verificaciones</h3>
            <p class="small">Genera <code>verificaciones-${app.muni}.json</code> con todas las verificaciones de ${app.muniInfo?.name || ''} (las ya publicadas y las nuevas). Súbelo a la carpeta <code>data</code> del repositorio (sustituyendo al anterior): al publicarse, las correcciones se aplican al callejero para todos.</p>
            <button class="btn primary" id="exp" type="button">Descargar verificaciones-${app.muni}.json</button>
            <h3>Comprobar el generador</h3>
            <p class="small">Genera 300 preguntas y las verifica de forma independiente con los datos actuales.</p>
            <button class="btn" id="selftest" type="button">Ejecutar comprobación</button>
            <div id="stres"></div>
          </div>
        </div>`);
      $('#dsFile', T).addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const ds = JSON.parse(await f.text());
          if (ds.type !== 'FeatureCollection' || !ds.metadata?.schema) throw new Error('No es un callejero generado por esta aplicación.');
          const c = ds.metadata.counts;
          if (await confirmDialog('Cargar conjunto de datos', `Nuevo: ${c.streets} vías, ${c.pairs} cruces, ${c.pois} edificios (importado ${fmtDate(ds.metadata.importedAt)}). Actual: ${meta.counts.streets} vías. Solo afecta a este dispositivo.`, 'Cargar')) { await setDatasetOverride(ds); toast('Conjunto cargado.', 'ok'); datos(); }
        } catch (err) { toast('Archivo no válido: ' + err.message, 'error', 6000); }
      });
      $('#dsRevert', T)?.addEventListener('click', async () => { await setDatasetOverride(null); toast('Se usa de nuevo el conjunto publicado.', 'ok'); datos(); });
      $('#exp', T).addEventListener('click', () => download(`verificaciones-${app.muni}.json`, exportVerifications()));
      $('#selftest', T).addEventListener('click', () => {
        const res = $('#stres', T); res.textContent = 'Comprobando…';
        setTimeout(() => {
          let n = 0; const bad = []; const per = {};
          for (let seed = 1; seed <= 10; seed++) {
            const gen = createGenerator(M(), { seed, settings: { includeRural: app.settings.includeRural } });
            for (const t of TYPES) for (const d of [1, 2, 3]) { const q = gen.generate(t.key, { diff: d }); if (!q) continue; n++; per[t.key] = (per[t.key] || 0) + 1; const e = checkQuestion(M(), q); if (e.length) bad.push(q.id + ': ' + e.join('; ')); }
          }
          setHTML(res, html`<p><b>${n}</b> preguntas generadas, <b>${bad.length}</b> con errores.</p><ul class="small">${TYPES.map((t) => html`<li>${t.name}: ${per[t.key] || 0}${per[t.key] ? '' : ' (sin datos suficientes)'}</li>`)}</ul>${bad.length ? html`<pre class="small">${bad.slice(0, 20).join('\n')}</pre>` : ''}`);
        }, 30);
      });
    }

    function exportVerifications() {
      const out = { _info: `Verificaciones de ${app.muniInfo?.name || app.muni}. Generado desde Administración el ` + new Date().toLocaleString('es-ES'), streets: {}, pois: {}, pairs: {} };
      for (const s of M().streets) if (s.ver.status !== 'importado') out.streets[s.id] = clean({ status: s.ver.status, name: s.ver.status === 'corregido' ? s.name : undefined, source: s.ver.source, date: s.ver.date, notes: s.ver.notes, nameAtCheck: s.osmName });
      for (const p of M().pois) if (p.ver.status !== 'importado' || app.overrides.pois?.[p.id]?.street) out.pois[p.id] = clean({ status: p.ver.status, name: app.overrides.pois?.[p.id]?.name, street: app.overrides.pois?.[p.id]?.street, source: p.ver.source, date: p.ver.date, notes: p.ver.notes });
      for (const p of M().pair.values()) if (p.ver.status !== 'importado') out.pairs[p.id] = clean({ status: p.ver.status, source: p.ver.source, date: p.ver.date, notes: p.ver.notes });
      for (const [id, v] of Object.entries(app.overrides.pairs || {})) if (v.status === 'erroneo') out.pairs[id] = clean(v);
      return out;
    }
    const clean = (o) => JSON.parse(JSON.stringify(o));

    ({ calles, edificios, avisos, datos })[tab]?.();
    return () => mp?.destroy();
  },
};
