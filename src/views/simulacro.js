import { html, setHTML, $, $$, confirmDialog, fmtDur, toast, esc } from '../ui/dom.js';
import { app, recordAnswer, saveSession, saveSettings, muniKey, exam } from '../app/store.js';
import { kv } from '../services/localdb.js';
import { createGenerator, OFFICIAL_MIX, OFFICIAL_MIX_TEXT, TYPE_NAME, SIM_TYPES } from '../engine/questions.js';
import { scoreExam, fmtNota, rulesFromExam, OFFICIAL_RULES } from '../engine/scoring.js';
import { pickStreets, scoreMapaMudo } from '../engine/mapamudo.js';
import { mountQuestion, answerRecord, compactQuestion } from '../ui/quiz.js';
import { createMap } from '../ui/map.js';

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
const euros = (x) => fmtNota(x); // formato 0,00
const pts = (milli) => fmtNota(milli / 1000);

export default {
  title: 'Simulacro',
  render(root, params) {
    let timer = null, qc = null, alive = true, mmMap = null;
    let cleanupReview = () => {};
    const M = app.model;
    const ex = exam();
    const rules = ex.format === 'test' ? rulesFromExam(ex) : OFFICIAL_RULES;
    const SIM_KEY = muniKey('simInProgress');
    const town = app.muniInfo?.name || '';

    async function config() {
      const saved = await kv.get(SIM_KEY);
      if (!alive) return;
      const officialCard = ex.format === 'mapaMudo' ? html`
          <form class="card form" id="mm">
            <h3>Simulacro oficial · mapa mudo</h3>
            <ul class="rules">
              <li>Se numeran <b>${ex.items}</b> vías en un mapa sin nombres: escribe el nombre de cada una.</li>
              <li>Nota de <b>0 a ${ex.max}</b>${ex.pass != null ? html` · aprobado con <b>${fmtNota(ex.pass)}</b>` : ''}. No hace falta escribir «Calle», artículos ni tildes.</li>
              <li class="small muted">${ex.source}. ${ex.notes}</li>
            </ul>
            <label>Número de vías <input type="number" name="n" min="5" max="60" value="${ex.items}"></label>
            <label>Zona <select name="zona"><option value="">Centro y alrededores</option>${M.zones.map((z) => html`<option value="${z.id}" ${params.zona === z.id ? 'selected' : ''}>${z.name}</option>`)}</select></label>
            <label>Tiempo (minutos, 0 = sin límite) <input type="number" name="min" min="0" max="180" value="${app.settings.officialMinutes}"></label>
            <label class="sw"><input type="checkbox" name="ayuda"> Sugerir nombres al escribir (ayuda; en el examen no la tendrás)</label>
            <button class="btn primary big" type="submit">Empezar mapa mudo</button>
          </form>` : html`
          <form class="card form" id="off">
            <h3>Simulacro oficial</h3>
            <ul class="rules">
              <li><b>${rules.questions}</b> preguntas con cuatro alternativas</li>
              <li>Acierto <b>+${pts(rules.correct)}</b> · Error <b>−${pts(rules.wrong)}</b> · En blanco <b>0</b></li>
              <li>Puntuación máxima <b>${pts(rules.max)}</b>${ex.pass != null ? html` · aprobado con ${fmtNota(ex.pass)}` : ' · prueba no eliminatoria'}</li>
              <li>Modalidades: ${SIM_TYPES.map((k) => `${TYPE_NAME[k]} (${OFFICIAL_MIX[k]})`).join(' · ')}</li>
              <li class="small muted">${ex.source}</li>
            </ul>
            <label>Tiempo (minutos, 0 = sin límite) <input type="number" name="min" min="0" max="180" value="${app.settings.officialMinutes}"></label>
            <label class="sw"><input type="checkbox" name="text" ${app.settings.officialTextOnly ? 'checked' : ''}> Solo preguntas de texto (sin mapa: cruces, edificios y accesos)</label>
            <p class="muted small">La duración real de la prueba la fijará el tribunal; ajusta el tiempo cuando se publique.</p>
            <button class="btn primary big" type="submit">Empezar simulacro oficial</button>
          </form>`;
      setHTML(root, html`
        ${saved ? html`<div class="card note row wrap"><span>Tienes un simulacro de ${town} sin entregar (${(saved.qs || saved.ids).length} ${saved.format === 'mapaMudo' ? 'vías' : 'preguntas'}, ${saved.answers.filter((a) => a != null && a !== '').length} contestadas).</span><button class="btn primary small" id="resume" type="button">Continuar</button><button class="btn small ghost" id="discard" type="button">Descartar</button></div>` : ''}
        <div class="grid cols2">
          ${officialCard}
          <form class="card form" id="tr">
            <h3>Simulacro tipo test${ex.format === 'mapaMudo' ? ' (práctica)' : ' de entrenamiento'}</h3>
            <label>Número de preguntas <select name="n">${[5, 10, 20, 30].map((n) => html`<option ${n === 10 ? 'selected' : ''}>${n}</option>`)}</select></label>
            <label>Tiempo (minutos, 0 = sin límite) <input type="number" name="min" min="0" max="180" value="0"></label>
            <label>Zona <select name="zona"><option value="">Todo el municipio</option>${M.zones.map((z) => html`<option value="${z.id}" ${params.zona === z.id ? 'selected' : ''}>${z.name}</option>`)}</select></label>
            <label class="sw"><input type="checkbox" name="text"> Solo preguntas de texto</label>
            <p class="muted small">Modalidades: ${SIM_TYPES.map((k) => TYPE_NAME[k]).join(', ')}. Acierto +${pts(rules.correct)}, error −${pts(rules.wrong)}${ex.format === 'test' ? '; la nota se muestra también escalada al máximo oficial' : ''}.</p>
            <button class="btn big" type="submit">Empezar</button>
          </form>
        </div>`);
      $('#off', root)?.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); const min = Number(f.get('min')) || 0; saveSettings({ officialMinutes: min, officialTextOnly: !!f.get('text') }); start({ mode: 'oficial', n: rules.questions, min, textOnly: !!f.get('text'), zona: null }); });
      $('#mm', root)?.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); const min = Number(f.get('min')) || 0; saveSettings({ officialMinutes: min }); startMapaMudo({ n: Math.max(5, Math.min(60, Number(f.get('n')) || ex.items)), min, zona: f.get('zona') || null, ayuda: !!f.get('ayuda') }); });
      $('#tr', root).addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(e.target); start({ mode: 'simulacro', n: Number(f.get('n')), min: Number(f.get('min')) || 0, textOnly: !!f.get('text'), zona: f.get('zona') || null }); });
      $('#resume', root)?.addEventListener('click', () => (saved.format === 'mapaMudo' ? runMapaMudo(saved) : run(saved)));
      $('#discard', root)?.addEventListener('click', async () => { await kv.del(SIM_KEY); config(); });
      if (params.oficial) ($('#off', root) || $('#mm', root))?.classList.add('focus-ring');
    }

    // ================= Simulacro tipo test =================
    function start(c) {
      const gen = createGenerator(M, { settings: { includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified, zoneId: c.zona } });
      const qs = gen.batch(scaledMix(c.n, c.textOnly), { mixedDiff: true, textOnly: c.textOnly });
      if (qs.length < c.n) {
        toast(`Solo se han podido generar ${qs.length} preguntas fiables con esta configuración.`, 'warn', 6000);
        if (c.mode === 'oficial' || !qs.length) return;
      }
      run({ format: 'test', cfg: c, qs, answers: Array(qs.length).fill(null), times: Array(qs.length).fill(0), idx: 0, startedAt: Date.now(), deadline: c.min ? Date.now() + c.min * 60000 : null });
    }

    function startClock(st, onTimeout) {
      const tick = () => {
        const c = $('#clock', root); if (!c) return;
        if (!st.deadline) { c.textContent = '⏱ ' + fmtDur(Date.now() - st.startedAt); return; }
        const left = st.deadline - Date.now();
        if (left <= 0) { clearInterval(timer); toast('Tiempo agotado: el simulacro se entrega automáticamente.', 'warn'); onTimeout(); return; }
        c.textContent = '⏳ ' + fmtDur(left); c.classList.toggle('urgent', left < 60000);
      };
      clearInterval(timer); timer = setInterval(tick, 1000); tick();
    }

    function run(st) {
      const persist = () => kv.set(SIM_KEY, st);
      persist();
      let shownAt = performance.now();
      setHTML(root, html`
        <div class="exam">
          <div class="exam-bar card">
            <b>${st.cfg.mode === 'oficial' ? 'Simulacro oficial' : 'Simulacro de entrenamiento'} · ${town}</b>
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
        const ok = await confirmDialog('¿Entregar el simulacro?', html`<p><b>${n}</b> preguntas contestadas y <b>${st.qs.length - n}</b> en blanco.</p>${blanks.length ? html`<p class="small">En blanco: ${blanks.join(', ')}</p>` : ''}<p class="small">Recuerda: cada error resta ${pts(rules.wrong)} y las preguntas en blanco no puntúan.</p>`, 'Entregar');
        if (ok) finish(st);
      });
      startClock(st, () => finish(st));
      show(st.idx);
    }

    async function finish(st) {
      clearInterval(timer); qc?.destroy(); qc = null;
      const key = st.qs.map((q) => q.answer);
      const score = scoreExam(st.answers, key, rules);
      score.escalada = score.max === rules.max / 1000 ? score.nota : Math.round((score.nota / score.max) * rules.max) / 1000;
      st.qs.forEach((q, i) => { if (st.answers[i] != null) recordAnswer(q, st.answers[i] === q.answer, st.times[i]); });
      const session = await saveSession({
        mode: st.cfg.mode, cfg: { format: 'test', n: st.qs.length, min: st.cfg.min, textOnly: st.cfg.textOnly, zona: st.cfg.zona },
        startedAt: st.startedAt, endedAt: Date.now(), durationMs: Date.now() - st.startedAt, score,
        answers: st.qs.map((q, i) => answerRecord(q, st.answers[i] == null ? null : st.answers[i] === q.answer, st.times[i], st.answers[i])),
        wrongQs: st.qs.filter((q, i) => st.answers[i] != null && st.answers[i] !== q.answer).map(compactQuestion),
      });
      await kv.del(SIM_KEY);
      if (alive) results(st, score, session);
    }

    function results(st, score, session) {
      const cats = {};
      st.qs.forEach((q, i) => { const c = (cats[q.cat] ||= { ok: 0, ko: 0, bl: 0 }); const a = st.answers[i]; if (a == null) c.bl++; else if (a === q.answer) c.ok++; else c.ko++; });
      const maxOff = rules.max / 1000;
      setHTML(root, html`
        <div class="card result">
          <h2>${st.cfg.mode === 'oficial' ? 'Resultado del simulacro oficial' : 'Resultado del simulacro'} · ${town}</h2>
          <div class="big-score ${score.escalada >= maxOff / 2 ? 'good' : 'low'}">${fmtNota(score.nota)} <small>/ ${fmtNota(score.max)}</small></div>
          ${score.max !== maxOff ? html`<p>Equivale a <b>${fmtNota(score.escalada)}</b> sobre ${fmtNota(maxOff)} puntos.</p>` : ''}
          <p><b>${score.correct}</b> aciertos × ${pts(rules.correct)} · <b>${score.wrong}</b> errores × ${pts(rules.wrong)} · <b>${score.blank}</b> en blanco = 0</p>
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

    // ================= Simulacro de mapa mudo =================
    function startMapaMudo(c) {
      const ids = pickStreets(M, { n: c.n, zoneId: c.zona, includeRural: app.settings.includeRural, onlyVerified: app.settings.onlyVerified });
      if (ids.length < c.n) {
        toast(`Solo hay ${ids.length} vías con nombre inequívoco en esa zona.`, 'warn', 6000);
        if (ids.length < 5) return;
      }
      runMapaMudo({ format: 'mapaMudo', cfg: c, ids, answers: Array(ids.length).fill(''), startedAt: Date.now(), deadline: c.min ? Date.now() + c.min * 60000 : null });
    }

    function runMapaMudo(st) {
      const persist = () => kv.set(SIM_KEY, st);
      persist();
      const names = st.cfg.ayuda ? [...new Set(M.streets.map((s) => s.name))].sort((a, b) => a.localeCompare(b, 'es')) : [];
      setHTML(root, html`
        <div class="exam mm">
          <div class="exam-bar card">
            <b>Mapa mudo · ${town}</b>
            <span id="answered"></span>
            <span id="clock" class="clock"></span>
            <button class="btn primary small" id="submit" type="button">Entregar</button>
          </div>
          <div class="grid cols2 mm-grid">
            <div class="map-wrap"><div id="mmap" class="map tall"></div></div>
            <div class="card scroll mm-list">
              <p class="small muted">Escribe el nombre de cada vía numerada. Puedes omitir «Calle», «Avenida», los artículos y las tildes.</p>
              <ol>${st.ids.map((id, i) => html`<li><label><span class="mm-n">${i + 1}</span><input type="text" data-i="${i}" value="${st.answers[i] || ''}" autocomplete="off" ${names.length ? 'list="mmnames"' : ''} placeholder="Nombre de la vía"></label></li>`)}</ol>
              ${names.length ? html`<datalist id="mmnames">${names.map((n) => html`<option value="${n}"></option>`)}</datalist>` : ''}
            </div>
          </div>
        </div>`);
      const numbers = st.ids.map((_, i) => String(i + 1));
      mmMap = createMap($('#mmap', root), { muted: true, fit: false });
      const draw = (sel = -1) => {
        mmMap.clear();
        mmMap.highlight(st.ids, { letters: numbers, weight: 6, colors: st.ids.map((_, i) => (i === sel ? '#f59e0b' : '#2563eb')) });
      };
      draw(); setTimeout(() => { if (!mmMap) return; mmMap.map.invalidateSize(); mmMap.fit(st.ids, 17); }, 60);
      const count = () => { const n = st.answers.filter((a) => a.trim()).length; $('#answered', root).textContent = `${n} de ${st.ids.length} escritas`; };
      count();
      $$('input[data-i]', root).forEach((inp) => {
        inp.addEventListener('input', () => { st.answers[Number(inp.dataset.i)] = inp.value; count(); persist(); });
        inp.addEventListener('focus', () => draw(Number(inp.dataset.i)));
      });
      $('#submit', root).addEventListener('click', async () => {
        const blanks = st.answers.map((a, i) => (a.trim() ? null : i + 1)).filter(Boolean);
        const ok = await confirmDialog('¿Entregar el mapa mudo?', html`<p><b>${st.ids.length - blanks.length}</b> vías escritas y <b>${blanks.length}</b> en blanco.</p>${blanks.length ? html`<p class="small">En blanco: ${blanks.join(', ')}</p>` : ''}`, 'Entregar');
        if (ok) finishMapaMudo(st);
      });
      startClock(st, () => finishMapaMudo(st));
    }

    async function finishMapaMudo(st) {
      clearInterval(timer);
      const r = scoreMapaMudo(M, st.ids, st.answers, ex);
      for (const it of r.items) if (it.ok !== null) recordAnswer({ concepts: ['st:' + it.id] }, it.ok, 0);
      const official = st.ids.length === ex.items && !st.cfg.zona;
      const session = await saveSession({
        mode: official ? 'oficial' : 'simulacro', cfg: { format: 'mapaMudo', n: st.ids.length, min: st.cfg.min, zona: st.cfg.zona, ayuda: !!st.cfg.ayuda },
        startedAt: st.startedAt, endedAt: Date.now(), durationMs: Date.now() - st.startedAt, score: r.score,
        answers: r.items.map((it) => ({ qid: 'mm:' + it.id, type: 'mapamudo', cat: 'mapamudo', diff: 2, ok: it.ok, ms: 0, chosen: null, text: it.answer, concepts: ['st:' + it.id], zones: M.street.get(it.id)?.zones || [] })),
        wrongQs: [],
      });
      await kv.del(SIM_KEY);
      if (!alive) return;
      mmMap?.destroy(); mmMap = null;
      const s = r.score;
      setHTML(root, html`
        <div class="card result">
          <h2>Resultado del mapa mudo · ${town}</h2>
          <div class="big-score ${s.aprobado === false ? 'low' : 'good'}">${fmtNota(s.nota)} <small>/ ${fmtNota(s.max)}</small></div>
          ${s.aprobado != null ? html`<p><span class="chip ${s.aprobado ? 'ok' : 'warn'}">${s.aprobado ? 'Aprobado' : 'No alcanza el mínimo'} (mínimo ${fmtNota(ex.pass)})</span></p>` : ''}
          <p><b>${s.correct}</b> aciertos · <b>${s.wrong}</b> errores · <b>${s.blank}</b> en blanco · ${s.pct} % · duración ${fmtDur(session.durationMs)}${official ? '' : ' · práctica (no cuenta como oficial)'}</p>
          <div class="row"><button class="btn primary" id="again" type="button">Nuevo simulacro</button><a class="btn" href="#/repaso">Repasar errores</a></div>
        </div>
        <div class="grid cols2 mm-grid">
          <div class="map-wrap"><div id="mmap" class="map tall"></div></div>
          <div class="card scroll"><table class="tbl"><thead><tr><th>Nº</th><th>Tu respuesta</th><th>Correcta</th><th></th></tr></thead><tbody>
            ${r.items.map((it, i) => html`<tr class="${it.ok ? 'row-ok' : 'row-ko'}"><td>${i + 1}</td><td>${it.answer || '—'}</td><td>${it.correct}</td><td>${it.ok ? '✓' : it.ok === null ? '·' : '✗'}</td></tr>`)}
          </tbody></table></div>
        </div>`);
      mmMap = createMap($('#mmap', root), { muted: true, fit: false });
      mmMap.highlight(st.ids, { letters: st.ids.map((_, i) => String(i + 1)), weight: 6, colors: r.items.map((it) => (it.ok ? '#16a34a' : '#dc2626')) });
      setTimeout(() => { if (!mmMap) return; mmMap.map.invalidateSize(); mmMap.fit(st.ids, 17); }, 60);
      $('#again', root).addEventListener('click', () => { mmMap?.destroy(); mmMap = null; config(); });
    }

    config();
    return () => { alive = false; clearInterval(timer); qc?.destroy(); cleanupReview(); mmMap?.destroy(); };
  },
};

export { esc, euros };
