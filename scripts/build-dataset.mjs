#!/usr/bin/env node
// Construye el callejero de cada municipio a partir de su volcado OSM y sus verificaciones,
// y el índice public/data/municipios.json que lee la aplicación.
//
//   npm run data:build                       todos los municipios con datos descargados
//   npm run data:build -- --muni jumilla     solo uno
//   npm run data:build -- --input x.json --out y.geojson --town Nombre   (archivo suelto, para pruebas)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildDataset } from '../src/engine/build.js';
import { ROOT, loadMunicipios, paths } from './lib/municipios.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

function buildOne({ input, output, report, config, verifications, label }) {
  const osm = readJson(input);
  if (!Array.isArray(osm?.elements)) {
    const kind = osm?.type === 'FeatureCollection' ? 'un GeoJSON' : 'un formato desconocido';
    throw new Error(`${label}: el archivo ${input.split('/').slice(-2).join('/')} es ${kind}, no un volcado «raw OSM data». En overpass-turbo usa Exportar → «raw OSM data» (no «GeoJSON»).`);
  }
  const importedAt = osm._import?.importedAt || osm.osm3s?.timestamp_osm_base || new Date().toISOString();
  const t0 = Date.now();
  const ds = buildDataset(osm, { config, verifications, importedAt });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(ds));
  const c = ds.metadata.counts;
  const vCount = ['streets', 'pois', 'pairs'].reduce((n, k) => n + Object.keys(verifications[k] || {}).length, 0);
  const byType = {};
  for (const i of ds.metadata.issues) byType[i.type] = (byType[i.type] || 0) + 1;
  if (report) writeFileSync(report, [
    `# Informe de importación — ${ds.metadata.title}`, '',
    `- Fecha de importación: ${importedAt}`,
    `- Datos OSM a fecha de: ${ds.metadata.osmBase || 'desconocida'}`,
    `- Vías: ${c.streets} (urbanas: ${c.urbanStreets}) · Cruces: ${c.pairs} · Edificios y servicios: ${c.pois} · Zonas: ${c.zones}`,
    `- Verificaciones aplicadas: ${vCount}`,
    `- Centro de referencia: ${ds.metadata.town ? ds.metadata.town.name + (ds.metadata.town.fallback ? ' (Ayuntamiento, no hay nodo place=town)' : ' (nodo place=town)') : 'no encontrado'}`,
    '', '## Avisos para revisar', '',
    ...Object.entries(byType).map(([k, n]) => `- ${k}: ${n}`), '',
    ...ds.metadata.issues.map((i) => `- [${i.type}] ${i.msg} (${i.id})`), '',
  ].join('\n'));
  console.log(`${label}: ${c.streets} vías (${c.urbanStreets} urbanas), ${c.pairs} cruces, ${c.pois} edificios, ${c.zones} zonas, ${c.issues} avisos · ${Date.now() - t0} ms`);
  return ds;
}

// Modo archivo suelto (pruebas)
if (arg('--input')) {
  const ds = buildOne({ input: resolve(arg('--input')), output: resolve(arg('--out', 'callejero.geojson')), report: null, config: { townName: arg('--town', 'Cieza') }, verifications: {}, label: arg('--input') });
  if (!ds.metadata.counts.streets) process.exit(1);
  process.exit(0);
}

const all = loadMunicipios();
const only = arg('--muni');
const index = [];
let built = 0;
const errors = [];
for (const m of all) {
  const p = paths(m.id);
  const entry = { id: m.id, name: m.name, exam: m.exam, file: `data/callejero-${m.id}.geojson`, available: false };
  if ((!only || only === m.id) && existsSync(p.raw)) {
    try {
      const ds = buildOne({ input: p.raw, output: p.out, report: p.report, config: m.config || { townName: m.name }, verifications: readJson(p.ver, {}), label: m.name });
      if (ds.metadata.counts.streets) built++;
      else console.error(`✗ ${m.name}: el volcado no contiene vías con nombre. Revisa que la consulta se ejecutó entera en overpass-turbo.`);
    } catch (e) { console.error('✗ ' + e.message); errors.push(m.name); }
  }
  if (existsSync(p.out)) {
    const meta = readJson(p.out).metadata;
    Object.assign(entry, { available: meta.counts.streets > 0, importedAt: meta.importedAt, counts: meta.counts });
  } else if (!existsSync(p.raw)) console.log(`${m.name}: sin datos (falta data-raw/osm-${m.id}.json)`);
  index.push(entry);
}
mkdirSync(dirname(paths('x').index), { recursive: true });
writeFileSync(paths('x').index, JSON.stringify({ generatedAt: new Date().toISOString(), municipios: index }, null, 1));
console.log(`Índice: public/data/municipios.json (${index.filter((x) => x.available).length}/${index.length} municipios con datos)`);
if (!index.some((x) => x.available)) { console.error('Ningún municipio tiene datos. Ejecuta npm run data:import'); process.exit(1); }
// Un archivo de datos estropeado debe verse: el flujo de GitHub se marca en rojo con el motivo
if (errors.length) { console.error(`\nNo se pudo construir el callejero de: ${errors.join(', ')}`); process.exit(1); }
void built; void ROOT;
