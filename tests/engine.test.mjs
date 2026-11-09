// Pruebas del motor: geometría, construcción de datos, generador, puntuación y repaso.
// Ejecutar con: npm test   (usa el ejecutor de pruebas integrado de Node, sin dependencias)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture } from './fixtures/make-fixture.mjs';
import { buildDataset } from '../src/engine/build.js';
import { createModel, pairKey } from '../src/engine/model.js';
import { createGenerator, TYPES, OFFICIAL_MIX, OFFICIAL_MIX_TEXT, validate } from '../src/engine/questions.js';
import { checkQuestion as verifyQuestion } from '../src/engine/verify.js';
import { scoreExam, OFFICIAL_RULES, fmtNota } from '../src/engine/scoring.js';
import { review, newItem, mergeProgress, priority, isMastered, parseIntervals, DAY } from '../src/engine/srs.js';
import { haversine, bearing, axisDiff, principalAxis, linesToLines, pointInRing, cardinalOf } from '../src/engine/geo.js';

const DATA = buildDataset(makeFixture(), { config: { townName: 'Villaprueba' }, importedAt: '2026-01-02T00:00:00Z' });
const M = createModel(DATA);
const byName = (n) => M.streets.find((s) => s.name === n && !s.label.includes('Aldea'));

// ---------- Geometría ----------
test('haversine y rumbos', () => {
  const d = haversine([0, 0], [0, 1]);
  assert.ok(Math.abs(d - 111195) < 50, 'un grado de latitud ≈ 111,2 km');
  assert.ok(Math.abs(bearing([0, 0], [0, 1]) - 0) < 0.01);
  assert.ok(Math.abs(bearing([0, 0], [1, 0]) - 90) < 0.01);
  assert.equal(axisDiff(10, 190), 0);
  assert.equal(axisDiff(0, 90), 90);
  assert.equal(axisDiff(170, 10), 20);
  assert.equal(cardinalOf(80, 25).key, 'E');
  assert.equal(cardinalOf(45, 25), null, 'diagonal = ambigua');
});

test('eje principal y rectitud', () => {
  const ns = principalAxis([[[0, 0], [0, 0.01]]]);
  assert.ok(ns.axis < 1 || ns.axis > 179); assert.ok(ns.straightness > 0.99);
  const ew = principalAxis([[[0, 0], [0.01, 0]]]);
  assert.ok(Math.abs(ew.axis - 90) < 1);
  const L = principalAxis([[[0, 0], [0.01, 0], [0.01, 0.009]]]);
  assert.ok(L.straightness < 0.3, 'una L no es recta');
});

test('distancia entre líneas y cruce de segmentos', () => {
  assert.equal(linesToLines([[[0, -1], [0, 1]]], [[[-1, 0], [1, 0]]]), 0);
  const d = linesToLines([[[0, 0], [0, 0.001]]], [[[0.001, 0], [0.001, 0.001]]]);
  assert.ok(Math.abs(d - 111.2) < 1);
  assert.ok(pointInRing([0.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]));
});

// ---------- Construcción del conjunto de datos ----------
test('dataset: vías, uniones de tramos y nombres repetidos', () => {
  assert.equal(DATA.type, 'FeatureCollection');
  const olmo = M.streets.filter((s) => s.name === 'Calle del Olmo');
  assert.equal(olmo.length, 2, 'el mismo nombre en dos lugares separados son dos vías');
  assert.notEqual(olmo[0].label, olmo[1].label, 'con etiquetas distintas');
  assert.equal(byName('Avenida Central').osm.length, 2, 'dos vías OSM conectadas se unen');
  assert.ok(Math.abs(byName('Avenida Central').length - 500) < 5);
  assert.ok(M.streets.every((s) => s.ver.status === 'importado' && s.ver.source === 'OpenStreetMap'));
  assert.ok(M.streets.find((s) => s.name === 'Camino de los Pinos').rural);
});

test('dataset: cruces por nodos compartidos y ángulos', () => {
  const C = byName('Avenida Central'), Mayor = byName('Calle Mayor'), Diag = byName('Avenida Diagonal'), Pino = byName('Calle del Pino');
  assert.ok(M.intersects(C.id, Mayor.id));
  assert.ok(!M.intersects(C.id, Pino.id), 'calles paralelas no se cruzan');
  assert.equal(M.pairOf(C.id, Mayor.id).angle, 90);
  assert.ok(M.pairOf(C.id, Mayor.id).perp);
  assert.ok(!M.pairOf(Mayor.id, Diag.id).perp, 'la diagonal cruza oblicua');
  assert.ok(M.par.get(C.id).has(Pino.id), 'Central ∥ Pino');
  assert.ok(!M.par.get(C.id).has(Mayor.id));
  assert.equal(M.minDist(C.id, Pino.id), 120);
});

