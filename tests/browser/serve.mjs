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
const dataset = JSON.stringify(buildDataset(makeFixture(), { config: { townName: 'Villaprueba' }, importedAt: '2026-01-02T00:00:00Z' }));
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.geojson': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') {
    let h = readFileSync(join(ROOT, 'index.html'), 'utf8');
    h = h.replace('<title>', '<script type="importmap">{"imports":{"leaflet":"/tests/browser/leaflet-stub.js"}}</script><link rel="stylesheet" href="/src/styles/main.css"><title>');
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(h);
  }
  if (p === '/data/callejero.geojson') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(dataset); }
  let file = join(ROOT, p);
  if (!existsSync(file)) file = join(ROOT, 'public', p);
  if (!existsSync(file)) { res.writeHead(404); return res.end('404'); }
  let body = readFileSync(file);
  if (p === '/src/main.js') body = body.toString().replace("import './styles/main.css';", '');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log('Servidor de pruebas en http://localhost:' + PORT));
