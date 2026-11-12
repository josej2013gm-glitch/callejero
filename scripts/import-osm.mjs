#!/usr/bin/env node
// Descarga de OpenStreetMap (API Overpass) el callejero de uno o varios municipios y
// genera public/data/callejero-<id>.geojson.
//
//   npm run data:import                        municipios sin datos descargados («faltantes»)
//   npm run data:import -- --muni jumilla      solo Jumilla
//   npm run data:import -- --muni todos        todos los municipios
//   npm run data:import -- --keep-going        si uno falla, sigue con los demás (sin error final)
//   npm run data:import -- --endpoint URL      otro servidor Overpass
//
// Uso responsable: una petición por municipio y ejecución. No lo programes de forma repetida.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadMunicipios, paths, selectMunicipios } from './lib/municipios.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const keepGoing = args.includes('--keep-going');
const ENDPOINTS = arg('--endpoint') ? [arg('--endpoint')] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function fetchOverpass(url, query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 200000);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'estudio-callejero-import/1.2 (herramienta de estudio, uso puntual)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.remark && /error|runtime/i.test(json.remark)) throw new Error('Overpass: ' + json.remark);
    return json;
  } finally { clearTimeout(timer); }
}

async function importOne(m) {
  console.log(`\n== ${m.name} (${m.id}) ==`);
  const query = readFileSync(resolve(ROOT, m.query), 'utf8');
  let data = null, used = null;
  for (const ep of ENDPOINTS) {
    process.stdout.write(`Consultando ${ep} … `);
    try { data = await fetchOverpass(ep, query); used = ep; console.log('correcto'); break; }
    catch (e) { console.log('error: ' + e.message); }
  }
  if (!data) throw new Error(`No se pudo descargar ${m.name}. Alternativa: pega ${m.query} en https://overpass-turbo.eu, exporta «raw OSM data» y súbelo como data-raw/osm-${m.id}.json`);
  const ways = data.elements.filter((e) => e.type === 'way' && e.tags?.highway).length;
  if (!ways) throw new Error(`La respuesta de ${m.name} no contiene vías: revisa el nombre o el rectángulo en ${m.query}.`);
  data._import = { importedAt: new Date().toISOString(), endpoint: used, query: m.query, municipio: m.id };
  mkdirSync(resolve(ROOT, 'data-raw'), { recursive: true });
  const p = paths(m.id);
  writeFileSync(p.raw, JSON.stringify(data));
  copyFileSync(p.raw, p.raw.replace('.json', `-${data._import.importedAt.slice(0, 10)}.json`));
  console.log(`Guardado data-raw/osm-${m.id}.json (${data.elements.length} elementos, ${ways} vías; datos OSM a ${data.osm3s?.timestamp_osm_base || '¿?'})`);
}

async function main() {
  if (typeof fetch !== 'function') { console.error('Se necesita Node.js 18 o superior.'); process.exit(1); }
  const list = selectMunicipios(loadMunicipios(), arg('--muni', 'faltantes'));
  if (!list.length) { console.log('Nada que importar.'); }
  const failed = [];
  for (const m of list) {
    try { await importOne(m); } catch (e) { console.error('✗ ' + e.message); failed.push(m.id); if (!keepGoing) break; }
  }
  if (!args.includes('--no-build')) execFileSync(process.execPath, [resolve(ROOT, 'scripts/build-dataset.mjs')], { stdio: 'inherit' });
  if (failed.length) {
    console.error(`\nNo se pudieron importar: ${failed.join(', ')}`);
    if (!keepGoing) process.exit(1);
  }
}
main();
