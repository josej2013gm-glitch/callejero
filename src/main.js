import './styles/main.css';
import { html, setHTML, $, $$, toast, confirmDialog } from './ui/dom.js';
import { app, init, on, switchOwner, importLocalIntoAccount } from './app/store.js';
import * as cloud from './services/cloud.js';
import { kv, hasData } from './services/localdb.js';

import dashboard from './views/dashboard.js';
import mapa from './views/mapa.js';
import zonas from './views/zonas.js';
import entrenamiento from './views/entrenamiento.js';
import simulacro from './views/simulacro.js';
import mudo from './views/mudo.js';
import repaso from './views/repaso.js';
import estadisticas from './views/estadisticas.js';
import admin from './views/admin.js';
import ajustes from './views/ajustes.js';
import login from './views/login.js';

const ROUTES = { '': dashboard, mapa, zonas, entrenamiento, simulacro, mudo, repaso, estadisticas, admin, ajustes, login };
const NAV = [
  ['', '🏠', 'Inicio'], ['mapa', '🗺️', 'Mapa'], ['zonas', '🧩', 'Zonas'], ['entrenamiento', '🎯', 'Entrenamiento'],
  ['simulacro', '📝', 'Simulacro'], ['mudo', '🧭', 'Mapa mudo'], ['repaso', '🔁', 'Repaso'], ['estadisticas', '📊', 'Estadísticas'],
  ['admin', '🛠️', 'Administración'], ['ajustes', '⚙️', 'Ajustes'],
];
const MOBILE = ['', 'mapa', 'entrenamiento', 'simulacro'];
const SYNC_ICON = { local: '💾', ok: '☁️', pending: '⏳', syncing: '🔄', offline: '📴', quota: '⚠️', error: '⚠️' };

let cleanup = null, started = false;

function shell() {
  setHTML(document.getElementById('app'), html`
    <aside class="sidebar">
      <a class="brand" href="#/"><img src="icons/icon-192.png" alt="" width="32" height="32"><span>Callejero <b>Cieza</b></span></a>
      <nav>${NAV.map(([k, i, l]) => html`<a href="#/${k}" data-r="${k}"><span class="i">${i}</span>${l}</a>`)}</nav>
      <p class="side-foot">Datos © OpenStreetMap</p>
    </aside>
    <div class="main">
      <header class="topbar"><button class="menu-btn" id="menuBtn" type="button" aria-label="Menú">☰</button><h1 id="title"></h1><a href="#/ajustes" id="sync" class="sync" title=""></a></header>
      <div id="banners"></div>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="bottomnav">${MOBILE.map((k) => { const n = NAV.find((x) => x[0] === k); return html`<a href="#/${k}" data-r="${k}"><span class="i">${n[1]}</span>${n[2]}</a>`; })}<a href="#" id="more"><span class="i">☰</span>Más</a></nav>`);
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $('#more').addEventListener('click', (e) => { e.preventDefault(); document.body.classList.toggle('menu-open'); });
  $('.sidebar nav').addEventListener('click', () => document.body.classList.remove('menu-open'));
  updateSync(); banners();
}

function updateSync() {
  const s = $('#sync'); if (!s) return;
  s.textContent = SYNC_ICON[app.sync.state] || '☁️';
  s.title = app.user ? `${app.user.email} · ${app.sync.msg || app.sync.state}` : 'Modo local: datos solo en este dispositivo';
  s.className = 'sync sync-' + app.sync.state;
  banners();
}

