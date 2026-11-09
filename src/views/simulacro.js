import { html, setHTML, $, $$, confirmDialog, fmtDur, toast } from '../ui/dom.js';
import { app, recordAnswer, saveSession, saveSettings } from '../app/store.js';
import { kv } from '../services/localdb.js';
import { createGenerator, OFFICIAL_MIX, OFFICIAL_MIX_TEXT, TYPES, TYPE_NAME } from '../engine/questions.js';
import { scoreExam, OFFICIAL_RULES, fmtNota } from '../engine/scoring.js';
import { mountQuestion, answerRecord, compactQuestion } from '../ui/quiz.js';

/** Reparte n preguntas proporcionalmente a la mezcla oficial. */
function scaledMix(n, textOnly) {
  const base = textOnly ? OFFICIAL_MIX_TEXT : OFFICIAL_MIX;
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  const mix = {}; let sum = 0;
  for (const [k, v] of Object.entries(base)) { mix[k] = Math.floor((v * n) / total); sum += mix[k]; }
  const keys = Object.keys(base).sort((a, b) => base[b] - base[a]);
  for (let i = 0; sum < n; i++, sum++) mix[keys[i % keys.length]]++;
  return mix;
}

export default {
  title: 'Simulacro',
  render(root, params) {
    let timer = null, qc = null, alive = true;
    const M = app.model;

    async function config() {
      const saved = await kv.get('simInProgress');
      if (!alive) return;
      setHTML(root, html`
        ${saved ? html`<div class="card note row wrap"><span>Tienes un simulacro sin entregar (${saved.qs.length} preguntas, ${saved.answers.filter((a) => a != null).length} contestadas).</span><button class="btn primary small" id="resume" type="button">Continuar</button><button class="btn small ghost" id="discard" type="button">Descartar</button></div>` : ''}
        <div class="grid cols2">
          <form class="card form" id="off">
            <h3>Simulacro oficial</h3>
            <ul class="rules">
              <li><b>${OFFICIAL_RULES.questions}</b> preguntas con cuatro alternativas</li>
              <li>Acierto <b>+0,10</b> · Error <b>−0,03</b> · En blanco <b>0</b></li>
              <li>Puntuación máxima <b>2,00</b> · prueba no eliminatoria</li>
            </ul>
            <label>Tiempo (minutos, 0 = sin límite) <input type="number" name="min" min="0" max="180" value="${app.settings.officialMinutes}"></label>
            <label class="sw"><input type="checkbox" name="text" ${app.settings.officialTextOnly ? 'checked' : ''}> Solo preguntas de texto (sin mapa)</label>
            <p class="muted small">La duración real de la prueba la fijará el tribunal; ajusta el tiempo cuando se publique.</p>
            <button class="btn primary big" type="submit">Empezar simulacro oficial</button>
          </form>
          <form class="card form" id="tr">
            <h3>Simulacro de entrenamiento</h3>
            <label>Número de preguntas <select name="n">${[5, 10, 20, 30].map((n) => html`<option ${n === 10 ? 'selected' : ''}>${n}</option>`)}</select></label>
            <label>Tiempo (minutos, 0 = sin límite) <input type="number" name="min" min="0" max="180" value="0"></label>
            <label>Zona <select name="zona"><option value="">Todo el municipio</option>${M.zones.map((z) => html`<option value="${z.id}" ${params.zona === z.id ? 'selected' : ''}>${z.name}</option>`)}</select></label>
            <label class="sw"><input type="checkbox" name="text"> Solo preguntas de texto</label>
            <p class="muted small">Misma puntuación por pregunta (+0,10 / −0,03). La nota se muestra también escalada a 2 puntos.</p>
            <button class="btn big" type="submit">Empezar</button>
          </form>
        </div>`);
      $('#off', root).addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); const min = Number(f.get('min')) || 0; saveSettings({ officialMinutes: min, officialTextOnly: !!f.get('text') }); start({ mode: 'oficial', n: 20, min, textOnly: !!f.get('text'), zona: null }); });
      $('#tr', root).addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); start({ mode: 'simulacro', n: Number(f.get('n')), min: Number(f.get('min')) || 0, textOnly: !!f.get('text'), zona: f.get('zona') || null }); });
      $('#resume', root)?.addEventListener('click', () => run(saved));
      $('#discard', root)?.addEventListener('click', async () => { await kv.del('simInProgress'); config(); });
      if (params.oficial) $('#off', root).classList.add('focus-ring');
    }

    function start(c) {
      const gen = createGenerator(M, { settings: { includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified, zoneId: c.zona } });
      const qs = gen.batch(scaledMix(c.n, c.textOnly), { mixedDiff: true, textOnly: c.textOnly });
      if (qs.length < c.n) {
        toast(`Solo se han podido generar ${qs.length} preguntas fiables con esta configuración.`, 'warn', 6000);
        if (c.mode === 'oficial' || !qs.length) return;
      }
      const st = { cfg: c, qs, answers: Array(qs.length).fill(null), times: Array(qs.length).fill(0), idx: 0, startedAt: Date.now(), deadline: c.min ? Date.now() + c.min * 60000 : null };
      run(st);
    }

    function run(st) {
      const persist = () => kv.set('simInProgress', st);
      persist();
      let shownAt = performance.now();
      setHTML(root, html`
        <div class="exam">
          <div class="exam-bar card">
            <b>${st.cfg.mode === 'oficial' ? 'Simulacro oficial' : 'Simulacro de entrenamiento'}</b>
            <span id="answered"></span>
            <span id="clock" class="clock"></span>
            <button class="btn primary small" id="submit" type="button">Entregar</button>
          </div>
          <nav class="qnav" id="qnav" aria-label="Preguntas">${st.qs.map((_, i) => html`<button type="button" data-i="${i}">${i + 1}</button>`)}</nav>
          <div id="eq"></div>
          <div class="row exam-actions">
            <button class="btn" id="prev" type="button">← Anterior</button>
            <button class="btn ghost" id="blank" type="button">Dejar en blanco</button>
            <button class="btn" id="next" type="button">Siguiente →</button>
          </div>
        </div>`);
      const track = () => { const now = performance.now(); st.times[st.idx] += Math.round(now - shownAt); shownAt = now; };
      function show(i) {
        track(); st.idx = i; persist();
        qc?.destroy();
        qc = mountQuestion($('#eq', root), st.qs[i], {
          mode: 'exam', counter: `Pregunta ${i + 1} de ${st.qs.length}`, selected: st.answers[i], getSelected: () => st.answers[i],
          onSelect: (v) => { st.answers[i] = v; persist(); nav(); },
        });
        nav();
      }
      function nav() {
        $$('#qnav button', root).forEach((b, j) => { b.classList.toggle('done', st.answers[j] != null); b.classList.toggle('cur', j === st.idx); });
        const n = st.answers.filter((a) => a != null).length;
        $('#answered', root).textContent = `${n} contestadas · ${st.qs.length - n} en blanco`;
        $('#prev', root).disabled = st.idx === 0; $('#next', root).disabled = st.idx === st.qs.length - 1;
      }
      $('#qnav', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(Number(b.dataset.i)); });
      $('#prev', root).addEventListener('click', () => show(st.idx - 1));
      $('#next', root).addEventListener('click', () => show(st.idx + 1));
      $('#blank', root).addEventListener('click', () => { st.answers[st.idx] = null; persist(); show(st.idx); });
      $('#submit', root).addEventListener('click', async () => {
        const n = st.answers.filter((a) => a != null).length;
        const blanks = st.answers.map((a, i) => (a == null ? i + 1 : null)).filter(Boolean);
        const ok = await confirmDialog('¿Entregar el simulacro?', html`<p><b>${n}</b> preguntas contestadas y <b>${st.qs.length - n}</b> en blanco.</p>${blanks.length ? html`<p class="small">En blanco: ${blanks.join(', ')}</p>` : ''}<p class="small">Recuerda: cada error resta 0,03 y las preguntas en blanco no puntúan.</p>`, 'Entregar');
        if (ok) finish(st);
      });
      const tick = () => {
        if (!st.deadline) { $('#clock', root).textContent = '⏱ ' + fmtDur(Date.now() - st.startedAt); return; }
        const left = st.deadline - Date.now();
        if (left <= 0) { clearInterval(timer); toast('Tiempo agotado: el simulacro se entrega automáticamente.', 'warn'); finish(st); return; }
        const c = $('#clock', root); c.textContent = '⏳ ' + fmtDur(left); c.classList.toggle('urgent', left < 60000);
      };
      clearInterval(timer); timer = setInterval(tick, 1000); tick();
      show(st.idx);
    }

    async function finish(st) {
      clearInterval(timer); qc?.destroy(); qc = null;
      const key = st.qs.map((q) => q.answer);
      const score = scoreExam(st.answers, key);
      st.qs.forEach((q, i) => { if (st.answers[i] != null) recordAnswer(q, st.answers[i] === q.answer, st.times[i]); });
      const session = await saveSession({
        mode: st.cfg.mode, cfg: { n: st.qs.length, min: st.cfg.min, textOnly: st.cfg.textOnly, zona: st.cfg.zona },
        startedAt: st.startedAt, endedAt: Date.now(), durationMs: Date.now() - st.startedAt, score,
        answers: st.qs.map((q, i) => answerRecord(q, st.answers[i] == null ? null : st.answers[i] === q.answer, st.times[i], st.answers[i])),
        wrongQs: st.qs.filter((q, i) => st.answers[i] != null && st.answers[i] !== q.answer).map(compactQuestion),
      });
      await kv.del('simInProgress');
      if (alive) results(st, score, session);
    }

    function results(st, score, session) {
      const cats = {};
      st.qs.forEach((q, i) => { const c = (cats[q.cat] ||= { ok: 0, ko: 0, bl: 0 }); const a = st.answers[i]; if (a == null) c.bl++; else if (a === q.answer) c.ok++; else c.ko++; });
      setHTML(root, html`
        <div class="card result">
          <h2>${st.cfg.mode === 'oficial' ? 'Resultado del simulacro oficial' : 'Resultado del simulacro'}</h2>
          <div class="big-score ${score.sobre2 >= 1 ? 'good' : 'low'}">${fmtNota(score.nota)} <small>/ ${fmtNota(score.max)}</small></div>
          ${score.max !== 2 ? html`<p>Equivale a <b>${fmtNota(score.sobre2)}</b> sobre 2 puntos.</p>` : ''}
          <p><b>${score.correct}</b> aciertos × 0,10 = ${fmtNota(score.correct * 0.1)} · <b>${score.wrong}</b> errores × 0,03 = −${fmtNota(score.wrong * 0.03)} · <b>${score.blank}</b> en blanco = 0</p>
          ${score.raw < 0 ? html`<p class="small muted">La puntuación bruta es ${fmtNota(score.raw)}; la nota mínima se fija en 0.</p>` : ''}
          <p class="small">Duración: ${fmtDur(session.durationMs)}</p>
          <table class="tbl"><thead><tr><th>Categoría</th><th>Aciertos</th><th>Errores</th><th>Blanco</th></tr></thead><tbody>
            ${Object.entries(cats).map(([c, v]) => html`<tr><td>${TYPE_NAME[c] || c}</td><td>${v.ok}</td><td>${v.ko}</td><td>${v.bl}</td></tr>`)}
          </tbody></table>
          <div class="row"><button class="btn primary" id="again" type="button">Nuevo simulacro</button><a class="btn" href="#/repaso">Repasar errores</a></div>
        </div>
        <h3>Revisión de respuestas</h3>
        <div id="review"></div>`);
      const rv = $('#review', root);
      const mounted = [];
      st.qs.forEach((q, i) => { const d = document.createElement('div'); d.className = 'review-item'; rv.append(d); mounted.push(mountQuestion(d, q, { mode: 'review', selected: st.answers[i], counter: `${i + 1}` })); });
      $('#again', root).addEventListener('click', () => { mounted.forEach((m) => m.destroy()); config(); });
      cleanupReview = () => mounted.forEach((m) => m.destroy());
    }
    let cleanupReview = () => {};

    config();
    return () => { alive = false; clearInterval(timer); qc?.destroy(); cleanupReview(); };
  },
};

export { TYPES };
