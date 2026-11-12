// Servidor de pruebas sin Vite: sirve el código fuente como módulos nativos, con un
// mapa de importación que apunta «leaflet» al sustituto de pruebas y con el callejero
// FICTICIO de tests/fixtures. Uso: node tests/browser/serve.mjs [puerto]

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture } from '../fixtures/make-fixture.mjs';
import { buildDataset } from '../../src/engine/build.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2] || 5180);
// Dos municipios FICTICIOS (ids cieza y jumilla para reproducir la configuración real) y uno sin datos
const fx2 = makeFixture();
for (const e of fx2.elements) if (e.tags?.name === 'Calle Mayor') e.tags.name = 'Calle Real';
const datasets = {
  cieza: JSON.stringify(buildDataset(makeFixture(), { config: { townName: 'Villaprueba' }, importedAt: '2026-01-02T00:00:00Z' })),
  jumilla: JSON.stringify(buildDataset(fx2, { config: { townName: 'Villaprueba' }, importedAt: '2026-01-03T00:00:00Z' })),
};
const index = JSON.stringify({ municipios: [
  { id: 'cieza', name: 'Villaprueba', file: 'data/callejero-cieza.geojson', available: true, importedAt: '2026-01-02', exam: { format: 'test', questions: 20, correct: 0.1, wrong: 0.03, max: 2, pass: null, source: 'Prueba', notes: '' } },
  { id: 'jumilla', name: 'Otrapueba', file: 'data/callejero-jumilla.geojson', available: true, importedAt: '2026-01-03', exam: { format: 'mapaMudo', items: 8, max: 10, pass: 5, source: 'Prueba', notes: 'Formato mapa mudo' } },
  { id: 'vacio', name: 'Sindatos', file: 'data/callejero-vacio.geojson', available: false, exam: { format: 'test' } },
] });
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.geojson': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') {
    let h = readFileSync(join(ROOT, 'index.html'), 'utf8');
    h = h.replace('<title>', '<script type="importmap">{"imports":{"leaflet":"/tests/browser/leaflet-stub.js"}}</script><link rel="stylesheet" href="/src/styles/main.css"><title>');
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(h);
  }
  if (p === '/data/municipios.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(index); }
  const m = p.match(/^\/data\/callejero-([a-z]+)\.geojson$/);
  if (m && datasets[m[1]]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(datasets[m[1]]); }
  let file = join(ROOT, p);
  if (!existsSync(file)) file = join(ROOT, 'public', p);
  if (!existsSync(file)) { res.writeHead(404); return res.end('404'); }
  let body = readFileSync(file);
  if (p === '/src/main.js') body = body.toString().replace("import './styles/main.css';", '');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log('Servidor de pruebas en http://localhost:' + PORT));
