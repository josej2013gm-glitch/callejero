// Componente de pregunta: enunciado, mapa (si procede) y cuatro alternativas.
// Modos: 'practice' (corrección inmediata), 'exam' (sin corrección) y 'review' (revisión).

import { html, setHTML, el, esc, $ } from './dom.js';
import { createMap, drawQuestion, drawSolution } from './map.js';
import { app } from '../app/store.js';
import { TYPE_NAME } from '../engine/questions.js';
import { pointToLines } from '../engine/geo.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const DIFF = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };

export function mountQuestion(root, q, opts = {}) {
  const mode = opts.mode || 'practice';
  const t0 = performance.now();
  let mp = null, answered = false;
  const needsMapBefore = q.map && ['highlight', 'choices', 'point', 'poi', 'tap'].includes(q.map.mode);
  setHTML(root, html`
    <div class="q-card ${mode}">
      <div class="q-meta">
        <span class="chip">${TYPE_NAME[q.cat] || q.cat}</span><span class="chip ghost">${DIFF[q.diff] || ''}</span>
        ${q.data !== 'verificado' ? html`<span class="chip warn" title="Pregunta generada con datos de OpenStreetMap que aún no se han contrastado con el callejero municipal">Datos OSM sin verificar</span>` : html`<span class="chip ok">Datos verificados</span>`}
        ${opts.counter ? html`<span class="q-counter">${opts.counter}</span>` : ''}
      </div>
      <h2 class="q-prompt">${q.prompt}</h2>
      <div class="q-map ${needsMapBefore ? '' : 'hidden'}"></div>
      <ol class="q-options ${q.options ? '' : 'hidden'}"></ol>
      ${q.tap && !q.options ? html`<p class="hint">Toca o haz clic sobre la vía. Se admite un margen de ${q.tap.tol} m.</p>` : ''}
      <div class="q-feedback hidden" aria-live="polite"></div>
    </div>`);
  const ol = $('.q-options', root), fb = $('.q-feedback', root), mapEl = $('.q-map', root);

  function ensureMap() {
    if (mp) return mp;
    mapEl.classList.remove('hidden');
    mp = createMap(mapEl, { muted: true, fit: false, onMapClick: q.tap && !q.options && mode === 'practice' ? onTap : null });
    mp.invalidate();
    return mp;
  }
  if (needsMapBefore) { ensureMap(); setTimeout(() => { if (!mp) return; mp.map.invalidateSize(); drawQuestion(mp, q); }, 60); }

  (q.options || []).forEach((o, i) => {
    const b = el('button', { class: 'opt', type: 'button', 'data-i': i }, [el('span', { class: 'letter' }, LETTERS[i]), el('span', { class: 'txt' }, o.label)]);
    if (q.map?.mode === 'choices') Object.assign(b.querySelector('.letter').style, { background: ['#dc2626', '#2563eb', '#16a34a', '#9333ea'][i], color: '#fff' });
    b.addEventListener('click', () => choose(i));
    ol.append(el('li', {}, [b]));
  });
  if (mode === 'exam' && opts.selected != null) mark(opts.selected);
  if (mode === 'review') reveal(opts.selected ?? null, false);

  function mark(i) { [...ol.querySelectorAll('.opt')].forEach((b, j) => b.classList.toggle('selected', j === i)); }

  function choose(i) {
    if (mode === 'exam') {
      const cur = opts.getSelected?.();
      const next = cur === i ? null : i; // pulsar de nuevo deja la pregunta en blanco
      mark(next); opts.onSelect?.(next); return;
    }
    if (mode !== 'practice' || answered) return;
    answered = true;
    const ms = Math.round(performance.now() - t0);
    const ok = i === q.answer;
    reveal(i, true);
    opts.onAnswer?.({ ok, chosen: i, ms });
  }

  function onTap(ll) {
    if (answered) return;
    answered = true;
    const s = app.model.street.get(q.tap.id);
    const d = Math.round(pointToLines([ll.lng, ll.lat], s.lines));
    const ok = d <= q.tap.tol;
    const near = mp.nearestStreet(ll, 40);
    mp.L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: ok ? '#16a34a' : '#dc2626', fillOpacity: 1 }).addTo(mp.map);
    const ms = Math.round(performance.now() - t0);
    drawSolution(mp, q);
    showFeedback(ok, ok ? `Correcto: has tocado ${s.label} (a ${d} m del eje).`
      : `Has tocado ${near ? near.street.label : 'un punto sin vía cercana'}; ${s.label} está a ${d} m de ese punto. ${q.explanation}`);
    opts.onAnswer?.({ ok, chosen: null, ms, tapDist: d });
  }

  function reveal(chosen, withMap) {
    [...ol.querySelectorAll('.opt')].forEach((b, j) => {
      b.disabled = true;
      if (j === q.answer) b.classList.add('correct');
      else if (j === chosen) b.classList.add('wrong');
    });
    const ok = chosen === q.answer;
    const head = chosen == null ? 'En blanco.' : ok ? 'Correcto.' : 'Incorrecto.';
    showFeedback(chosen == null ? null : ok, `${head} ${chosen != null && !ok ? `La respuesta correcta es ${LETTERS[q.answer]}) ${q.options[q.answer].label}. ` : ''}${q.explanation}`);
    if (withMap) { ensureMap(); setTimeout(() => { if (!mp) return; mp.map.invalidateSize(); drawSolution(mp, q); }, 60); }
    else if (mode === 'review') {
      const btn = el('button', { class: 'btn small ghost', type: 'button' }, 'Ver en el mapa');
      btn.addEventListener('click', () => { btn.remove(); ensureMap(); setTimeout(() => { if (!mp) return; mp.map.invalidateSize(); drawSolution(mp, q); }, 60); });
      fb.append(btn);
    }
  }
  function showFeedback(ok, text) {
    fb.classList.remove('hidden', 'ok', 'ko', 'blank');
    fb.classList.add(ok === true ? 'ok' : ok === false ? 'ko' : 'blank');
    setHTML(fb, html`<p>${text}</p>`);
    if (opts.next) {
      const nb = el('button', { class: 'btn primary', type: 'button' }, opts.nextLabel || 'Siguiente');
      nb.addEventListener('click', opts.next); fb.append(nb); setTimeout(() => nb.focus(), 30);
    }
  }

  return { destroy() { mp?.destroy(); mp = null; }, get answered() { return answered; } };
}

/** Respuesta compacta para el historial. */
export function answerRecord(q, ok, ms, chosen) {
  return { qid: q.id, type: q.type, cat: q.cat, diff: q.diff, ok, ms, chosen: chosen ?? null, concepts: q.concepts, zones: (q.refs?.streets || []).slice(0, 1).flatMap((id) => app.model.street.get(id)?.zones || []) };
}

/** Copia reducida de una pregunta para poder repetirla después. */
export function compactQuestion(q) {
  const { created, ...rest } = q;
  return rest;
}

export { esc };
