import { html, setHTML, fmtDate, progressBar } from '../ui/dom.js';
import { app } from '../app/store.js';
import { mastery, dueList, globalStats, recommendation } from '../app/analytics.js';
import { fmtNota } from '../engine/scoring.js';
import { TRUSTED } from '../engine/model.js';

const MODE = { oficial: 'Simulacro oficial', simulacro: 'Simulacro de entrenamiento', entrenamiento: 'Entrenamiento', mudo: 'Mapa mudo', repaso: 'Repaso' };

export default {
  title: 'Inicio',
  render(root) {
    const m = mastery(), g = globalStats(), due = dueList(), rec = recommendation();
    const last = app.sessions.slice(-5).reverse();
    const M = app.model;
    const verified = M.streets.filter((s) => TRUSTED.has(s.ver.status)).length;
    setHTML(root, html`
      <section class="grid cards4">
        <div class="card stat"><span class="k">Dominio del callejero</span><b>${m.pct} %</b>${progressBar(m.mastered, m.total)}<small>${m.mastered} de ${m.total} vías dominadas</small></div>
        <div class="card stat"><span class="k">Calles estudiadas</span><b>${m.studied}</b><small>de ${m.total} vías del ámbito de estudio</small></div>
        <div class="card stat"><span class="k">Mejor simulacro oficial</span><b>${g.best != null ? fmtNota(g.best) : '—'}</b><small>${g.officialCount ? `media ${fmtNota(g.avg)} en ${g.officialCount} simulacro${g.officialCount > 1 ? 's' : ''}` : 'sobre 2,00 puntos'}</small></div>
        <div class="card stat ${due.length ? 'alert' : ''}"><span class="k">Pendientes de repaso</span><b>${due.length}</b><small><a href="#/repaso">Ir al repaso →</a></small></div>
      </section>

      <section class="card reco">
        <div><span class="k">Recomendación de entrenamiento</span><p>${rec.text}</p></div>
        <a class="btn primary" href="${rec.href}">Empezar</a>
      </section>

      <section class="grid cards3 quick">
        <a class="card action" href="#/mapa"><span class="ico">🗺️</span><b>Mapa interactivo</b><small>Explora calles, cruces y edificios</small></a>
        <a class="card action" href="#/simulacro?oficial=1"><span class="ico">📝</span><b>Simulacro oficial</b><small>20 preguntas · +0,10 / −0,03</small></a>
        <a class="card action" href="#/mudo"><span class="ico">🧭</span><b>Mapa mudo</b><small>Nivel ${app.progress.mudo?.level || 1} de 5</small></a>
      </section>

      <section class="grid cols2">
        <div class="card">
          <h3>Últimos resultados</h3>
          ${last.length ? html`<table class="tbl"><thead><tr><th>Fecha</th><th>Modalidad</th><th>Aciertos</th><th>Nota</th></tr></thead><tbody>
            ${last.map((s) => html`<tr><td>${fmtDate(s.endedAt, true)}</td><td>${MODE[s.mode] || s.mode}</td><td>${s.score ? `${s.score.correct}/${s.score.n}` : `${(s.answers || []).filter((a) => a.ok).length}/${(s.answers || []).length}`}</td><td>${s.score ? fmtNota(s.score.nota) + ' / ' + fmtNota(s.score.max) : '—'}</td></tr>`)}
          </tbody></table>` : html`<p class="muted">Todavía no hay resultados. Haz tu primer entrenamiento.</p>`}
          <a href="#/estadisticas" class="more">Ver estadísticas →</a>
        </div>
        <div class="card">
          <h3>Datos del callejero</h3>
          <ul class="kv">
            <li><span>Vías</span><b>${M.streets.length}</b></li>
            <li><span>Cruces</span><b>${M.pair.size}</b></li>
            <li><span>Edificios y servicios</span><b>${M.pois.length}</b></li>
            <li><span>Vías verificadas</span><b>${verified} (${M.streets.length ? Math.round((verified / M.streets.length) * 100) : 0} %)</b></li>
            <li><span>Importado de OSM</span><b>${fmtDate(M.meta.importedAt)}</b></li>
            <li><span>Origen</span><b>${app.datasetSource}</b></li>
          </ul>
          <p class="muted small">Los datos proceden de OpenStreetMap y deben contrastarse con el callejero oficial del Ayuntamiento. Gestiona la verificación en <a href="#/admin">Administración</a>.</p>
        </div>
      </section>`);
  },
};