let updateReady = null;
function banners() {
  const b = $('#banners'); if (!b) return;
  const items = [];
  if (!navigator.onLine) items.push(['info', 'Sin conexión: puedes seguir estudiando con el mapa local. Los resultados se sincronizarán al volver la conexión.']);
  if (app.sync.state === 'quota') items.push(['warn', app.sync.msg]);
  if (app.sync.state === 'error' && app.sync.msg) items.push(['warn', app.sync.msg]);
  if (updateReady) items.push(['update', 'Hay una versión nueva de la aplicación.']);
  setHTML(b, html`${items.map(([k, m]) => html`<div class="banner ${k}">${m}${k === 'update' ? html` <button class="btn small primary" id="doUpdate" type="button">Actualizar</button>` : ''}</div>`)}`);
  $('#doUpdate')?.addEventListener('click', () => { updateReady.postMessage({ type: 'SKIP_WAITING' }); });
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { name: path || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function route() {
  const { name, params } = parseHash();
  let view = ROUTES[name] || dashboard;
  if (name === 'login' && (app.user || !cloud.isEnabled())) { location.hash = '#/'; return; }
  if (view.bare) { cleanup?.(); cleanup = null; document.body.classList.add('bare'); const r = document.getElementById('app'); r.innerHTML = '<main id="view"></main>'; view.render($('#view')); started = false; return; }
  if (!started) { document.body.classList.remove('bare'); shell(); started = true; }
  cleanup?.(); cleanup = null;
  const root = $('#view');
  root.className = 'view-' + (name || 'inicio');
  $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
  if (!app.model && !['ajustes'].includes(name)) { $('#title').textContent = 'Sin datos'; return noData(root); }
  $('#title').textContent = view.title;
  document.title = `${view.title} · Callejero Cieza`;
  try { const c = view.render(root, params); cleanup = typeof c === 'function' ? c : null; }
  catch (e) { console.error(e); setHTML(root, html`<div class="card warnbox"><p>Se ha producido un error al mostrar esta sección.</p><pre class="small">${e.message}</pre></div>`); }
  root.focus({ preventScroll: true });
}

function noData(root) {
  setHTML(root, html`<div class="card"><h2>Falta el callejero</h2>
    <p>No se ha encontrado <code>data/callejero.geojson</code>${app.dataError ? html` (${app.dataError.message})` : ''}. Hay que generarlo una vez desde el ordenador con los datos de OpenStreetMap:</p>
    <pre>npm run data:import
npm run build
firebase deploy</pre>
    <p class="small">Consulta el apartado 16 de GUIA_INSTALACION.md. También puedes cargar un archivo generado en <a href="#/ajustes">Ajustes</a> → Administración.</p>
    <label class="btn file">Cargar callejero.geojson<input type="file" id="dsf" accept=".geojson,.json" hidden></label></div>`);
  $('#dsf', root).addEventListener('change', async (e) => {
    const { setDatasetOverride } = await import('./app/store.js');
    try { const ds = JSON.parse(await e.target.files[0].text()); if (ds.type !== 'FeatureCollection') throw new Error('formato no válido'); await setDatasetOverride(ds); route(); }
    catch (err) { toast('No se pudo cargar: ' + err.message, 'error'); }
  });
}

async function afterLogin(user) {
  await switchOwner(user);
  const local = await kv.get('migratedFromLocal');
  if (!local && (await hasData('local'))) {
    if (await confirmDialog('Datos de este dispositivo', 'Has usado la aplicación sin cuenta en este dispositivo. ¿Quieres copiar ese progreso e historial a tu cuenta?', 'Copiar a mi cuenta')) await importLocalIntoAccount();
    await kv.set('migratedFromLocal', true);
  }
}

async function boot() {
  await init();
  on((w) => {
    if (w === 'sync' || w === 'user') updateSync();
    if (w === 'model' && started && !app.model) route();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', banners); window.addEventListener('offline', banners);
  if (!cloud.isEnabled()) { route(); return; }
  let first = true;
  cloud.onAuth(async (user) => {
    if (user) { await afterLogin(user); if (parseHash().name === 'login') location.hash = '#/'; route(); }
    else {
      if (app.user) await switchOwner(null);
      if (app.localMode) route();
      else if (parseHash().name !== 'login') location.hash = '#/login'; else route();
    }
    first = false;
  });
  setTimeout(() => { if (first && !document.querySelector('#view')) { app.localMode ? route() : (location.hash = '#/login'); } }, 6000);
}

// ---------- Service worker (solo en producción) ----------
if ('serviceWorker' in navigator && import.meta.env?.PROD) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const check = () => { if (reg.waiting && navigator.serviceWorker.controller) { updateReady = reg.waiting; banners(); } };
      check();
      reg.addEventListener('updatefound', () => { reg.installing?.addEventListener('statechange', check); });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
      setInterval(() => reg.update().catch(() => {}), 3600000);
    } catch (e) { console.warn('SW', e); }
  });
}

boot().catch((e) => { console.error(e); document.getElementById('app').textContent = 'Error al iniciar: ' + e.message; });
