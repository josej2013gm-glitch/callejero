#!/usr/bin/env node
// Valida el callejero de cada municipio y genera cientos de preguntas comprobando cada una
// de forma independiente. También comprueba que se puede montar el simulacro oficial.
//
//   npm run data:validate                 todos los municipios con datos
//   node scripts/validate-dataset.mjs archivo.geojson [test|mapaMudo]   (archivo suelto)

import { readFileSync, existsSync } from 'node:fs';
import { createModel } from '../src/engine/model.js';
import { createGenerator, TYPES, OFFICIAL_MIX } from '../src/engine/questions.js';
import { checkQuestion } from '../src/engine/verify.js';
import { pickStreets } from '../src/engine/mapamudo.js';
import { SCHEMA_VERSION } from '../src/engine/build.js';
import { loadMunicipios, paths } from './lib/municipios.mjs';

function validate(file, label, exam) {
  console.log(`\n== ${label} ==`);
  const ds = JSON.parse(readFileSync(file, 'utf8'));
  let fail = 0;
  const ok = (c, msg) => { if (!c) { fail++; console.log('  ✗ ' + msg); } };
  ok(ds.type === 'FeatureCollection', 'debe ser un FeatureCollection');
  ok(ds.metadata?.schema === SCHEMA_VERSION, `versión de esquema ${ds.metadata?.schema} (esperada ${SCHEMA_VERSION})`);
  const M = createModel(ds);
  ok(M.streets.length > 0, 'sin vías');
  for (const s of M.streets) {
    ok(s.name && s.lines?.length, `vía ${s.id} sin nombre o geometría`);
    ok(s.ver?.status, `vía ${s.id} sin estado de verificación`);
    for (const x of s.inter) ok(M.street.has(x), `vía ${s.id}: cruce con vía inexistente ${x}`);
  }
  for (const p of M.pois) ok(!p.street || M.street.has(p.street), `edificio ${p.id} con vía inexistente`);
  console.log(`  ${M.streets.length} vías, ${M.pair.size} cruces, ${M.pois.length} edificios, ${M.zones.length} zonas`);
  let total = 0, bad = 0;
  const perType = {};
  for (let seed = 1; seed <= 40; seed++) {
    const gen = createGenerator(M, { seed });
    for (const t of TYPES) for (const diff of [1, 2, 3]) {
      const q = gen.generate(t.key, { diff });
      if (!q) continue;
      total++; perType[t.key] = (perType[t.key] || 0) + 1;
      const errs = checkQuestion(M, q);
      if (errs.length) { bad++; fail++; console.log(`  ✗ ${q.id}: ${errs.join('; ')}`); }
    }
  }
  for (const t of TYPES) console.log(`  ${(perType[t.key] || 0).toString().padStart(4)}  ${t.name}${perType[t.key] ? '' : '  ← sin datos suficientes'}`);
  const sim = createGenerator(M, { seed: 99 }).batch(OFFICIAL_MIX, { mixedDiff: true });
  console.log(`  Simulacro tipo test: ${sim.length}/20 preguntas`);
  if (exam?.format !== 'mapaMudo') ok(sim.length === 20, 'no se pudo completar un simulacro tipo test de 20 preguntas');
  if (exam?.format === 'mapaMudo') {
    const n = exam.items || 20;
    const ids = pickStreets(M, { n, rng: () => 0.5 });
    console.log(`  Simulacro de mapa mudo: ${ids.length}/${n} vías numerables`);
    ok(ids.length === n, `no hay ${n} vías con nombre inequívoco para el mapa mudo`);
  }
  console.log(`  ${total} preguntas generadas, ${bad} con errores. ${fail ? fail + ' comprobaciones fallidas.' : 'Correcto.'}`);
  return fail;
}

let fail = 0;
if (process.argv[2]) fail = validate(process.argv[2], process.argv[2], { format: process.argv[3] || 'test', items: 20 });
else {
  let n = 0;
  for (const m of loadMunicipios()) {
    const p = paths(m.id);
    if (!existsSync(p.out)) { console.log(`\n== ${m.name} == sin datos todavía (se omite)`); continue; }
    n++; fail += validate(p.out, m.name, m.exam);
  }
  if (!n) { console.error('Ningún municipio tiene datos. Ejecuta npm run data:import'); process.exit(1); }
}
console.log(fail ? `\n${fail} comprobaciones fallidas.` : '\nTodo correcto.');
process.exit(fail ? 1 : 0);
