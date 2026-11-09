#!/usr/bin/env node
// Construye public/data/callejero.geojson a partir del volcado OSM y de las verificaciones.
//
//   npm run data:build
//   npm run data:build -- --input otra-ruta.json --out public/data/callejero.geojson

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset } from '../src/engine/build.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const input = resolve(ROOT, arg('--input', 'data-raw/osm-cieza.json'));
const output = resolve(ROOT, arg('--out', 'public/data/callejero.geojson'));
if (!existsSync(input)) {
  console.error(`No existe ${input}. Ejecuta primero: npm run data:import`);
  process.exit(1);
}
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const osm = readJson(input);
const config = readJson(resolve(ROOT, 'data/config.json'), {});
const verifications = readJson(resolve(ROOT, 'data/verificaciones.json'), {});
const importedAt = osm._import?.importedAt || osm.osm3s?.timestamp_osm_base || new Date().toISOString();

const t0 = Date.now();
const ds = buildDataset(osm, { config, verifications, importedAt });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(ds));

const c = ds.metadata.counts;
const vCount = Object.keys(verifications.streets || {}).length + Object.keys(verifications.pois || {}).length + Object.keys(verifications.pairs || {}).length;
const byType = {};
for (const i of ds.metadata.issues) byType[i.type] = (byType[i.type] || 0) + 1;
const report = [
  `# Informe de importación — ${ds.metadata.title}`,
  '',
  `- Fecha de importación: ${importedAt}`,
  `- Datos OSM a fecha de: ${ds.metadata.osmBase || 'desconocida'}`,
  `- Vías: ${c.streets} (urbanas: ${c.urbanStreets}) · Cruces: ${c.pairs} · Edificios y servicios: ${c.pois} · Zonas: ${c.zones}`,
  `- Verificaciones aplicadas: ${vCount}`,
  `- Centro de referencia: ${ds.metadata.town ? ds.metadata.town.name + (ds.metadata.town.fallback ? ' (Ayuntamiento, no hay nodo place=town)' : ' (nodo place=town)') : 'no encontrado'}`,
  '',
  '## Avisos para revisar',
  '',
  ...Object.entries(byType).map(([k, n]) => `- ${k}: ${n}`),
  '',
  ...ds.metadata.issues.map((i) => `- [${i.type}] ${i.msg} (${i.id})`),
  '',
].join('\n');
writeFileSync(resolve(ROOT, 'data/informe-importacion.md'), report);
console.log(`Callejero generado en ${Date.now() - t0} ms → ${output.replace(ROOT + '/', '')}`);
console.log(`  ${c.streets} vías (${c.urbanStreets} urbanas), ${c.pairs} cruces, ${c.pois} edificios/servicios, ${c.zones} zonas, ${c.issues} avisos.`);
console.log('  Informe detallado: data/informe-importacion.md');
if (!c.streets) process.exit(1);
