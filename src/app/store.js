// Estado de la aplicación: datos geográficos, ajustes, progreso, historial y sincronización.
// Fuente de verdad: IndexedDB local. Firestore es una réplica que se actualiza con
// escrituras agrupadas y diferidas para no consumir la cuota gratuita.

import * as ldb from '../services/localdb.js';
import * as cloud from '../services/cloud.js';
import { createModel } from '../engine/model.js';
import { review, newItem, mergeProgress, DEFAULT_INTERVALS } from '../engine/srs.js';

export const DEFAULT_SETTINGS = {
  intervals: DEFAULT_INTERVALS, slowMs: 25000,
  includeRural: false, onlyVerified: false,
  officialMinutes: 20, officialTextOnly: false,
  baseTiles: true, practiceSize: 10,
};

const listeners = new Set();
export const app = {
  dataset: null, datasetSource: 'publicado', model: null, dataError: null,
  settings: { ...DEFAULT_SETTINGS }, progress: { items: {}, mudo: { level: 1, recent: [] } },
  sessions: [], overrides: { streets: {}, pois: {}, pairs: {} },
  user: null, owner: 'local', localMode: false,
  sync: { state: 'local', msg: '', lastSync: 0 },
};
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) try { fn(what); } catch (e) { console.error(e); } }

