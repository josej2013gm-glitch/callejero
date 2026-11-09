import { html, setHTML, $, toast } from '../ui/dom.js';
import { app, saveMudo } from '../app/store.js';
import { createGenerator } from '../engine/questions.js';
import { runPractice } from '../ui/practice.js';

// Niveles de dificultad progresiva del mapa mudo
export const LEVELS = [
  { n: 1, name: 'Vías principales', desc: 'Identifica la vía resaltada entre cuatro nombres (vías largas e importantes).', plan: [['identificar', 1]] },
  { n: 2, name: 'Localizar', desc: 'Toca en el mapa la vía que se pide e identifica vías de importancia media.', plan: [['localizar', 1, true], ['identificar', 2]] },
  { n: 3, name: 'Cruces', desc: 'Reconoce qué dos vías se cruzan en el punto señalado y distingue entre vías marcadas.', plan: [['crucePunto', 2], ['identificar', 2], ['localizar', 2]] },
  { n: 4, name: 'Calles secundarias', desc: 'Calles cortas, distractores cercanos y localización sin pistas.', plan: [['localizar', 3, true], ['identificar', 3], ['crucePunto', 2]] },
  { n: 5, name: 'Experto', desc: 'Cruces y calles difíciles, y orientación a partir de edificios de referencia.', plan: [['crucePunto', 3], ['localizar', 3, true], ['identificar', 3], ['edif_mapaPoi', 2]] },
];
const WINDOW = 10, PASS = 8;

export default {
  title: 'Mapa mudo',
  render(root, params) {
    let runner = null;
    const mudo = app.progress.mudo || { level: 1, recent: [] };
    function config() {
      runner?.destroy(); runner = null;
      const cur = mudo.level || 1;
      const ok = (mudo.recent || []).filter(Boolean).length;
      setHTML(root, html`
        <p class="lead">Mapa sin nombres ni mapa base: solo la forma de las calles y los contornos de edificios. Supera ${PASS} de las últimas ${WINDOW} respuestas para desbloquear el siguiente nivel.</p>
        ${params.zona && app.model.zone.get(params.zona) ? html`<div class="card note">Zona: <b>${app.model.zone.get(params.zona).name}</b> · <a href="#/mudo">Todo el municipio</a></div>` : ''}
        <div class="levels">${LEVELS.map((l) => html`
          <div class="card level ${l.n === cur ? 'current' : ''} ${l.n > cur ? 'locked' : ''}">
            <div class="lv-n">${l.n}</div>
            <div><b>${l.name}</b><p class="small">${l.desc}</p>
              ${l.n === cur ? html`<small>Progreso: ${ok} / ${PASS} aciertos en las últimas ${(mudo.recent || []).length} respuestas</small>` : ''}</div>
            <button class="btn ${l.n === cur ? 'primary' : ''}" data-l="${l.n}" ${l.n > cur ? 'disabled' : ''} type="button">${l.n > cur ? '🔒' : 'Practicar'}</button>
          </div>`)}</div>`);
      root.querySelectorAll('button[data-l]').forEach((b) => b.addEventListener('click', () => start(Number(b.dataset.l))));
    }
    function start(level) {
      const gen = createGenerator(app.model, { settings: { includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified, zoneId: params.zona || null } });
      const L = LEVELS[level - 1];
      runner = runPractice(root, {
        mode: 'mudo', total: 10, cfg: { level, zona: params.zona || null }, title: `Mapa mudo · nivel ${level}: ${L.name}`,
        next: (i, hist) => {
          const seen = new Set(hist.map((h) => h.q.id));
          for (let k = 0; k < 12; k++) {
            const [type, diff, tap] = L.plan[(i + k) % L.plan.length];
            const q = gen.generate(type, { diff, tap });
            if (q && !seen.has(q.id)) return q;
          }
          return null;
        },
        onAnswer: (q, r) => {
          if (level !== mudo.level) return;
          mudo.recent = [...(mudo.recent || []), r.ok].slice(-WINDOW);
          if (mudo.recent.length >= WINDOW && mudo.recent.filter(Boolean).length >= PASS && mudo.level < LEVELS.length) {
            mudo.level++; mudo.recent = [];
            toast(`¡Nivel ${mudo.level} desbloqueado: ${LEVELS[mudo.level - 1].name}!`, 'ok', 5000);
          }
          saveMudo(mudo);
        },
        onFinish: (s, again) => (again ? start(Math.min(level, mudo.level)) : config()),
      });
    }
    config();
    return () => runner?.destroy();
  },
};
