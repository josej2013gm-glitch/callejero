// Simulacro de «rellenar el mapa mudo»: se numeran N vías en un mapa sin nombres y hay
// que escribir el nombre de cada una. Lógica pura (selección de vías y corrección).

import { eligibleStreets } from './model.js';
import { haversine, normName } from './geo.js';

// Palabras de tipo de vía y artículos que no se exigen al escribir el nombre
const TYPE_WORDS = new Set(['calle', 'c', 'cl', 'avenida', 'avda', 'av', 'plaza', 'pza', 'pl', 'paseo', 'ps', 'camino', 'cm', 'carretera', 'ctra', 'travesia', 'trv', 'ronda', 'glorieta', 'callejon', 'pasaje', 'pje', 'rambla', 'calleja', 'cuesta', 'senda', 'via', 'bulevar', 'urbanizacion', 'urb', 'barrio', 'jardin', 'jardines', 'parque', 'placeta', 'plazuela', 'subida', 'bajada', 'vereda', 'puerto', 'paraje']);
const ARTICLES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'al', 'en']);

/** Núcleo del nombre: sin tipo de vía ni artículos, normalizado. «Calle de la Gloria» → «gloria». */
export function nameCore(s) {
  const toks = normName(s).split(' ').filter(Boolean);
  while (toks.length > 1 && TYPE_WORDS.has(toks[0])) toks.shift();
  const core = toks.filter((t) => !ARTICLES.has(t));
  return (core.length ? core : toks).join(' ');
}

/** ¿La respuesta escrita corresponde a la vía? Admite omitir el tipo de vía, artículos y tildes. */
export function nameMatches(answer, street) {
  const a = normName(answer);
  if (!a) return false;
  const names = [street.name, street.osmName, ...(street.alt || [])].filter(Boolean);
  return names.some((n) => normName(n) === a || nameCore(n) === nameCore(answer));
}

/**
 * Elige n vías para numerar: con nombre propio, de al menos 60 m, sin nombres repetidos
 * (ni núcleos de nombre repetidos) y separadas entre sí para que los números no se solapen.
 * Por defecto se limita al centro urbano y se amplía alrededor del centro si no hay bastantes.
 */
export function pickStreets(model, { n = 20, zoneId = null, includeRural = false, onlyVerified = false, rng = Math.random, minSep = 80 } = {}) {
  const base = eligibleStreets(model, { includeRural, onlyVerified }).filter((s) => !s.refOnly && s.length >= 60);
  let pool;
  if (zoneId) pool = base.filter((s) => s.zones?.includes(zoneId));
  else {
    // Centro y alrededores: las vías más cercanas al centro hasta tener margen de elección
    pool = base.slice().sort((a, b) => (a.dc ?? 1e9) - (b.dc ?? 1e9)).slice(0, Math.max(n * 3, 40));
  }
  const coreCount = {};
  for (const s of base) { const k = nameCore(s.name); coreCount[k] = (coreCount[k] || 0) + 1; }
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const chosen = [], cores = new Set();
  for (const s of shuffled) {
    const k = nameCore(s.name);
    if (coreCount[k] > 1 || cores.has(k)) continue; // nombre ambiguo en el municipio
    if (chosen.some((c) => haversine(c.mid, s.mid) < minSep)) continue;
    chosen.push(s); cores.add(k);
    if (chosen.length === n) break;
  }
  return chosen.map((s) => s.id);
}

/** Corrige y puntúa. answers: textos en el orden de ids. exam: { max, pass }. */
export function scoreMapaMudo(model, ids, answers, exam = { max: 10, pass: 5 }) {
  const items = ids.map((id, i) => {
    const s = model.street.get(id);
    const a = (answers[i] || '').trim();
    const ok = a ? nameMatches(a, s) : null;
    return { id, answer: a, ok, correct: s.label };
  });
  const correct = items.filter((x) => x.ok === true).length;
  const blank = items.filter((x) => x.ok === null).length;
  const wrong = items.length - correct - blank;
  const max = exam.max || 10;
  const nota = items.length ? Math.round((correct / items.length) * max * 100) / 100 : 0;
  return {
    items,
    score: { n: items.length, correct, wrong, blank, raw: nota, nota, max, escalada: nota, sobre2: Math.round((nota / max) * 2 * 1000) / 1000, pct: items.length ? Math.round((correct / items.length) * 1000) / 10 : 0, aprobado: exam.pass != null ? nota >= exam.pass : null },
  };
}
