import { html, setHTML, raw, fmtDate, fmtDur, confirmDialog, $ } from '../ui/dom.js';
import { app, deleteSession, exam } from '../app/store.js';
import { globalStats, byCategory, exams, mastery, frequentErrors, conceptLabel, conceptKind, streetState, scopeStreets, allAnswers, scaled } from '../app/analytics.js';
import { lineChart, barList } from '../ui/charts.js';
import { fmtNota } from '../engine/scoring.js';

export default {
  title: 'Estadísticas',
  render(root) {
    const draw = () => {
      const g = globalStats(), m = mastery(), cats = byCategory();
      const ex = exams().slice(-30);
      const E = exam(), top = E.max || 2, ref = E.pass ?? top / 2;
      const evo = lineChart([
        { name: 'Simulacro oficial', color: '#1d4ed8', points: ex.map((s) => ({ x: fmtDate(s.endedAt), y: s.mode === 'oficial' ? scaled(s) : null })) },
        { name: `Simulacros de práctica (escalados a ${fmtNota(top)})`, color: '#f59e0b', points: ex.map((s) => ({ x: fmtDate(s.endedAt), y: s.mode === 'simulacro' ? scaled(s) : null })) },
      ], { yMax: top, refLine: ref, refLabel: `${fmtNota(ref)}${E.pass != null ? ' (aprobado)' : ' (50 %)'}`, fmt: (v) => fmtNota(v) });
      // Aciertos por semana (todas las modalidades)
      const weeks = {};
      for (const a of allAnswers()) { if (a.ok == null) continue; const d = new Date(a.at); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = d.getTime(); (weeks[k] ||= { n: 0, ok: 0 }).n++; if (a.ok) weeks[k].ok++; }
      const wk = Object.entries(weeks).sort((a, b) => a[0] - b[0]).slice(-12);
      const weekly = lineChart([{ name: '% aciertos', color: '#16a34a', points: wk.map(([k, v]) => ({ x: fmtDate(Number(k)), y: Math.round((v.ok / v.n) * 100) })) }], { yMax: 100, fmt: (v) => Math.round(v) + ' %' });
      const zones = app.model.zones.filter((z) => z.streets.length >= 2).map((z) => ({ z, m: mastery(z.id) })).filter((x) => x.m.studied > 0).sort((a, b) => a.m.pct - b.m.pct);
      const errs = frequentErrors(15);
      const streets = scopeStreets();
      const dominated = streets.filter((s) => streetState(s.id) === 'dominada');
      const pending = streets.filter((s) => streetState(s.id) !== 'dominada');
      const hist = exams().slice().reverse();
      setHTML(root, html`
        <section class="grid cards4">
          <div class="card stat"><span class="k">Aciertos totales</span><b>${g.pct} %</b><small>${g.ok} de ${g.answered} respuestas</small></div>
          <div class="card stat"><span class="k">Media simulacro oficial</span><b>${g.avg != null ? fmtNota(g.avg) : '—'}</b><small>sobre ${fmtNota(exam().max || 2)} · ${g.officialCount} simulacros · mejor ${g.best != null ? fmtNota(g.best) : '—'}</small></div>
          <div class="card stat"><span class="k">Tiempo medio de respuesta</span><b>${g.avgMs ? fmtDur(g.avgMs) : '—'}</b><small>por pregunta</small></div>
          <div class="card stat"><span class="k">Calles dominadas</span><b>${m.mastered}</b><small>de ${m.total} (${m.pct} %)</small></div>
        </section>
        <section class="grid cols2">
          <div class="card"><h3>Evolución de las notas</h3>${raw(evo)}</div>
          <div class="card"><h3>Aciertos por semana</h3>${raw(weekly)}</div>
        </section>
        <section class="grid cols2">
          <div class="card"><h3>Resultados por categoría</h3>${raw(barList(cats.map((c) => ({ label: c.name, value: c.pct, note: `${c.ok}/${c.n} · ${fmtDur(c.avgMs)} de media` }))))}</div>
          <div class="card"><h3>Rendimiento por zona (dominio)</h3>${raw(barList(zones.map((x) => ({ label: x.z.name, value: x.m.pct, note: `${x.m.mastered}/${x.m.total} dominadas · ${x.m.studied} estudiadas` }))))}</div>
        </section>
        <section class="grid cols2">
          <div class="card"><h3>Errores frecuentes</h3>
            ${errs.length ? html`<table class="tbl"><thead><tr><th>Concepto</th><th>Tipo</th><th>Fallos</th><th>Aciertos</th></tr></thead><tbody>${errs.map((it) => html`<tr><td>${conceptLabel(it.k)}</td><td>${conceptKind(it.k)}</td><td>${it.ko}</td><td>${it.ok}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin errores registrados.</p>`}</div>
          <div class="card"><h3>Calles</h3>
            <details><summary>Dominadas (${dominated.length})</summary><p class="small cols">${dominated.map((s) => s.label).join(' · ') || '—'}</p></details>
            <details><summary>Pendientes (${pending.length})</summary><p class="small cols">${pending.slice(0, 400).map((s) => s.label).join(' · ')}${pending.length > 400 ? ' …' : ''}</p></details>
            <p class="small muted">Una calle está dominada cuando su último repaso fue correcto y ha alcanzado un intervalo de 7 días o más.</p>
          </div>
        </section>
        <div class="card"><h3>Historial de simulacros</h3>
          ${hist.length ? html`<table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Preg.</th><th>A / E / B</th><th>Nota</th><th>Escala oficial</th><th>Duración</th><th></th></tr></thead><tbody>
            ${hist.map((s) => html`<tr><td>${fmtDate(s.endedAt, true)}</td><td>${s.mode === 'oficial' ? 'Oficial' : 'Práctica'}${s.cfg?.format === 'mapaMudo' ? ' · mapa mudo' : ' · test'}</td><td>${s.score.n}</td><td>${s.score.correct} / ${s.score.wrong} / ${s.score.blank}</td><td><b>${fmtNota(s.score.nota)}</b> / ${fmtNota(s.score.max)}</td><td>${fmtNota(scaled(s))} / ${fmtNota(E.max || 2)}</td><td>${fmtDur(s.durationMs || 0)}</td><td><button class="link danger" data-del="${s.id}" type="button" title="Eliminar">✕</button></td></tr>`)}
          </tbody></table>` : html`<p class="muted">Aún no has hecho simulacros.</p>`}
        </div>`);
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Eliminar simulacro', 'Se borrará del historial en todos tus dispositivos.', 'Eliminar')) { await deleteSession(b.dataset.del); draw(); } }));
    };
    draw();
  },
};
