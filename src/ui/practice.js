// Sesión de práctica con corrección inmediata (entrenamiento, mapa mudo y repaso).

import { html, setHTML, el, $, fmtDur, pct } from './dom.js';
import { mountQuestion, answerRecord, compactQuestion } from './quiz.js';
import { app, recordAnswer, saveSession } from '../app/store.js';

/**
 * opts: { mode, cfg, total (o Infinity), next(i, history) → pregunta | null,
 *         onAnswer(q, result, history), title, endLabel, onFinish(session) }
 */
export function runPractice(root, opts) {
  const history = [];
  const startedAt = Date.now();
  let current = null, i = 0, finished = false, dead = false;
  setHTML(root, html`
    <div class="practice">
      <div class="practice-bar card">
        <b>${opts.title}</b>
        <span class="score" id="pscore">0 / 0</span>
        <div class="pbar"><span id="pfill"></span></div>
        <button class="btn small ghost" id="pend" type="button">${opts.endLabel || 'Terminar'}</button>
      </div>
      <div id="pq"></div>
    </div>`);
  const qRoot = $('#pq', root);
  $('#pend', root).addEventListener('click', () => finish(false));

  function update() {
    const ok = history.filter((h) => h.ok).length;
    $('#pscore', root).textContent = `${ok} / ${history.length} aciertos`;
    $('#pfill', root).style.width = (Number.isFinite(opts.total) ? pct(history.length, opts.total) : pct(ok, history.length)) + '%';
  }

  function nextQ() {
    current?.destroy();
    if (history.length >= opts.total) return finish();
    const q = opts.next(i++, history);
    if (!q) { if (!history.length) return empty(); return finish(); }
    current = mountQuestion(qRoot, q, {
      mode: 'practice',
      counter: Number.isFinite(opts.total) ? `${history.length + 1} / ${opts.total}` : `#${history.length + 1}`,
      onAnswer: (r) => {
        recordAnswer(q, r.ok, r.ms);
        history.push({ q, ...r, rec: answerRecord(q, r.ok, r.ms, r.chosen) });
        opts.onAnswer?.(q, r, history);
        update();
      },
      next: () => nextQ(),
      nextLabel: history.length + 1 >= opts.total ? 'Ver resumen' : 'Siguiente',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function empty() {
    setHTML(qRoot, html`<div class="card"><p>No hay datos suficientes para generar preguntas fiables con esta configuración.</p><p class="muted small">Prueba con otra zona, otra dificultad o incluyendo los caminos rurales en Ajustes. Si el callejero tiene pocas relaciones importadas, revisa el informe de importación.</p></div>`);
  }

  async function finish(silent = false) {
    if (finished) return; finished = true;
    current?.destroy();
    if (!history.length) { if (!silent) opts.onFinish?.(null); return; }
    const ok = history.filter((h) => h.ok).length;
    const session = await saveSession({
      mode: opts.mode, cfg: opts.cfg || {}, startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt,
      answers: history.map((h) => h.rec), wrongQs: history.filter((h) => !h.ok && h.q.options).slice(0, 30).map((h) => compactQuestion(h.q)),
    });
    if (silent || dead) return; // la vista ya se ha cerrado: no pintar encima de otra sección
    const avg = Math.round(history.reduce((s, h) => s + h.ms, 0) / history.length);
    setHTML(root, html`
      <div class="card result">
        <h2>Resumen</h2>
        <div class="big-score ${pct(ok, history.length) >= 70 ? 'good' : 'low'}">${pct(ok, history.length)} %</div>
        <p>${ok} aciertos de ${history.length} · tiempo medio ${fmtDur(avg)} · duración ${fmtDur(session.durationMs)}</p>
        ${opts.summaryExtra ? opts.summaryExtra(history) : ''}
        <h3>Fallos</h3>
        ${history.some((h) => !h.ok) ? html`<ol class="errs">${history.filter((h) => !h.ok).map((h) => html`<li><b>${h.q.prompt}</b><br><small>${h.q.options ? 'Correcta: ' + h.q.options[h.q.answer].label : h.q.explanation}</small></li>`)}</ol>` : html`<p class="muted">Ninguno. ¡Muy bien!</p>`}
        <div class="row"><button class="btn primary" id="again" type="button">Otra ronda</button><a class="btn" href="#/repaso">Ir al repaso</a><a class="btn ghost" href="#/">Inicio</a></div>
      </div>`);
    $('#again', root).addEventListener('click', () => opts.onFinish?.(session, true));
  }

  nextQ();
  return { destroy() { dead = true; current?.destroy(); if (!finished && history.length) finish(true); } };
}

export { el };
