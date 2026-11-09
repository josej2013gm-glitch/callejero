import { html, setHTML, $, $$, toast } from '../ui/dom.js';
import { app, saveSettings } from '../app/store.js';
import { createGenerator, TYPES } from '../engine/questions.js';
import { runPractice } from '../ui/practice.js';

const ALL = TYPES.map((t) => t.key);

export default {
  title: 'Entrenamiento geográfico',
  render(root, params) {
    let runner = null;
    const M = app.model;
    const zones = M.zones.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const focusStreet = params.calle && M.street.get(params.calle);
    // Selección inicial: la modalidad del enlace, la última usada o todas
    const initial = params.tipo && ALL.includes(params.tipo) ? [params.tipo]
      : (app.settings.trainTypes || []).filter((k) => ALL.includes(k)).length ? app.settings.trainTypes.filter((k) => ALL.includes(k)) : ALL;

    function config() {
      runner?.destroy(); runner = null;
      const sel = new Set(initial);
      setHTML(root, html`
        ${focusStreet ? html`<div class="card note">Práctica centrada en <b>${focusStreet.label}</b>. <a href="#/entrenamiento">Quitar</a></div>` : ''}
        <form class="card form" id="cfg">
          <fieldset><legend>Modalidades</legend>
            <p class="small muted">Marca «Mixto» para practicar todas, o elige una o varias.</p>
            <div class="modes">
              <label class="mode all"><input type="checkbox" id="all" ${sel.size === ALL.length ? 'checked' : ''}><b>Mixto (todas)</b><small>Todas las modalidades alternadas</small></label>
              ${TYPES.map((t) => html`<label class="mode"><input type="checkbox" name="tipo" value="${t.key}" ${sel.has(t.key) ? 'checked' : ''}><b>${t.name}</b><small>${t.desc}</small></label>`)}
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
      const boxes = $$('input[name=tipo]', root), all = $('#all', root);
      all.addEventListener('change', () => boxes.forEach((b) => { b.checked = all.checked; }));
      boxes.forEach((b) => b.addEventListener('change', () => { all.checked = boxes.every((x) => x.checked); }));
      $('#cfg', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const tipos = f.getAll('tipo');
        if (!tipos.length) { toast('Marca al menos una modalidad.', 'warn'); return; }
        const n = Number(f.get('n'));
        saveSettings({ trainTypes: tipos, ...(n ? { practiceSize: n } : {}) });
        initial.splice(0, initial.length, ...tipos);
        start({ tipos, diff: Number(f.get('diff')), zona: focusStreet ? '' : f.get('zona'), n: n || 200, tap: !!f.get('tap') });
      });
    }

    function start(c) {
      const gen = createGenerator(M, { settings: { includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified, zoneId: c.zona || null } });
      let streak = 0, level = c.diff || 1;
      const names = c.tipos.map((k) => TYPES.find((t) => t.key === k).name);
      const title = (c.tipos.length === ALL.length ? 'Mixto' : c.tipos.length <= 2 ? names.join(' + ') : `${c.tipos.length} modalidades`) + (c.zona ? ' · ' + M.zone.get(c.zona).name : '');
      runner = runPractice(root, {
        mode: 'entrenamiento', total: c.n, cfg: { tipos: c.tipos, diff: c.diff, zona: c.zona || null, calle: focusStreet?.id || null },
        title,
        next: (i, hist) => {
          const seen = new Set(hist.map((h) => h.q.id));
          const diff = c.diff || level;
          for (let k = 0; k < 20; k++) {
            const type = c.tipos[Math.floor(gen.rng() * c.tipos.length)];
            const q = focusStreet ? gen.forConcept('st:' + focusStreet.id, diff) : gen.generate(type, { diff, tap: c.tap && type === 'localizar' && gen.rng() < 0.6 });
            if (q && !seen.has(q.id) && (focusStreet ? c.tipos.includes(q.cat) || k > 12 : true)) return q;
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
