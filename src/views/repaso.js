import { html, setHTML, $, fmtDate } from '../ui/dom.js';
import { app } from '../app/store.js';
import { dueList, conceptLabel, conceptKind, frequentErrors } from '../app/analytics.js';
import { createGenerator } from '../engine/questions.js';
import { checkQuestion } from '../engine/verify.js';
import { runPractice } from '../ui/practice.js';

export default {
  title: 'Repaso inteligente',
  render(root) {
    let runner = null;
    const M = app.model;
    const genFor = () => createGenerator(M, { settings: { includeRural: true, onlyVerified: false } });

    /** Preguntas falladas recientes que siguen siendo válidas con los datos actuales. */
    function failedQuestions() {
      const out = [], ids = new Set();
      for (const s of app.sessions.slice().reverse()) for (const q of s.wrongQs || []) {
        if (ids.has(q.id)) continue;
        const exists = (q.refs?.streets || []).every((id) => M.street.has(id)) && (q.refs?.pois || []).every((id) => M.poi.has(id)) && (q.refs?.pairs || []).every((id) => M.pair.has(id));
        if (!exists || checkQuestion(M, q).length) continue; // los datos han cambiado: se descarta
        const it = (q.concepts || []).map((k) => app.progress.items[k]).find(Boolean);
        if (it && it.lastOk && it.b >= 2) continue; // ya se ha corregido
        ids.add(q.id); out.push(q);
      }
      return out;
    }

    function config() {
      runner?.destroy(); runner = null;
      const due = dueList();
      const failed = failedQuestions();
      const errs = frequentErrors(12);
      const iv = app.settings.intervals;
      setHTML(root, html`
        <div class="grid cards3">
          <div class="card action"><span class="ico">⏰</span><b>${due.length} conceptos pendientes</b><small>Calles, cruces y relaciones cuyo repaso ha vencido o que fallaste.</small>
            <button class="btn primary" id="rDue" type="button" ${due.length ? '' : 'disabled'}>Repasar pendientes</button></div>
          <div class="card action"><span class="ico">↺</span><b>${failed.length} preguntas falladas</b><small>Repite exactamente las preguntas que fallaste (se descartan las ya superadas).</small>
            <button class="btn" id="rFail" type="button" ${failed.length ? '' : 'disabled'}>Repetir falladas</button></div>
          <div class="card action"><span class="ico">✚</span><b>Preguntas nuevas sobre tus errores</b><small>Otras preguntas sobre las mismas calles, cruces y edificios.</small>
            <button class="btn" id="rNew" type="button" ${errs.length ? '' : 'disabled'}>Generar</button></div>
        </div>
        <div class="card">
          <h3>Prioridad de repaso</h3>
          ${due.length ? html`<table class="tbl"><thead><tr><th>Concepto</th><th>Tipo</th><th>Motivo</th><th>Aciertos</th><th>Próximo repaso</th></tr></thead><tbody>
            ${due.slice(0, 25).map(({ it, why }) => html`<tr><td>${conceptLabel(it.k)}</td><td>${conceptKind(it.k)}</td><td>${why}</td><td>${it.ok}/${it.n}</td><td>${fmtDate(it.due, true)}</td></tr>`)}
          </tbody></table>` : html`<p class="muted">Nada pendiente ahora mismo. Los conceptos acertados se vuelven a preguntar a los ${iv.slice(1).join(', ')} días, según la caja en la que estén.</p>`}
          <p class="small muted">Intervalos actuales: ${iv.join(' · ')} días. Una respuesta correcta pero lenta (más de ${Math.round(app.settings.slowMs / 1000)} s) no avanza de caja. Puedes cambiarlo en <a href="#/ajustes">Ajustes</a>.</p>
        </div>`);
      $('#rDue', root)?.addEventListener('click', () => {
        const gen = genFor(); const list = due.slice(0, 20).map((d) => d.it.k);
        start('Repaso de pendientes', (i, hist) => { const seen = new Set(hist.map((h) => h.q.id)); for (let k = i; k < list.length + i; k++) { const q = gen.forConcept(list[k % list.length]); if (q && !seen.has(q.id)) { list.splice(k % list.length, 1); return q; } } return null; }, Math.min(15, list.length));
      });
      $('#rFail', root)?.addEventListener('click', () => { const qs = failed.slice(0, 20); start('Repetición de falladas', (i) => qs[i] || null, qs.length); });
      $('#rNew', root)?.addEventListener('click', () => {
        const gen = genFor(); const ks = errs.map((e) => e.k);
        start('Nuevas preguntas sobre errores', (i, hist) => { const seen = new Set([...hist.map((h) => h.q.id), ...failed.map((q) => q.id)]); for (let k = 0; k < ks.length * 2; k++) { const q = gen.forConcept(ks[(i + k) % ks.length]); if (q && !seen.has(q.id)) return q; } return null; }, Math.min(15, ks.length * 2));
      });
    }
    function start(title, next, total) {
      runner = runPractice(root, { mode: 'repaso', title, next, total: Math.max(1, total), cfg: { title }, onFinish: (s, again) => config() });
    }
    config();
    return () => runner?.destroy();
  },
};