// ---------- Datos geográficos ----------
export async function loadDataset() {
  const custom = await ldb.kv.get('datasetOverride');
  if (custom) { app.dataset = custom; app.datasetSource = 'archivo local'; }
  else {
    try {
      const res = await fetch(import.meta.env?.BASE_URL ? import.meta.env.BASE_URL + 'data/callejero.geojson' : 'data/callejero.geojson', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      app.dataset = await res.json(); app.datasetSource = 'publicado';
    } catch (e) {
      app.dataset = null; app.dataError = e;
    }
  }
  rebuildModel();
}
export function rebuildModel() {
  app.model = app.dataset ? createModel(app.dataset, app.overrides) : null;
  emit('model');
}
export async function setDatasetOverride(ds) {
  if (ds) await ldb.kv.set('datasetOverride', ds); else await ldb.kv.del('datasetOverride');
  await loadDataset();
}

// ---------- Carga de datos del usuario ----------
async function loadUserData() {
  app.settings = { ...DEFAULT_SETTINGS, ...((await ldb.kv.get('settings')) || {}) };
  app.progress = (await ldb.kv.get('progress')) || { items: {}, mudo: { level: 1, recent: [] } };
  app.progress.mudo ||= { level: 1, recent: [] };
  app.sessions = await ldb.sessions.all();
  app.overrides = (await ldb.kv.get('overrides')) || { streets: {}, pois: {}, pairs: {} };
}

export async function init() {
  app.localMode = (await openAndGet('local', 'localMode')) || false;
  await ldb.openDb('local');
  await loadUserData();
  await loadDataset();
}
async function openAndGet(owner, key) { await ldb.openDb(owner); return ldb.kv.get(key); }

export async function setLocalMode(v) { await ldb.openDb('local'); await ldb.kv.set('localMode', v); app.localMode = v; }

/** Cambia el propietario de los datos locales (al iniciar o cerrar sesión). */
export async function switchOwner(user) {
  app.user = user ? { uid: user.uid, email: user.email, name: user.displayName || user.email } : null;
  app.owner = user ? user.uid : 'local';
  await ldb.openDb(app.owner);
  await loadUserData();
  rebuildModel();
  app.sync = { state: user ? 'pending' : 'local', msg: '', lastSync: (await ldb.kv.get('syncMeta'))?.lastSync || 0 };
  emit('user');
  if (user) syncNow().catch(() => {});
}

/** Copia los datos usados sin cuenta a la cuenta actual (fusión, sin borrar nada). */
export async function importLocalIntoAccount() {
  const loc = await ldb.readAll('local');
  await ldb.openDb(app.owner);
  app.progress.items = mergeProgress(app.progress.items, loc.progress?.items || {});
  for (const s of loc.sessions) if (!app.sessions.some((x) => x.id === s.id)) { app.sessions.push(s); await ldb.sessions.put(s); await queue({ session: s.id }); }
  app.sessions.sort((a, b) => a.endedAt - b.endedAt);
  await ldb.kv.set('progress', app.progress); await queue({ progress: true });
  emit('progress'); emit('sessions');
  scheduleFlush(1000);
}

// ---------- Ajustes, progreso, sesiones, correcciones ----------
export async function saveSettings(patch) {
  app.settings = { ...app.settings, ...patch };
  await ldb.kv.set('settings', app.settings); await queue({ user: true });
  emit('settings'); scheduleFlush();
}

let progressTimer = null;
function persistProgress() {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(async () => { await ldb.kv.set('progress', app.progress); await queue({ progress: true }); scheduleFlush(); }, 400);
}

/** Registra respuestas: actualiza los conceptos de repaso espaciado. */
export function recordAnswer(q, correct, ms) {
  const now = Date.now();
  for (const k of q.concepts || []) {
    const it = app.progress.items[k] || newItem(k);
    app.progress.items[k] = review(it, { correct, ms, now, intervals: app.settings.intervals, slowMs: app.settings.slowMs });
  }
  persistProgress(); emit('progress');
}
export function saveMudo(m) { app.progress.mudo = m; persistProgress(); }

/** Guarda una sesión terminada (simulacro, entrenamiento, repaso, mapa mudo). */
export async function saveSession(s) {
  s.id ||= Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  s.endedAt ||= Date.now();
  app.sessions = app.sessions.filter((x) => x.id !== s.id).concat(s).sort((a, b) => a.endedAt - b.endedAt);
  await ldb.sessions.put(s); await queue({ session: s.id });
  emit('sessions'); scheduleFlush(1500);
  return s;
}
export async function deleteSession(id) {
  app.sessions = app.sessions.filter((x) => x.id !== id);
  await ldb.sessions.del(id); await queue({ deleteSession: id });
  emit('sessions'); scheduleFlush();
}
export async function saveOverrides(o) {
  app.overrides = o;
  await ldb.kv.set('overrides', o); await queue({ overrides: true });
  rebuildModel(); scheduleFlush();
}

export async function resetAll() {
  if (app.user) { try { await cloud.wipe(app.user.uid); } catch (e) { throw new Error(cloud.explain(e).msg); } }
  await ldb.sessions.clear();
  for (const k of ['progress', 'overrides', 'outbox', 'syncMeta', 'settings', 'simInProgress']) await ldb.kv.del(k);
  await loadUserData(); rebuildModel(); emit('progress'); emit('sessions'); emit('settings');
}

// ---------- Copia de seguridad ----------
export function exportBackup() {
  return { app: 'callejero-cieza', version: 1, exportedAt: new Date().toISOString(), settings: app.settings, progress: app.progress, sessions: app.sessions, overrides: app.overrides };
}
export async function importBackup(b, { replace = false } = {}) {
  if (b?.app !== 'callejero-cieza') throw new Error('El archivo no es una copia de seguridad de esta aplicación.');
  if (replace) { await ldb.sessions.clear(); app.sessions = []; app.progress = { items: {}, mudo: { level: 1, recent: [] } }; }
  app.settings = { ...DEFAULT_SETTINGS, ...b.settings };
  app.progress = { ...b.progress, items: mergeProgress(app.progress.items, b.progress?.items || {}) };
  for (const s of b.sessions || []) { await ldb.sessions.put(s); await queue({ session: s.id }); }
  app.sessions = await ldb.sessions.all();
  app.overrides = b.overrides || app.overrides;
  await ldb.kv.set('settings', app.settings); await ldb.kv.set('progress', app.progress); await ldb.kv.set('overrides', app.overrides);
  await queue({ user: true, progress: true, overrides: true });
  rebuildModel(); emit('progress'); emit('sessions'); emit('settings'); scheduleFlush(500);
}

// ---------- Sincronización ----------
async function queue(change) {
  const ob = (await ldb.kv.get('outbox')) || { sessions: [], deleteSessions: [] };
  if (change.progress) ob.progress = true;
  if (change.user) ob.user = true;
  if (change.overrides) ob.overrides = true;
  if (change.session && !ob.sessions.includes(change.session)) ob.sessions.push(change.session);
  if (change.deleteSession) { ob.sessions = ob.sessions.filter((x) => x !== change.deleteSession); ob.deleteSessions.push(change.deleteSession); }
  await ldb.kv.set('outbox', ob);
  if (app.user && app.sync.state === 'ok') { app.sync.state = 'pending'; emit('sync'); }
}

let flushTimer = null;
export function scheduleFlush(ms = 20000) {
  if (!app.user) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush().catch(() => {}), ms);
}

function setSync(state, msg = '') { app.sync = { ...app.sync, state, msg }; emit('sync'); }

