import { html, setHTML, $ } from '../ui/dom.js';
import { app, saveSettings } from '../app/store.js';
import { createGenerator, TYPES } from '../engine/questions.js';
import { runPractice } from '../ui/practice.js';

export default {
  title: 'Entrenamiento geográfico',
  render(root, params) {
    let runner = null;
    const M = app.model;
    const zones = M.zones.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const focusStreet = params.calle && M.street.get(params.calle);
    function config() {
      runner?.destroy(); runner = null;
      setHTML(root, html`
        ${focusStreet ? html`<div class="card note">Práctica centrada en <b>${focusStreet.label}</b>. <a href="#/entrenamiento">Quitar</a></div>` : ''}
        <form class="card form" id="cfg">
          <fieldset><legend>Modalidad</legend>
            <div class="modes">
              <label class="mode"><input type="radio" name="tipo" value="mixto" ${!params.tipo ? 'checked' : ''}><b>Mixto</b><small>Todas las modalidades alternadas</small></label>
              ${TYPES.map((t) => html`<label class="mode"><input type="radio" name="tipo" value="${t.key}" ${params.tipo === t.key ? 'checked' : ''}><b>${t.name}</b><small>${t.desc}</small></label>`)}
            </div>
          </fieldset>
          <div class="row wrap">
            <label>Dificultad <select name="diff"><option value="1">Fácil · vías principales</option><option value="2" selected>Media</option><option value="3">Difícil · calles cortas y distractores cercanos</option><option value="0">Progresiva</option></select></label>
            <label>Zona <select name="zona" ${focusStreet ? 'disabled' : ''}><option value="">Todo el municipio</option>${zones.map((z) => html`<option value="${z.id}" ${params.zona === z.id ? 'selected' : ''}>${z.name}</option>`)}</select></label>
            <label>Preguntas <select name="n">${[5, 10, 20, 30].map((n) => html`<option ${app.settings.practiceSize === n ? 'selected' : ''}>${n}</option>`)}<option value="0">Sin límite</option></select></label>
            <label class="sw"><input type="checkbox" name="tap" checked> Localizar tocando el mapa</label>
          </div>
          <button class="btn primary big" type="submit">Empezar</button>
        </form>`);
      $('#cfg', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const n = Number(f.get('n'));
        if (n) saveSettings({ practiceSize: n });
        start({ tipo: f.get('tipo'), diff: Number(f.get('diff')), zona: focusStreet ? '' : f.get('zona'), n: n || 200, tap: !!f.get('tap') });
      });
    }
    function start(c) {
      const gen = createGenerator(M, { settings: { includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified, zoneId: c.zona || null } });
      const keys = TYPES.map((t) => t.key);
      let streak = 0, level = c.diff || 1;
      runner = runPractice(root, {
        mode: 'entrenamiento', total: c.n, cfg: { tipo: c.tipo, diff: c.diff, zona: c.zona || null, calle: focusStreet?.id || null },
        title: (c.tipo === 'mixto' ? 'Mixto' : TYPES.find((t) => t.key === c.tipo).name) + (c.zona ? ' · ' + M.zone.get(c.zona).name : ''),
        next: (i, hist) => {
          const seen = new Set(hist.map((h) => h.q.id));
          const diff = c.diff || level;
          for (let k = 0; k < 15; k++) {
            const type = c.tipo === 'mixto' ? keys[Math.floor(gen.rng() * keys.length)] : c.tipo;
            const q = focusStreet ? gen.forConcept('st:' + focusStreet.id, diff) : gen.generate(type, { diff, tap: c.tap && type === 'localizar' && gen.rng() < 0.6 });
            if (q && !seen.has(q.id)) return q;
          }
          return null;
        },
        onAnswer: (q, r) => { if (!c.diff) { streak = r.ok ? streak + 1 : 0; if (streak >= 4 && level < 3) { level++; streak = 0; } } },
        onFinish: (s, again) => (again ? start(c) : config()),
      });
    }
    config();
    return () => runner?.destroy();
  },
};
