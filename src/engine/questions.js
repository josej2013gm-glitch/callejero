// Generador automático de preguntas, sin IA: todo sale de las geometrías y relaciones
// del modelo. Si no hay datos suficientes para una pregunta fiable, devuelve null.
//
// Garantías de cada pregunta de opción múltiple:
//  · 4 alternativas con etiquetas distintas y exactamente 1 correcta según los datos;
//  · los distractores se eligen por criterios geográficos (distancia, orientación, cruces)
//    y se comprueba que NO cumplen la condición del enunciado, con un margen de seguridad;
//  · se registran las entidades usadas (refs) y los conceptos que se repasarán.

import { eligibleStreets, pairKey, CLS_LABEL, TRUSTED } from './model.js';
import { axisDiff, bearing, cardinalOf, CARDINALS, haversine } from './geo.js';

export const TYPES = [
  { key: 'localizar', name: 'Localizar una calle en el mapa', map: true, desc: 'Se marcan cuatro vías y debes señalar la que se pide (o tocarla en el mapa).' },
  { key: 'identificar', name: 'Identificar una calle resaltada', map: true, desc: 'Mapa sin nombres con una vía resaltada: elige su nombre.' },
  { key: 'cruces', name: 'Cruces de calles', map: false, desc: 'Qué vías se cruzan o enlazan entre sí (y qué cruce está señalado).' },
  { key: 'proximas', name: 'Calles próximas', map: false, desc: 'Qué vía está a menos de 100 m de otra.' },
  { key: 'paralelas', name: 'Calles paralelas', map: false, desc: 'Qué vía discurre paralela a otra.' },
  { key: 'perpendiculares', name: 'Calles perpendiculares', map: false, desc: 'Qué vía cruza en ángulo recto a otra.' },
  { key: 'edificios', name: 'Edificios públicos y servicios', map: false, desc: 'Dónde está cada edificio y qué hay en cada calle.' },
  { key: 'accesos', name: 'Accesos y vías principales', map: false, desc: 'Carreteras, referencias y enlaces con las vías principales.' },
  { key: 'orientacion', name: 'Orientación', map: false, desc: 'Puntos cardinales entre lugares y posición relativa de calles.' },
  { key: 'recorridos', name: 'Recorridos', map: false, desc: 'Qué vía conecta dos calles que no se cruzan.' },
];
export const TYPE_NAME = Object.fromEntries(TYPES.map((t) => [t.key, t.name]));

// Modalidades que entran en los simulacros y reparto del simulacro oficial (20 preguntas)
export const SIM_TYPES = ['localizar', 'identificar', 'cruces', 'edificios', 'accesos'];
export const OFFICIAL_MIX = { localizar: 4, identificar: 4, cruces: 5, edificios: 5, accesos: 2 };
// Variante «solo texto»: sin las modalidades que necesitan mapa
export const OFFICIAL_MIX_TEXT = { cruces: 8, edificios: 8, accesos: 4 };

