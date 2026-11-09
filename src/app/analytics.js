// Métricas derivadas del progreso y del historial (dashboard, zonas, estadísticas, repaso).

import { app } from './store.js';
import { isMastered, isDue, priority, reason } from '../engine/srs.js';
import { eligibleStreets } from '../engine/model.js';
import { TYPE_NAME } from '../engine/questions.js';

export function streetState(id) {
  const it = app.progress.items['st:' + id];
  if (!it || !it.n) return 'nueva';
  return isMastered(it) ? 'dominada' : 'estudiada';
}

export function scopeStreets(zoneId = null) {
  if (!app.model) return [];
  return eligibleStreets(app.model, { includeRural: app.settings.includeRural, onlyVerified: false, zoneId });
}

export function mastery(zoneId = null) {
  const list = scopeStreets(zoneId);
  let studied = 0, mastered = 0;
  for (const s of list) { const st = streetState(s.id); if (st !== 'nueva') studied++; if (st === 'dominada') mastered++; }
  return { total: list.length, studied, mastered, pct: list.length ? Math.round((mastered / list.length) * 100) : 0 };
}

export function dueList(now = Date.now()) {
  const out = [];
  for (const it of Object.values(app.progress.items)) {
    if (!conceptExists(it.k)) continue;
    if (isDue(it, now) || it.lastOk === false) out.push({ it, p: priority(it, now, app.settings.slowMs), why: reason(it, now, app.settings.slowMs) });
  }
  return out.sort((a, b) => b.p - a.p);
}

export function conceptExists(k) {
  const M = app.model; if (!M) return false;
  const [kind, rest] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  if (kind === 'st') return M.street.has(rest);
  if (kind === 'ix') return M.pair.has(rest);
  if (kind === 'poi') return M.poi.has(rest);
  if (kind === 'rel') { const ids = rest.split(':')[1] || ''; const a = ids.split('|')[0]; return M.street.has(a) || M.poi.has(a); }
  return false;
}

export function conceptLabel(k) {
  const M = app.model; if (!M) return k;
  const [kind, rest] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  const sl = (id) => M.street.get(id)?.label || M.poi.get(id)?.name || id;
  if (kind === 'st') return sl(rest);
  if (kind === 'poi') return sl(rest);
  if (kind === 'ix') { const [a, b] = rest.split('|'); return `Cruce ${sl(a)} / ${sl(b)}`; }
  if (kind === 'rel') {
    const [rk, ids] = rest.split(':'); const [a, b] = (ids || '').split('|');
    const name = { par: 'Paralelas', perp: 'Perpendiculares', prox: 'Próximas', ruta: 'Recorrido', dir: 'Dirección' }[rk] || 'Relación';
    return `${name}: ${sl(a)} · ${sl(b)}`;
  }
  return k;
}
export function conceptKind(k) { return { st: 'Calle', ix: 'Cruce', poi: 'Edificio', rel: 'Relación' }[k.split(':')[0]] || ''; }

export function allAnswers() {
  const out = [];
  for (const s of app.sessions) for (const a of s.answers || []) out.push({ ...a, mode: s.mode, at: s.endedAt });
  return out;
}

export function byCategory() {
  const m = {};
  for (const a of allAnswers()) {
    const c = a.cat || a.type; if (!c) continue;
    m[c] ||= { cat: c, name: TYPE_NAME[c] || c, n: 0, ok: 0, ko: 0, blank: 0, ms: 0 };
    m[c].n++; if (a.ok === true) m[c].ok++; else if (a.ok === false) m[c].ko++; else m[c].blank++;
    m[c].ms += a.ms || 0;
  }
  return Object.values(m).map((x) => ({ ...x, pct: x.n ? Math.round((x.ok / x.n) * 100) : 0, avgMs: x.n ? Math.round(x.ms / x.n) : 0 })).sort((a, b) => a.pct - b.pct);
}

export function exams(modes = ['oficial', 'simulacro']) {
  return app.sessions.filter((s) => modes.includes(s.mode) && s.score);
}

export function globalStats() {
  const ans = allAnswers().filter((a) => a.ok !== null && a.ok !== undefined);
  const ok = ans.filter((a) => a.ok).length;
  const off = exams(['oficial']);
  const best = off.reduce((m, s) => Math.max(m, s.score.nota), 0);
  const avg = off.length ? off.reduce((m, s) => m + s.score.nota, 0) / off.length : null;
  const timed = allAnswers().filter((a) => a.ms > 0);
  return {
    answered: ans.length, ok, pct: ans.length ? Math.round((ok / ans.length) * 100) : 0,
    officialCount: off.length, best: off.length ? best : null, avg,
    avgMs: timed.length ? Math.round(timed.reduce((m, a) => m + a.ms, 0) / timed.length) : 0,
  };
}

export function frequentErrors(n = 10) {
  return Object.values(app.progress.items).filter((it) => it.ko > 0 && conceptExists(it.k))
    .sort((a, b) => b.ko - a.ko || b.lapses - a.lapses).slice(0, n);
}

/** Recomendación de entrenamiento basada en los errores. */
export function recommendation() {
  const cats = byCategory().filter((c) => c.n >= 5);
  const due = dueList();
  if (!app.sessions.length) return { text: 'Empieza identificando las vías del Centro urbano en el mapa mudo, nivel 1.', href: '#/mudo' };
  if (due.length >= 5) return { text: `Tienes ${due.length} conceptos pendientes de repaso. Repásalos antes de seguir con material nuevo.`, href: '#/repaso' };
  if (cats.length && cats[0].pct < 70) return { text: `Tu punto más débil es «${cats[0].name}» (${cats[0].pct} % de aciertos). Entrena esa modalidad.`, href: `#/entrenamiento?tipo=${cats[0].cat}` };
  const zones = (app.model?.zones || []).filter((z) => z.zkind !== 'tematica' && z.streets.length >= 3).map((z) => ({ z, m: mastery(z.id) })).filter((x) => x.m.total);
  zones.sort((a, b) => a.m.pct - b.m.pct);
  if (zones.length && zones[0].m.pct < 60) return { text: `La zona «${zones[0].z.name}» tiene solo un ${zones[0].m.pct} % de dominio. Entrénala.`, href: `#/entrenamiento?zona=${encodeURIComponent(zones[0].z.id)}` };
  return { text: 'Buen nivel. Haz un simulacro oficial completo para medir tu progreso.', href: '#/simulacro' };
}
