#!/usr/bin/env node
// Valida public/data/callejero.geojson y genera cientos de preguntas comprobando cada
// una de forma independiente (opción correcta cumple la condición, distractores no).
//
//   npm run data:validate

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel } from '../src/engine/model.js';
import { createGenerator, TYPES, OFFICIAL_MIX } from '../src/engine/questions.js';
import { checkQuestion } from '../src/engine/verify.js';
import { SCHEMA_VERSION } from '../src/engine/build.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(ROOT, process.argv[2] || 'public/data/callejero.geojson');
if (!existsSync(file)) { console.error('No existe ' + file + '. Ejecuta npm run data:import'); process.exit(1); }
const ds = JSON.parse(readFileSync(file, 'utf8'));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('  ✗ ' + msg); } };

console.log('Estructura');
ok(ds.type === 'FeatureCollection', 'debe ser un FeatureCollection');
ok(ds.metadata?.schema === SCHEMA_VERSION, `versión de esquema ${ds.metadata?.schema} (esperada ${SCHEMA_VERSION})`);
const M = createModel(ds);
ok(M.streets.length > 0, 'sin vías');
for (const s of M.streets) {
  ok(s.name && s.lines?.length, `vía ${s.id} sin nombre o geometría`);
  ok(s.ver?.status && s.ver?.source !== undefined, `vía ${s.id} sin estado de verificación`);
  for (const x of s.inter) ok(M.street.has(x), `vía ${s.id}: cruce con vía inexistente ${x}`);
}
for (const p of M.pois) ok(!p.street || M.street.has(p.street), `edificio ${p.id} con vía inexistente`);
console.log(`  ${M.streets.length} vías, ${M.pair.size} cruces, ${M.pois.length} edificios, ${M.zones.length} zonas`);

console.log('Preguntas (verificación independiente)');
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
console.log(`  Simulacro oficial de prueba: ${sim.length}/20 preguntas`);
ok(sim.length === 20, 'no se pudo completar un simulacro de 20 preguntas');
console.log(`\n${total} preguntas generadas, ${bad} con errores. ${fail ? fail + ' comprobaciones fallidas.' : 'Todo correcto.'}`);
process.exit(fail ? 1 : 0);