test('dataset: edificios asociados a vías sin inventar', () => {
  const ay = M.pois.find((p) => p.name.startsWith('Ayuntamiento'));
  assert.equal(M.street.get(ay.street).name, 'Calle Mayor'); assert.equal(ay.streetMethod, 'addr:street');
  const pol = M.pois.find((p) => p.cat === 'Policía');
  assert.equal(M.street.get(pol.street).name, 'Calle del Roble'); assert.equal(pol.streetMethod, 'proximidad');
  const col = M.pois.find((p) => p.cat === 'Educación');
  assert.equal(col.street, null, 'edificio equidistante de varias calles: sin vía asignada');
  assert.ok(!M.pois.some((p) => p.cat === 'Farmacias'), 'los elementos sin nombre se descartan');
  assert.ok(DATA.metadata.issues.some((i) => i.type === 'poi-direccion-desconocida'));
});

test('dataset: zonas derivadas con método documentado', () => {
  const pol = M.zones.find((z) => z.zkind === 'poligono');
  assert.equal(pol.streets.length, 2);
  assert.ok(M.zones.every((z) => z.method && z.method.length > 20));
  assert.ok(M.zone.get('centro').streets.length > 5);
  assert.ok(M.zone.get('accesos').streets.includes(byName('Carretera de Villaprueba').id));
});

test('dataset: verificaciones y correcciones se aplican', () => {
  const C = byName('Avenida Central');
  const d2 = buildDataset(makeFixture(), {
    config: { townName: 'Villaprueba' },
    verifications: { streets: { [C.id]: { status: 'corregido', name: 'Avenida Central Corregida', nameAtCheck: 'Avenida Central', source: 'Callejero municipal', date: '2026-02-01' } }, pairs: { [pairKey(C.id, byName('Calle Mayor').id)]: { status: 'erroneo' } } },
  });
  const m2 = createModel(d2);
  assert.equal(m2.street.get(C.id).name, 'Avenida Central Corregida');
  assert.equal(m2.street.get(C.id).ver.source, 'Callejero municipal');
  assert.ok(!m2.intersects(C.id, byName('Calle Mayor').id), 'un cruce marcado como erróneo se elimina');
  const m3 = createModel(DATA, { streets: { [C.id]: { status: 'verificado', notes: 'ok' } } });
  assert.equal(m3.street.get(C.id).ver.status, 'verificado');
});

// ---------- Generador de preguntas ----------
function checkQuestion(q) {
  assert.ok(validate(q), 'estructura válida');
  assert.deepEqual(verifyQuestion(M, q), [], q.id);
}

test('generador: cada modalidad produce preguntas correctas e inequívocas', () => {
  const produced = {};
  for (let seed = 1; seed <= 60; seed++) {
    const gen = createGenerator(M, { seed });
    for (const t of TYPES) for (const diff of [1, 2, 3]) {
      const q = gen.generate(t.key, { diff });
      if (!q) continue;
      produced[t.key] = (produced[t.key] || 0) + 1;
      checkQuestion(q);
    }
  }
  for (const t of TYPES) assert.ok(produced[t.key] > 0, `se generan preguntas de «${t.name}»`);
});

test('generador: localizar por toque y preguntas por concepto', () => {
  const gen = createGenerator(M, { seed: 7 });
  const q = gen.generate('localizar', { tap: true });
  assert.equal(q.options, null); assert.equal(q.tap.kind, 'street');
  const C = byName('Avenida Central');
  for (let i = 0; i < 20; i++) {
    const r = gen.forConcept('st:' + C.id);
    assert.ok(r, 'hay preguntas sobre la calle');
    assert.ok(r.refs.streets.includes(C.id) || r.concepts.some((k) => k.includes(C.id)));
  }
  assert.equal(gen.forConcept('st:no-existe'), null);
});

