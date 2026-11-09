#!/usr/bin/env node
// Descarga de OpenStreetMap (API Overpass) las vías, edificios públicos y lugares del
// municipio de Cieza y genera public/data/callejero.geojson.
//
//   npm run data:import                  descarga + construcción
//   npm run data:import -- --no-build    solo descarga
//   npm run data:import -- --endpoint https://overpass.kumi.systems/api/interpreter
//
// Uso responsable: una única petición por ejecución. No lo programes de forma repetida;
// los datos de un callejero cambian poco (basta con reimportar cada varias semanas).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const ENDPOINTS = arg('--endpoint') ? [arg('--endpoint')] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const query = readFileSync(resolve(ROOT, 'data/overpass-query.overpassql'), 'utf8');

async function fetchOverpass(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'callejero-cieza-import/1.0 (herramienta de estudio, uso puntual)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.remark && /error|runtime/i.test(json.remark)) throw new Error('Overpass: ' + json.remark);
    return json;
  } finally { clearTimeout(timer); }
}

async function main() {
  if (typeof fetch !== 'function') { console.error('Se necesita Node.js 18 o superior.'); process.exit(1); }
  let data = null, used = null;
  for (const ep of ENDPOINTS) {
    process.stdout.write(`Consultando ${ep} … `);
    try { data = await fetchOverpass(ep); used = ep; console.log('correcto'); break; }
    catch (e) { console.log('error: ' + e.message); }
  }
  if (!data) {
    console.error('\nNo se pudo descargar. Alternativa manual: abre https://overpass-turbo.eu, pega el contenido de data/overpass-query.overpassql,');
    console.error('ejecuta, exporta como «raw OSM data» y guarda el archivo como data-raw/osm-cieza.json. Después: npm run data:build');
    process.exit(1);
  }
  const ways = data.elements.filter((e) => e.type === 'way' && e.tags?.highway).length;
  if (!ways) {
    console.error('La respuesta no contiene vías. ¿Ha cambiado el nombre o el nivel administrativo del municipio en OSM? Revisa data/overpass-query.overpassql.');
    process.exit(1);
  }
  data._import = { importedAt: new Date().toISOString(), endpoint: used, query: 'data/overpass-query.overpassql' };
  mkdirSync(resolve(ROOT, 'data-raw'), { recursive: true });
  const stamp = data._import.importedAt.slice(0, 10);
  const out = resolve(ROOT, 'data-raw/osm-cieza.json');
  writeFileSync(out, JSON.stringify(data));
  copyFileSync(out, resolve(ROOT, `data-raw/osm-cieza-${stamp}.json`));
  console.log(`Guardado: data-raw/osm-cieza.json (${data.elements.length} elementos, ${ways} vías; datos OSM a ${data.osm3s?.timestamp_osm_base || '¿?'})`);
  if (!args.includes('--no-build')) execFileSync(process.execPath, [resolve(ROOT, 'scripts/build-dataset.mjs')], { stdio: 'inherit' });
}
main();