export async function flush() {
  if (!app.user) return;
  const meta = (await ldb.kv.get('syncMeta')) || {};
  if (meta.pauseUntil && Date.now() < meta.pauseUntil) { setSync('quota', cloud.explain({ code: 'resource-exhausted' }).msg); return; }
  if (!navigator.onLine) { setSync('offline', 'Sin conexión: los cambios se enviarán al recuperarla.'); return; }
  const ob = (await ldb.kv.get('outbox')) || { sessions: [], deleteSessions: [] };
  const empty = !ob.progress && !ob.user && !ob.overrides && !ob.sessions.length && !ob.deleteSessions.length;
  if (empty) { setSync('ok'); return; }
  try {
    const all = new Map(app.sessions.map((s) => [s.id, s]));
    const ids = ob.sessions.filter((id) => all.has(id));
    for (let i = 0; i < Math.max(1, ids.length); i += 400) {
      const first = i === 0;
      await cloud.push(app.user.uid, {
        user: first && ob.user ? { settings: app.settings, email: app.user.email, name: app.user.name } : null,
        progress: first && ob.progress ? { items: app.progress.items, mudo: app.progress.mudo } : null,
        overrides: first && ob.overrides ? app.overrides : null,
        sessions: ids.slice(i, i + 400).map((id) => toCloud(all.get(id))),
        deleteSessions: first ? ob.deleteSessions : [],
      });
    }
    await ldb.kv.set('outbox', { sessions: [], deleteSessions: [] });
    meta.lastSync = Date.now(); meta.pauseUntil = 0; await ldb.kv.set('syncMeta', meta);
    app.sync.lastSync = meta.lastSync; setSync('ok');
  } catch (e) {
    const x = cloud.explain(e);
    if (x.kind === 'quota') { meta.pauseUntil = Date.now() + 3600000; await ldb.kv.set('syncMeta', meta); }
    setSync(x.kind === 'offline' ? 'offline' : x.kind === 'quota' ? 'quota' : 'error', x.msg);
    throw e;
  }
}

/** Descarga los cambios de la nube, los fusiona con los locales y envía lo pendiente. */
export async function syncNow() {
  if (!app.user) return;
  if (!navigator.onLine) { setSync('offline', 'Sin conexión.'); return; }
  setSync('syncing');
  const meta = (await ldb.kv.get('syncMeta')) || {};
  try {
    const r = await cloud.pull(app.user.uid, meta.lastPull || 0);
    if (r.user?.settings) { app.settings = { ...DEFAULT_SETTINGS, ...r.user.settings, ...((await ldb.kv.get('outbox'))?.user ? app.settings : {}) }; await ldb.kv.set('settings', app.settings); }
    if (r.progress?.items) {
      app.progress.items = mergeProgress(app.progress.items, r.progress.items);
      if (r.progress.mudo && (r.progress.mudo.level || 1) > (app.progress.mudo.level || 1)) app.progress.mudo = r.progress.mudo;
      await ldb.kv.set('progress', app.progress);
    }
    if (r.overrides && !(await ldb.kv.get('outbox'))?.overrides) { const { updatedAt, ...o } = r.overrides; app.overrides = { streets: {}, pois: {}, pairs: {}, ...o }; await ldb.kv.set('overrides', app.overrides); }
    let maxEnd = meta.lastPull || 0;
    for (const raw of r.sessions) { const s = fromCloud(raw); await ldb.sessions.put(s); maxEnd = Math.max(maxEnd, s.endedAt); }
    app.sessions = await ldb.sessions.all();
    meta.lastPull = maxEnd; await ldb.kv.set('syncMeta', meta);
    // Si la nube no tenía progreso pero el dispositivo sí, subirlo
    if (!r.progress && Object.keys(app.progress.items).length) await queue({ progress: true, user: true });
    rebuildModel(); emit('progress'); emit('sessions'); emit('settings');
    await flush();
  } catch (e) {
    const x = cloud.explain(e);
    if (x.kind === 'quota') { meta.pauseUntil = Date.now() + 3600000; await ldb.kv.set('syncMeta', meta); }
    setSync(x.kind === 'offline' ? 'offline' : x.kind === 'quota' ? 'quota' : 'error', x.msg);
  }
}

function stripUndefined(o) { return JSON.parse(JSON.stringify(o)); }
// Firestore no admite arrays anidados (coordenadas [[lon,lat]] de las preguntas guardadas):
// las preguntas falladas se guardan en la nube como texto JSON.
export function toCloud(s) { const c = stripUndefined(s); c.wrongQs = JSON.stringify(c.wrongQs || []); return c; }
export function fromCloud(s) { const c = { ...s }; if (typeof c.wrongQs === 'string') { try { c.wrongQs = JSON.parse(c.wrongQs); } catch { c.wrongQs = []; } } return c; }

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (app.user) syncNow(); });
  window.addEventListener('offline', () => { if (app.user) setSync('offline', 'Sin conexión: los cambios se guardan en este dispositivo.'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.user) flush().catch(() => {}); });
}