test('generador: simulacro oficial de 20 preguntas sin duplicados', () => {
  for (const seed of [3, 11, 29]) {
    const gen = createGenerator(M, { seed });
    const qs = gen.batch(OFFICIAL_MIX, { mixedDiff: true });
    assert.ok(qs.length >= 18, `simulacro con ${qs.length} preguntas en el municipio de prueba`);
    assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
    qs.forEach(checkQuestion);
    const txt = gen.batch(OFFICIAL_MIX_TEXT, { mixedDiff: true, textOnly: true });
    assert.ok(txt.every((q) => !q.map || !['highlight', 'choices', 'point', 'poi'].includes(q.map.mode)), 'modo solo texto');
  }
});

test('generador: sin datos suficientes no inventa preguntas', () => {
  const tiny = createModel({ type: 'FeatureCollection', features: DATA.features.filter((f) => f.properties.kind === 'street').slice(0, 2) });
  const gen = createGenerator(tiny, { seed: 1 });
  for (const t of TYPES) assert.equal(gen.generate(t.key), null, t.key);
});

// ---------- Puntuación ----------
test('puntuación oficial: +0,10 / −0,03 / 0, máximo 2', () => {
  const key = Array(20).fill(0);
  assert.equal(scoreExam(Array(20).fill(0), key).nota, 2);
  assert.equal(scoreExam(Array(20).fill(null), key).nota, 0);
  const r = scoreExam([...Array(15).fill(0), ...Array(3).fill(1), null, null], key);
  assert.deepEqual([r.correct, r.wrong, r.blank], [15, 3, 2]);
  assert.equal(r.nota, 1.41); // 1,50 − 0,09
  assert.equal(fmtNota(r.nota), '1,41');
  const neg = scoreExam(Array(20).fill(1), key);
  assert.equal(neg.raw, -0.6); assert.equal(neg.nota, 0, 'la nota no baja de 0');
  const t10 = scoreExam([0, 0, 0, 0, 0, 1, 1, null, null, null], Array(10).fill(0));
  assert.equal(t10.max, 1); assert.equal(t10.nota, 0.44); assert.equal(t10.sobre2, 0.88);
  assert.equal(OFFICIAL_RULES.questions, 20);
});

// ---------- Repetición espaciada ----------
test('repaso espaciado: cajas, fallos, respuestas lentas y fusión', () => {
  const now = 1_700_000_000_000;
  let it = newItem('st:x');
  it = review(it, { correct: true, ms: 5000, now });
  assert.equal(it.b, 1); assert.equal(it.due, now + DAY);
  it = review(it, { correct: true, ms: 5000, now }); it = review(it, { correct: true, ms: 5000, now });
  assert.equal(it.b, 3); assert.ok(isMastered(it));
  const slow = review(it, { correct: true, ms: 60000, now });
  assert.equal(slow.b, 3, 'una respuesta lenta no sube de caja');
  const bad = review(it, { correct: false, ms: 3000, now });
  assert.equal(bad.b, 0); assert.equal(bad.lapses, 1); assert.ok(priority(bad, now + 11 * 60000) > priority(it, now));
  const merged = mergeProgress({ a: { last: 1, b: 1 } }, { a: { last: 2, b: 4 }, c: { last: 1 } });
  assert.equal(merged.a.b, 4); assert.ok(merged.c);
  assert.deepEqual(parseIntervals('1, 3, 7, 21'), [0, 1, 3, 7, 21]);
  assert.equal(parseIntervals('x'), null);
});

// ---------- Compatibilidad con Firestore ----------
test('sesiones: el documento para Firestore no tiene arrays anidados y se recupera igual', async () => {
  const { toCloud, fromCloud } = await import('../src/app/store.js');
  const gen = createGenerator(M, { seed: 5 });
  const qs = gen.batch(OFFICIAL_MIX, { mixedDiff: true });
  const session = {
    id: 'abc', mode: 'oficial', endedAt: Date.now(), cfg: { n: 20, zona: null }, score: scoreExam(qs.map(() => 0), qs.map((q) => q.answer)),
    answers: qs.map((q) => ({ qid: q.id, ok: true, ms: 1000, concepts: q.concepts, zones: [] })), wrongQs: qs,
  };
  const doc = toCloud(session);
  const walk = (v, inArray = false, path = '') => {
    assert.notEqual(v, undefined, 'undefined en ' + path);
    if (Array.isArray(v)) { assert.ok(!inArray, 'array anidado en ' + path); v.forEach((x, i) => walk(x, true, path + '[' + i + ']')); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, false, path + '.' + k);
  };
  walk(doc);
  assert.ok(JSON.stringify(doc).length < 900000, 'por debajo del límite de 1 MiB');
  assert.deepEqual(fromCloud(doc).wrongQs, JSON.parse(JSON.stringify(qs)));
});