// Bandas de distancia (m) para distractores según dificultad
const BANDS = {
  generic: { 1: [250, 1500], 2: [100, 800], 3: [30, 400] },
  visible: { 1: [80, 500], 2: [40, 350], 3: [15, 220] },
  noCross: { 1: [150, 1000], 2: [60, 500], 3: [15, 250] },
  far: { 1: [500, 1500], 2: [350, 1000], 3: [300, 700] },
  poi: { 1: [400, 1500], 2: [200, 800], 3: [120, 500] },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGenerator(model, opts = {}) {
  const rng = opts.rng || mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
  const settings = { includeRural: false, onlyVerified: false, zoneId: null, ...(opts.settings || {}) };
  const elig = eligibleStreets(model, settings);
  const eligAll = eligibleStreets(model, { ...settings, zoneId: null }); // distractores: todo el municipio
  const eligSet = new Set(elig.map((s) => s.id));
  const eligAllSet = new Set(eligAll.map((s) => s.id));
  const S = (id) => model.street.get(id);
  const pois = model.pois.filter((p) => !['excluido', 'dudoso'].includes(p.ver.status) && !p.dup && (!settings.onlyVerified || TRUSTED.has(p.ver.status)));
  const poisInZone = settings.zoneId ? pois.filter((p) => p.zones?.includes(settings.zoneId)) : pois;

  const pickOne = (arr) => arr[Math.floor(rng() * arr.length)];
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const byImportance = elig.slice().sort((a, b) => b.importance - a.importance);
  function targetPool(diff, filter = () => true) {
    const pool = byImportance.filter((s) => !s.refOnly && filter(s));
    if (diff === 1) return pool.slice(0, Math.max(4, Math.ceil(pool.length * 0.35)));
    if (diff === 3) return pool.slice(Math.floor(pool.length * 0.4));
    return pool;
  }
  const firstWord = (s) => s.name.split(' ')[0].toLowerCase();

  /** Distractores de tipo «vía» a una distancia mínima [min,max] de la vía base. */
  function streetCandidates(baseId, [min, max], { exclude = new Set(), extra = () => true, from = eligAll } = {}) {
    const base = S(baseId);
    const out = [];
    for (const s of from) {
      if (s.id === baseId || exclude.has(s.id) || s.key === base.key || s.refOnly) continue;
      if (model.bboxDist(baseId, s.id) > max) continue;
      const d = model.minDist(baseId, s.id);
      if (d < min || d > max) continue;
      if (!extra(s, d)) continue;
      out.push(s);
    }
    return out;
  }
  /** Elige 3 distractores con etiquetas distintas, priorizando el mismo tipo de vía. */
  function choose3(cands, target, usedKeys = new Set()) {
    const keys = new Set([target.key, ...usedKeys]);
    const same = shuffle(cands.filter((s) => firstWord(s) === firstWord(target)));
    const other = shuffle(cands.filter((s) => firstWord(s) !== firstWord(target)));
    const out = [];
    for (const s of [...same, ...other]) {
      if (keys.has(s.key)) continue;
      keys.add(s.key); out.push(s);
      if (out.length === 3) break;
    }
    return out.length === 3 ? out : null;
  }

  function verStatus(...ents) {
    const st = ents.filter(Boolean).map((e) => e.ver?.status || 'importado');
    return st.every((x) => TRUSTED.has(x)) ? 'verificado' : 'importado';
  }

  function mk(type, diff, prompt, correct, distractors, extra = {}) {
    const opts = shuffle([{ ...correct, ok: true }, ...distractors.map((d) => ({ ...d, ok: false }))]);
    const labels = new Set(opts.map((o) => o.label));
    if (opts.length !== 4 || labels.size !== 4) return null;
    return {
      id: extra.id, type, cat: type, diff, prompt,
      options: opts.map((o) => ({ label: o.label, ref: o.ref || null })),
      answer: opts.findIndex((o) => o.ok),
      explanation: extra.explanation || '',
      refs: extra.refs || {}, map: extra.map || null, concepts: extra.concepts || [],
      data: extra.data || 'importado', created: Date.now(),
    };
  }
  const opt = (s) => ({ label: s.label, ref: s.id });
  const m = (n) => `${Math.round(n)} m`;
  const zoneTxt = (s) => (s.zone && model.zone.get(s.zone) ? ` (${model.zone.get(s.zone).name})` : '');

  // ---------------- Generadores ----------------
  const G = {};

  G.identificar = (diff, focus) => {
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff));
    if (!T) return null;
    const d3 = choose3(streetCandidates(T.id, BANDS.generic[diff]), T) || choose3(streetCandidates(T.id, [15, 1500]), T);
    if (!d3) return null;
    return mk('identificar', diff, '¿Cómo se llama la vía resaltada en el mapa?', opt(T), d3.map(opt), {
      id: 'identificar:' + T.id,
      explanation: `La vía resaltada es ${T.label}: ${CLS_LABEL[T.cls] || 'vía'} de unos ${m(T.length)}${zoneTxt(T)}.`,
      refs: { streets: [T.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id],
      map: { mode: 'highlight', streets: [T.id], focus: [T.id], radius: diff === 1 ? 500 : 300 },
      data: verStatus(T, ...d3),
    });
  };

  G.localizar = (diff, focus) => {
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff));
    if (!T) return null;
    const cands = streetCandidates(T.id, BANDS.visible[diff], { extra: (s) => s.length >= 40 });
    const d3 = choose3(cands, T) || choose3(streetCandidates(T.id, [15, 600], { extra: (s) => s.length >= 40 }), T);
    if (!d3) return null;
    // Las cuatro vías marcadas no deben tener el mismo nombre ni solaparse
    const marked = shuffle([T, ...d3]);
    const letters = ['A', 'B', 'C', 'D'];
    const q = {
      id: 'localizar:' + T.id, type: 'localizar', cat: 'localizar', diff,
      prompt: `¿Cuál de las vías marcadas en el mapa es ${T.label}?`,
      options: marked.map((s, i) => ({ label: `Vía ${letters[i]}`, ref: s.id })),
      answer: marked.indexOf(T),
      explanation: `${T.label} es la vía ${letters[marked.indexOf(T)]}. Las otras son: ${marked.filter((s) => s !== T).map((s) => `${letters[marked.indexOf(s)]} = ${s.label}`).join('; ')}.`,
      refs: { streets: [T.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id],
      map: { mode: 'choices', streets: marked.map((s) => s.id), letters, focus: marked.map((s) => s.id) },
      tap: { kind: 'street', id: T.id, tol: 25 },
      data: verStatus(...marked), created: Date.now(),
    };
    return q;
  };

  /** Variante de toque: «toca en el mapa la calle X» (solo entrenamiento y mapa mudo). */
  G.localizarTap = (diff, focus) => {
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff));
    if (!T) return null;
    return {
      id: 'tap:' + T.id, type: 'localizar', cat: 'localizar', diff, prompt: `Toca en el mapa la vía ${T.label}.`,
      options: null, answer: null, tap: { kind: 'street', id: T.id, tol: 25 },
      explanation: `${T.label}: ${CLS_LABEL[T.cls] || 'vía'} de unos ${m(T.length)}${zoneTxt(T)}.`,
      refs: { streets: [T.id] }, concepts: ['st:' + T.id],
      map: { mode: 'tap', streets: [], focus: [T.id], radius: diff === 1 ? 700 : 450, jitter: true },
      data: verStatus(T), created: Date.now(),
    };
  };

  G.cruces = (diff, focus) => {
    if (!focus && rng() < 0.3) { const q = G.crucePunto(diff); if (q) return q; }
    let T, Y;
    if (focus?.pair) { const p = model.pair.get(focus.pair); if (!p) return null; [T, Y] = rng() < 0.5 ? [S(p.a), S(p.b)] : [S(p.b), S(p.a)]; }
    else {
      T = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => [...model.inter.get(s.id)].some((x) => eligAllSet.has(x))));
      if (!T) return null;
      const ys = [...model.inter.get(T.id)].filter((x) => eligAllSet.has(x) && S(x).key !== T.key && !S(x).refOnly);
      if (!ys.length) return null;
      Y = S(pickOne(ys));
    }
    if (!T || !Y) return null;
    // Excluir cualquier vía que comparta nombre con alguna que cruce T
    const crossKeys = new Set([...model.inter.get(T.id)].map((x) => S(x).key));
    const cands = streetCandidates(T.id, BANDS.noCross[diff], { extra: (s) => !crossKeys.has(s.key) && !model.intersects(T.id, s.id) });
    const d3 = choose3(cands, Y, new Set([T.key]));
    if (!d3) return null;
    const p = model.pairOf(T.id, Y.id);
    const closest = Math.min(...d3.map((s) => model.minDist(T.id, s.id)));
    return mk('cruces', diff, `¿Cuál de las siguientes vías se cruza o enlaza con ${T.label}?`, opt(Y), d3.map(opt), {
      id: 'cruces:' + pairKey(T.id, Y.id),
      explanation: `${Y.label} se cruza o enlaza con ${T.label}${p?.angle != null ? ` (ángulo aproximado de ${p.angle}°)` : ''}. Ninguna de las otras toca ${T.label}: la más cercana queda a unos ${m(closest)}.`,
      refs: { streets: [T.id, Y.id, ...d3.map((s) => s.id)], pairs: [pairKey(T.id, Y.id)] },
      concepts: ['st:' + T.id, 'st:' + Y.id, 'ix:' + pairKey(T.id, Y.id)],
      map: { mode: 'reveal', streets: [T.id, Y.id], focus: [T.id, Y.id], points: p ? [p.c] : [] },
      data: verStatus(T, Y, p, ...d3),
    });
  };

  G.crucePunto = (diff, focus) => {
    const cand = [...model.pair.values()].filter((p) => p.iso && p.ver.status !== 'erroneo' && eligSet.has(p.a) && eligSet.has(p.b) && S(p.a).key !== S(p.b).key && !S(p.a).refOnly && !S(p.b).refOnly);
    const P = focus?.pair ? model.pair.get(focus.pair) : pickOne(diff === 1 ? cand.filter((p) => S(p.a).importance + S(p.b).importance > 6) : cand);
    if (!P) return null;
    const A = S(P.a), B = S(P.b);
    const lab = (x, y) => [x.label, y.label].sort((u, v) => u.localeCompare(v, 'es')).join(' y ');
    const near = [...model.pair.values()].filter((o) => o.id !== P.id && o.ver.status !== 'erroneo' && haversine(o.c, P.c) > 40 && haversine(o.c, P.c) < (diff === 3 ? 300 : 700) && S(o.a).key !== S(o.b).key && !(S(o.a).key === A.key && S(o.b).key === B.key) && !(S(o.a).key === B.key && S(o.b).key === A.key));
    const used = new Set([lab(A, B)]);
    const d3 = [];
    for (const o of shuffle(near)) {
      const l = lab(S(o.a), S(o.b));
      if (used.has(l)) continue;
      used.add(l); d3.push({ label: l, ref: o.id });
      if (d3.length === 3) break;
    }
    if (d3.length < 3) return null;
    return mk('cruces', diff, '¿Qué dos vías se cruzan en el punto señalado en el mapa?', { label: lab(A, B), ref: P.id }, d3, {
      id: 'crucepunto:' + P.id,
      explanation: `En el punto señalado se cruzan ${A.label} y ${B.label}. Las otras parejas se cruzan en puntos distintos, a más de 40 m.`,
      refs: { streets: [A.id, B.id], pairs: [P.id, ...d3.map((d) => d.ref)] }, concepts: ['ix:' + P.id, 'st:' + A.id, 'st:' + B.id],
      map: { mode: 'point', streets: [], points: [P.c], focus: [A.id, B.id], radius: 250 },
      data: verStatus(A, B, P),
    });
  };

  G.proximas = (diff, focus) => {
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => [...model.near.get(s.id)].some(([, d]) => d <= 60)));
    if (!T) return null;
    const close = [...model.near.get(T.id)].filter(([id, d]) => d <= 60 && eligAllSet.has(id) && S(id).key !== T.key && !S(id).refOnly);
    if (!close.length) return null;
    // Preferir vías próximas que no se cruzan con T (más instructivo); si no, cualquiera
    const nonCross = close.filter(([id]) => !model.intersects(T.id, id));
    const [yid, yd] = pickOne(nonCross.length ? nonCross : close);
    const Y = S(yid);
    const closeKeys = new Set(close.map(([id]) => S(id).key));
    const d3 = choose3(streetCandidates(T.id, BANDS.far[diff], { extra: (s) => !closeKeys.has(s.key) }), Y, new Set([T.key]));
    if (!d3) return null;
    const minOther = Math.min(...d3.map((s) => model.minDist(T.id, s.id)));
    return mk('proximas', diff, `¿Cuál de estas vías se encuentra a menos de 100 m de ${T.label}?`, opt(Y), d3.map(opt), {
      id: 'proximas:' + pairKey(T.id, Y.id),
      explanation: `${Y.label} está a ${yd === 0 ? 'contacto con' : 'unos ' + m(yd) + ' de'} ${T.label}. Las demás quedan a ${m(minOther)} o más.`,
      refs: { streets: [T.id, Y.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id, 'st:' + Y.id, 'rel:prox:' + pairKey(T.id, Y.id)],
      map: { mode: 'reveal', streets: [T.id, Y.id], focus: [T.id, Y.id] },
      data: verStatus(T, Y, ...d3),
    });
  };

  G.paralelas = (diff, focus) => {
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => [...model.par.get(s.id)].some((x) => eligAllSet.has(x))));
    if (!T) return null;
    const ys = [...model.par.get(T.id)].filter((x) => eligAllSet.has(x) && S(x).key !== T.key);
    if (!ys.length) return null;
    const Y = S(pickOne(ys));
    const parKeys = new Set(ys.map((x) => S(x).key));
    const cands = streetCandidates(T.id, [0, 500], { extra: (s) => !parKeys.has(s.key) && s.straight >= 0.75 && s.length >= 60 && axisDiff(s.axis, T.axis) >= 40 });
    const d3 = choose3(cands, Y, new Set([T.key]));
    if (!d3) return null;
    return mk('paralelas', diff, `¿Cuál de las siguientes vías discurre paralela (o casi paralela) a ${T.label}?`, opt(Y), d3.map(opt), {
      id: 'paralelas:' + pairKey(T.id, Y.id),
      explanation: `${Y.label} sigue la misma orientación que ${T.label} (diferencia de ${Math.round(axisDiff(T.axis, Y.axis))}°) y la separan unos ${m(model.minDist(T.id, Y.id))}. Las demás forman ángulos de 40° o más con ella.`,
      refs: { streets: [T.id, Y.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id, 'st:' + Y.id, 'rel:par:' + pairKey(T.id, Y.id)],
      map: { mode: 'reveal', streets: [T.id, Y.id], focus: [T.id, Y.id] },
      data: verStatus(T, Y, ...d3),
    });
  };

  G.perpendiculares = (diff, focus) => {
    const perpOf = (id) => [...model.inter.get(id)].filter((x) => eligAllSet.has(x) && model.pairOf(id, x)?.perp && S(x).key !== S(id).key && !S(x).refOnly);
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => s.straight >= 0.6 && perpOf(s.id).length > 0));
    if (!T) return null;
    const ys = perpOf(T.id);
    if (!ys.length) return null;
    const Y = S(pickOne(ys));
    const crossKeys = new Set([...model.inter.get(T.id)].map((x) => S(x).key));
    const base = { extra: (s) => !crossKeys.has(s.key) && s.straight >= 0.75 && s.length >= 60 && axisDiff(s.axis, T.axis) <= 20 };
    let d3 = choose3(streetCandidates(T.id, [15, 500], base), Y, new Set([T.key]));
    if (!d3) d3 = choose3(streetCandidates(T.id, [15, 800], { extra: (s) => !crossKeys.has(s.key) && axisDiff(s.axis, T.axis) <= 30 && s.straight >= 0.7 }), Y, new Set([T.key]));
    if (!d3) return null;
    const p = model.pairOf(T.id, Y.id);
    return mk('perpendiculares', diff, `¿Cuál de estas vías cruza de forma perpendicular a ${T.label}?`, opt(Y), d3.map(opt), {
      id: 'perpendiculares:' + pairKey(T.id, Y.id),
      explanation: `${Y.label} cruza ${T.label} formando un ángulo de unos ${p.angle}°. Las demás no llegan a cruzarse con ella y siguen una dirección casi paralela.`,
      refs: { streets: [T.id, Y.id, ...d3.map((s) => s.id)], pairs: [p.id] }, concepts: ['st:' + T.id, 'st:' + Y.id, 'ix:' + p.id, 'rel:perp:' + p.id],
      map: { mode: 'reveal', streets: [T.id, Y.id], focus: [T.id, Y.id], points: [p.c] },
      data: verStatus(T, Y, p, ...d3),
    });
  };

  G.edificios = (diff, focus) => {
    const variants = focus?.poi ? ['donde', 'mapaPoi'] : focus?.street ? ['queHay'] : shuffle(['donde', 'donde', 'queHay', 'mapaPoi']);
    for (const v of variants) { const q = G['edif_' + v](diff, focus); if (q) return q; }
    return null;
  };
  G.edif_donde = (diff, focus) => {
    const cands = poisInZone.filter((p) => p.street && eligAllSet.has(p.street));
    const P = focus?.poi ? model.poi.get(focus.poi) : pickOne(diff === 1 ? cands.filter((p) => p.pub) : cands);
    if (!P || !P.street || !eligAllSet.has(P.street)) return null;
    const Y = S(P.street);
    const [mn, mx] = BANDS.poi[diff];
    const cs = eligAll.filter((s) => s.key !== Y.key && !s.refOnly && haversine(s.mid, P.c) < mx + s.length / 2).filter((s) => { const d = model.poiDist(P.id, s.id); return d >= mn && d <= mx; });
    const d3 = choose3(cs, Y);
    if (!d3) return null;
    const how = P.streetMethod === 'addr:street' ? `Según la dirección registrada en OpenStreetMap (${P.addr}).`
      : `Es la vía más próxima al edificio (unos ${m(P.streetDist)}); la siguiente vía queda bastante más lejos.`;
    return mk('edificios', diff, `¿En qué vía se encuentra ${P.name}?`, opt(Y), d3.map(opt), {
      id: 'donde:' + P.id,
      explanation: `${P.name} (${P.cat}) se encuentra en ${Y.label}. ${how} Las otras vías están a ${m(mn)} o más.`,
      refs: { streets: [Y.id, ...d3.map((s) => s.id)], pois: [P.id] }, concepts: ['poi:' + P.id, 'st:' + Y.id],
      map: { mode: 'reveal', streets: [Y.id], pois: [P.id], focus: [Y.id] },
      data: verStatus(P, Y, ...d3),
    });
  };
  G.edif_queHay = (diff, focus) => {
    const streetsWithPoi = [...model.poisOf.keys()].filter((id) => eligSet.has(id) && model.poisOf.get(id).some((p) => pois.includes(p)));
    if (focus?.street && !model.poisOf.has(focus.street)) return null;
    const sid = focus?.street || pickOne(streetsWithPoi);
    if (!sid) return null;
    const Y = S(sid);
    const own = model.poisOf.get(sid).filter((p) => pois.includes(p));
    if (!own.length) return null;
    const P = pickOne(own);
    const ownNames = new Set(own.map((p) => p.name));
    const others = shuffle(pois.filter((p) => !ownNames.has(p.name) && p.street !== sid && model.poiDist(p.id, sid) >= 250));
    const sameCat = others.filter((p) => p.cat === P.cat);
    const d3 = [];
    const used = new Set([P.name]);
    for (const p of [...sameCat, ...others]) { if (used.has(p.name)) continue; used.add(p.name); d3.push(p); if (d3.length === 3) break; }
    if (d3.length < 3) return null;
    return mk('edificios', diff, `¿Cuál de estos edificios o servicios se encuentra en ${Y.label}?`, { label: P.name, ref: P.id }, d3.map((p) => ({ label: p.name, ref: p.id })), {
      id: 'quehay:' + P.id,
      explanation: `${P.name} está en ${Y.label}. Los demás se encuentran a más de 250 m de esa vía${d3.some((p) => p.street) ? ': ' + d3.filter((p) => p.street).map((p) => `${p.name} en ${S(p.street).label}`).join('; ') : ''}.`,
      refs: { streets: [Y.id], pois: [P.id, ...d3.map((p) => p.id)] }, concepts: ['poi:' + P.id, 'st:' + Y.id],
      map: { mode: 'reveal', streets: [Y.id], pois: [P.id], focus: [Y.id] },
      data: verStatus(P, Y, ...d3),
    });
  };
  G.edif_mapaPoi = (diff, focus) => {
    const P = focus?.poi ? model.poi.get(focus.poi) : pickOne(diff === 1 ? poisInZone.filter((p) => p.pub) : poisInZone);
    if (!P) return null;
    const others = shuffle(pois.filter((p) => p.id !== P.id && p.name !== P.name && haversine(p.c, P.c) >= 300));
    const pref = others.filter((p) => p.cat === P.cat);
    const d3 = []; const used = new Set([P.name]);
    for (const p of [...pref, ...others]) { if (used.has(p.name)) continue; used.add(p.name); d3.push(p); if (d3.length === 3) break; }
    if (d3.length < 3) return null;
    return mk('edificios', diff, '¿Qué edificio o servicio está señalado en el mapa?', { label: P.name, ref: P.id }, d3.map((p) => ({ label: p.name, ref: p.id })), {
      id: 'mapapoi:' + P.id,
      explanation: `El punto señalado es ${P.name} (${P.cat})${P.street ? ', en ' + S(P.street).label : ''}. Los demás están a 300 m o más.`,
      refs: { pois: [P.id, ...d3.map((p) => p.id)] }, concepts: ['poi:' + P.id],
      map: { mode: 'poi', streets: [], pois: [P.id], focusPoint: P.c, radius: 350, showPoiLabel: false },
      data: verStatus(P),
    });
  };

  G.accesos = (diff, focus) => {
    for (const v of focus ? ['enlace'] : shuffle(['ref', 'enlace', 'enlace', 'clase'])) { const q = G['acc_' + v](diff, focus); if (q) return q; }
    return null;
  };
  const mains = () => eligAll.filter((s) => s.cls === 'principal' || s.ref);
  G.acc_ref = (diff) => {
    const withRef = mains().filter((s) => s.ref && !s.refOnly);
    const T = pickOne(withRef);
    if (!T) return null;
    const refs = T.ref.split(';');
    const ref = pickOne(refs);
    const sharing = new Set(eligAll.filter((s) => s.ref && s.ref.split(';').includes(ref)).map((s) => s.key));
    const cands = eligAll.filter((s) => !sharing.has(s.key) && !s.refOnly && (s.cls === 'principal' || s.cls === 'secundaria'));
    const d3 = choose3(cands, T);
    if (!d3) return null;
    return mk('accesos', diff, `En la cartografía de OpenStreetMap, ¿qué nombre tiene el tramo de vía con referencia ${ref}?`, opt(T), d3.map(opt), {
      id: 'ref:' + T.id + ':' + ref,
      explanation: `${T.label} lleva la referencia ${ref} en OSM. Las demás no tienen esa referencia.`,
      refs: { streets: [T.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id],
      map: { mode: 'reveal', streets: [T.id], focus: [T.id] }, data: verStatus(T, ...d3),
    });
  };
  G.acc_enlace = (diff, focus) => {
    const M = mains();
    const mainSet = new Set(M.map((s) => s.id));
    const T = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => !mainSet.has(s.id) && [...model.inter.get(s.id)].some((x) => mainSet.has(x))));
    if (!T) return null;
    const ys = [...model.inter.get(T.id)].filter((x) => mainSet.has(x) && S(x).key !== T.key);
    if (!ys.length) return null;
    const Y = S(pickOne(ys));
    const crossKeys = new Set([...model.inter.get(T.id)].map((x) => S(x).key));
    const cands = M.filter((s) => !crossKeys.has(s.key) && s.key !== T.key && !s.refOnly && model.minDist(T.id, s.id) >= 30);
    const d3 = choose3(cands, Y, new Set([T.key]));
    if (!d3) return null;
    return mk('accesos', diff, `¿Con cuál de estas vías principales enlaza ${T.label}?`, opt(Y), d3.map(opt), {
      id: 'enlace:' + pairKey(T.id, Y.id),
      explanation: `${T.label} se cruza o enlaza con ${Y.label}. Las demás vías principales no llegan a tocarla.`,
      refs: { streets: [T.id, Y.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + T.id, 'st:' + Y.id, 'ix:' + pairKey(T.id, Y.id)],
      map: { mode: 'reveal', streets: [T.id, Y.id], focus: [T.id, Y.id] }, data: verStatus(T, Y, ...d3),
    });
  };
  G.acc_clase = (diff) => {
    const M = mains().filter((s) => !s.refOnly && s.cls === 'principal');
    const Y = pickOne(M);
    if (!Y) return null;
    const cands = eligAll.filter((s) => ['local', 'peatonal'].includes(s.cls) && !s.ref && !s.refOnly && s.length >= 150);
    const d3 = choose3(cands, Y);
    if (!d3) return null;
    return mk('accesos', diff, '¿Cuál de las siguientes es una vía principal (carretera o arteria) según la clasificación de OpenStreetMap?', opt(Y), d3.map(opt), {
      id: 'clase:' + Y.id,
      explanation: `${Y.label} está clasificada como vía principal (highway=${Y.highway}). Las demás son calles locales o peatonales.`,
      refs: { streets: [Y.id, ...d3.map((s) => s.id)] }, concepts: ['st:' + Y.id],
      map: { mode: 'reveal', streets: [Y.id], focus: [Y.id] }, data: verStatus(Y, ...d3),
    });
  };

  G.orientacion = (diff, focus) => {
    for (const v of focus?.poi ? ['dir'] : shuffle(['dir', 'extremo'])) { const q = G['ori_' + v](diff, focus); if (q) return q; }
    return null;
  };
  G.ori_dir = (diff, focus) => {
    const refs = poisInZone.length >= 2 ? poisInZone : pois;
    for (let tries = 0; tries < 30; tries++) {
      const A = focus?.poi ? model.poi.get(focus.poi) : pickOne(refs);
      const B = pickOne(pois);
      if (!A || !B || A.id === B.id || A.name === B.name) continue;
      const d = haversine(A.c, B.c);
      if (d < 300 || d > 3000) continue;
      const br = bearing(A.c, B.c);
      const card = cardinalOf(br, 25);
      if (!card) continue;
      const options = CARDINALS.map((c) => ({ label: c.name, ok: c.key === card.key }));
      return {
        id: 'dir:' + A.id + '>' + B.id, type: 'orientacion', cat: 'orientacion', diff,
        prompt: `Desde ${A.name}, ¿en qué dirección se encuentra ${B.name}?`,
        options: options.map((o) => ({ label: o.label, ref: null })), answer: options.findIndex((o) => o.ok),
        explanation: `${B.name} está a unos ${m(d)} de ${A.name}, con rumbo ${Math.round(br)}° (${card.name.toLowerCase()}; 0° = norte, 90° = este).`,
        refs: { pois: [A.id, B.id] }, concepts: ['poi:' + A.id, 'poi:' + B.id, 'rel:dir:' + A.id + '|' + B.id],
        map: { mode: 'reveal', streets: [], pois: [A.id, B.id], focusPoints: [A.c, B.c] },
        data: verStatus(A, B), created: Date.now(),
      };
    }
    return null;
  };
  G.ori_extremo = (diff) => {
    const dirs = [
      { k: 'norte', v: (s) => s.mid[1], sign: 1, m: 111320 }, { k: 'sur', v: (s) => s.mid[1], sign: -1, m: 111320 },
      { k: 'este', v: (s) => s.mid[0], sign: 1, m: 111320 * 0.78 }, { k: 'oeste', v: (s) => s.mid[0], sign: -1, m: 111320 * 0.78 },
    ];
    for (let tries = 0; tries < 25; tries++) {
      const dir = pickOne(dirs);
      const anchor = pickOne(targetPool(diff, (s) => s.length <= 600));
      if (!anchor) return null;
      const area = shuffle(elig.filter((s) => !s.refOnly && s.length <= 600 && haversine(s.mid, anchor.mid) < (diff === 3 ? 600 : 1200)));
      const chosen = [];
      for (const s of area) {
        if (chosen.some((c) => c.key === s.key || Math.abs(dir.v(c) - dir.v(s)) * dir.m < 150)) continue;
        chosen.push(s); if (chosen.length === 4) break;
      }
      if (chosen.length < 4) continue;
      chosen.sort((a, b) => dir.sign * (dir.v(b) - dir.v(a)));
      const [Y, ...rest] = chosen;
      const gap = Math.round(Math.abs(dir.v(Y) - dir.v(rest[0])) * dir.m);
      return mk('orientacion', diff, `¿Cuál de estas vías está situada más al ${dir.k}?`, opt(Y), rest.map(opt), {
        id: 'extremo:' + dir.k + ':' + chosen.map((s) => s.id).sort().join(','),
        explanation: `Comparando el punto medio de cada vía, ${Y.label} es la que queda más al ${dir.k}, unos ${m(gap)} por delante de la siguiente (${rest[0].label}).`,
        refs: { streets: chosen.map((s) => s.id) }, concepts: chosen.map((s) => 'st:' + s.id).slice(0, 2),
        map: { mode: 'reveal', streets: chosen.map((s) => s.id), focus: chosen.map((s) => s.id), labels: true },
        data: verStatus(...chosen),
      });
    }
    return null;
  };

  G.recorridos = (diff, focus) => {
    for (let tries = 0; tries < 40; tries++) {
      const Z = focus?.street ? S(focus.street) : pickOne(targetPool(diff, (s) => model.inter.get(s.id).size >= 2));
      if (!Z) return null;
      const xs = [...model.inter.get(Z.id)].filter((x) => eligAllSet.has(x) && !S(x).refOnly && S(x).key !== Z.key);
      if (xs.length < 2) { if (focus) return null; continue; }
      const X = S(pickOne(xs));
      const ys = xs.filter((y) => y !== X.id && S(y).key !== X.key && !model.intersects(X.id, y) && model.minDist(X.id, y) >= 80);
      if (!ys.length) { if (focus) return null; continue; }
      const Y = S(pickOne(ys));
      const connectsBoth = (s) => model.intersects(X.id, s.id) && model.intersects(Y.id, s.id);
      const bothKeys = new Set(eligAll.filter(connectsBoth).map((s) => s.key));
      const cands = eligAll.filter((s) => s.id !== X.id && s.id !== Y.id && !bothKeys.has(s.key) && s.key !== X.key && s.key !== Y.key && !s.refOnly && (model.intersects(X.id, s.id) || model.intersects(Y.id, s.id)));
      const d3 = choose3(cands, Z, new Set([X.key, Y.key]));
      if (!d3) { if (focus) return null; continue; }
      return mk('recorridos', diff, `Circulas por ${X.label} y quieres llegar a ${Y.label}, que no se cruzan entre sí. ¿Qué vía conecta directamente ambas?`, opt(Z), d3.map(opt), {
        id: 'recorrido:' + [X.id, Y.id].sort().join('>') + ':' + Z.id,
        explanation: `${Z.label} se cruza con ${X.label} y con ${Y.label}. Las demás solo enlazan con una de las dos. (No se consideran sentidos de circulación.)`,
        refs: { streets: [X.id, Y.id, Z.id, ...d3.map((s) => s.id)] },
        concepts: ['st:' + Z.id, 'ix:' + pairKey(X.id, Z.id), 'ix:' + pairKey(Y.id, Z.id), 'rel:ruta:' + pairKey(X.id, Y.id)],
        map: { mode: 'reveal', streets: [X.id, Y.id, Z.id], focus: [X.id, Y.id, Z.id] },
        data: verStatus(X, Y, Z, ...d3),
      });
    }
    return null;
  };

  // ---------------- API ----------------
  function generate(type, { diff = 2, focus = null, tap = false } = {}) {
    const fn = tap && type === 'localizar' ? G.localizarTap : G[type];
    if (!fn) return null;
    for (let i = 0; i < (focus ? 4 : 12); i++) {
      try { const q = fn(diff, focus); if (q && validate(q)) return q; } catch (e) { if (opts.debug) console.error(e); }
    }
    return null;
  }

  /** Lote de preguntas sin duplicados. mix: {tipo: cantidad}. */
  function batch(mix, { diff = 2, mixedDiff = false, textOnly = false } = {}) {
    const out = [], ids = new Set();
    const plan = [];
    for (const [t, n] of Object.entries(mix)) for (let i = 0; i < n; i++) plan.push(t);
    // Si una modalidad no da más preguntas, se completa SOLO con las otras modalidades del reparto
    const fallback = Object.keys(mix).filter((k) => !textOnly || !TYPES.find((t) => t.key === k)?.map);
    for (const t0 of shuffle(plan)) {
      let q = null;
      const tryTypes = [t0, ...shuffle(fallback.filter((x) => x !== t0))];
      for (const t of tryTypes) {
        if (textOnly && TYPES.find((x) => x.key === t)?.map) continue;
        for (let k = 0; k < 6 && !q; k++) {
          const d = mixedDiff ? 1 + Math.floor(rng() * 3) : diff;
          const c = generate(t, { diff: d });
          if (c && !ids.has(c.id) && !(textOnly && c.map && ['highlight', 'choices', 'point', 'poi', 'tap'].includes(c.map.mode))) q = c;
        }
        if (q) break;
      }
      if (q) { ids.add(q.id); out.push(q); }
    }
    return out;
  }

  /** Preguntas sobre un concepto concreto (repaso de errores). */
  function forConcept(concept, diff = 2) {
    const [kind, rest] = [concept.slice(0, concept.indexOf(':')), concept.slice(concept.indexOf(':') + 1)];
    let focus = null, types = [];
    if (kind === 'st') { if (!model.street.has(rest)) return null; focus = { street: rest }; types = ['identificar', 'cruces', 'proximas', 'paralelas', 'perpendiculares', 'localizar', 'edificios', 'accesos', 'recorridos']; }
    else if (kind === 'ix') { if (!model.pair.has(rest)) return null; focus = { pair: rest }; types = ['cruces', 'crucePunto']; }
    else if (kind === 'poi') { if (!model.poi.has(rest)) return null; focus = { poi: rest }; types = ['edificios', 'orientacion']; }
    else if (kind === 'rel') {
      const [rk, ids] = rest.split(':'); const [a] = (ids || '').split('|');
      if (rk === 'dir') { if (!model.poi.has(a)) return null; focus = { poi: a }; types = ['orientacion']; }
      else { if (!model.street.has(a)) return null; focus = { street: a }; types = rk === 'par' ? ['paralelas'] : rk === 'perp' ? ['perpendiculares'] : rk === 'prox' ? ['proximas'] : ['recorridos', 'cruces']; }
    }
    for (const t of shuffle(types)) { const q = generate(t, { diff, focus }); if (q) return q; }
    return null;
  }

  return { generate, batch, forConcept, eligible: elig, rng };
}

/** Comprobaciones mínimas de integridad de una pregunta. */
export function validate(q) {
  if (!q || !q.prompt) return false;
  if (q.options === null) return !!q.tap;
  if (!Array.isArray(q.options) || q.options.length !== 4) return false;
  if (new Set(q.options.map((o) => o.label)).size !== 4) return false;
  if (!(q.answer >= 0 && q.answer < 4)) return false;
  return true;
}
