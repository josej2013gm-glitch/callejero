// Estado de la aplicación: municipios, datos geográficos, ajustes, progreso, historial y sincronización.
// Fuente de verdad: IndexedDB local. Firestore es una réplica que se actualiza con escrituras
// agrupadas y diferidas para no consumir la cuota gratuita.
//
// Cada municipio tiene su propio progreso (repaso espaciado y nivel de mapa mudo), historial de
// sesiones, correcciones de datos y simulacro en curso. Los ajustes son comunes.
// Compatibilidad: los datos anteriores a la versión multimunicipio pertenecen a «cieza» y
// conservan sus claves originales (progress, overrides…), así no hay que migrar nada.

import * as ldb from '../services/localdb.js';
import * as cloud from '../services/cloud.js';
import { createModel } from '../engine/model.js';
import { review, newItem, mergeProgress, DEFAULT_INTERVALS } from '../engine/srs.js';

export const LEGACY_MUNI = 'cieza';
export const DEFAULT_SETTINGS = {
  intervals: DEFAULT_INTERVALS, slowMs: 25000,
  includeRural: false, onlyVerified: false,
  officialMinutes: 20, officialTextOnly: false,
  baseTiles: true, practiceSize: 10,
};
const DEFAULT_EXAM = { format: 'test', questions: 20, correct: 0.1, wrong: 0.03, max: 2, pass: null };
const emptyProgress = () => ({ items: {}, mudo: { level: 1, recent: [] } });
const emptyOverrides = () => ({ streets: {}, pois: {}, pairs: {} });

/** Clave local de un dato por municipio («progress» para Cieza, «progress:jumilla»…). */
export const muniKey = (base, muni = app.muni) => (muni === LEGACY_MUNI ? base : `${base}:${muni}`);
/** Documento de Firestore por municipio («progress» para Cieza, «progress-jumilla»…). */
const cloudId = (base, muni) => (muni === LEGACY_MUNI ? base : `${base}-${muni}`);
const sessionMuni = (s) => s.muni || LEGACY_MUNI;

const listeners = new Set();
export const app = {
  munis: [], muni: LEGACY_MUNI, muniInfo: null,
  dataset: null, datasetSource: 'publicado', model: null, dataError: null,
  settings: { ...DEFAULT_SETTINGS },
  progressBy: {}, overridesBy: {}, allSessions: [], sessions: [],
  user: null, owner: 'local', localMode: false,
  sync: { state: 'local', msg: '', lastSync: 0 },
};
// app.progress y app.overrides apuntan siempre al municipio activo
Object.defineProperty(app, 'progress', { get() { return (app.progressBy[app.muni] ||= emptyProgress()); }, set(v) { app.progressBy[app.muni] = v; } });
Object.defineProperty(app, 'overrides', { get() { return (app.overridesBy[app.muni] ||= emptyOverrides()); }, set(v) { app.overridesBy[app.muni] = v; } });
export const exam = () => ({ ...DEFAULT_EXAM, ...(app.muniInfo?.exam || {}) });

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) try { fn(what); } catch (e) { console.error(e); } }

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '';

// ---------- Municipios y datos geográficos ----------
async function loadMunis() {
  try {
    const res = await fetch(base() + 'data/municipios.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    app.munis = (await res.json()).municipios || [];
  } catch {
    // Instalación anterior a la versión multimunicipio: un único callejero de Cieza
    app.munis = [{ id: LEGACY_MUNI, name: 'Cieza', file: 'data/callejero.geojson', exam: DEFAULT_EXAM, available: true }];
  }
  if (!app.munis.length) app.munis = [{ id: LEGACY_MUNI, name: 'Cieza', file: 'data/callejero.geojson', exam: DEFAULT_EXAM, available: true }];
}

const datasetCache = new Map();
export async function loadDataset() {
  app.dataError = null;
  const custom = await ldb.kv.get(muniKey('datasetOverride'));
  if (custom) { app.dataset = custom; app.datasetSource = 'archivo local'; }
  else if (datasetCache.has(app.muni)) { app.dataset = datasetCache.get(app.muni); app.datasetSource = 'publicado'; }
  else {
    try {
      const res = await fetch(base() + (app.muniInfo?.file || 'data/callejero.geojson'), { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      app.dataset = await res.json(); app.datasetSource = 'publicado';
      datasetCache.set(app.muni, app.dataset);
    } catch (e) { app.dataset = null; app.dataError = e; }
  }
  rebuildModel();
}
export function rebuildModel() {
  app.model = app.dataset ? createModel(app.dataset, app.overrides) : null;
  emit('model');
}
export async function setDatasetOverride(ds) {
  if (ds) await ldb.kv.set(muniKey('datasetOverride'), ds); else await ldb.kv.del(muniKey('datasetOverride'));
  await loadDataset();
}

function refreshSessions() {
  app.sessions = app.allSessions.filter((s) => sessionMuni(s) === app.muni);
}

/** Cambia el municipio de estudio. */
export async function setMuni(id) {
  const m = app.munis.find((x) => x.id === id) || app.munis.find((x) => x.available) || app.munis[0];
  app.muni = m.id; app.muniInfo = m;
  try { localStorage.setItem('muni', m.id); } catch { /* sin almacenamiento */ }
  refreshSessions();
  await loadDataset();
  if (!app.model) {
    // La lista de municipios se leyó al abrir la app: puede que el callejero se haya publicado después
    await loadMunis();
    app.muniInfo = app.munis.find((x) => x.id === app.muni) || app.muniInfo;
    datasetCache.delete(app.muni);
    await loadDataset();
  }
  emit('muni'); emit('progress'); emit('sessions');
}
/** Vuelve a leer la lista de municipios publicada (disponibilidad y fechas). */
export async function refreshMunis() {
  await loadMunis();
  app.muniInfo = app.munis.find((x) => x.id === app.muni) || app.muniInfo;
}

// ---------- Carga de datos del usuario ----------
async function loadUserData() {
  app.settings = { ...DEFAULT_SETTINGS, ...((await ldb.kv.get('settings')) || {}) };
  app.progressBy = {}; app.overridesBy = {};
  for (const m of app.munis) {
    const p = (await ldb.kv.get(muniKey('progress', m.id))) || emptyProgress();
    p.mudo ||= { level: 1, recent: [] };
    app.progressBy[m.id] = p;
    app.overridesBy[m.id] = (await ldb.kv.get(muniKey('overrides', m.id))) || emptyOverrides();
  }
  app.allSessions = await ldb.sessions.all();
  refreshSessions();
}

export async function init() {
  app.localMode = (await openAndGet('local', 'localMode')) || false;
  await ldb.openDb('local');
  await loadMunis();
  let saved = null; try { saved = localStorage.getItem('muni'); } catch { /* */ }
  const first = app.munis.find((x) => x.id === saved) || app.munis.find((x) => x.available) || app.munis[0];
  app.muni = first.id; app.muniInfo = first;
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
  app.progressBy[LEGACY_MUNI] = { ...app.progressBy[LEGACY_MUNI], items: mergeProgress(app.progressBy[LEGACY_MUNI]?.items, loc.progress?.items || {}) };
  for (const s of loc.sessions) if (!app.allSessions.some((x) => x.id === s.id)) { app.allSessions.push(s); await ldb.sessions.put(s); await queue({ session: s.id }); }
  app.allSessions.sort((a, b) => a.endedAt - b.endedAt); refreshSessions();
  await ldb.kv.set(muniKey('progress', LEGACY_MUNI), app.progressBy[LEGACY_MUNI]); await queue({ progress: LEGACY_MUNI });
  emit('progress'); emit('sessions');
  scheduleFlush(1000);
}

// ---------- Ajustes, progreso, sesiones, correcciones ----------
export async function saveSettings(patch) {
  app.settings = { ...app.settings, ...patch };
  await ldb.kv.set('settings', app.settings); await queue({ user: true });
  emit('settings'); scheduleFlush();
}

const progressTimers = {};
function persistProgress(muni = app.muni) {
  clearTimeout(progressTimers[muni]);
  progressTimers[muni] = setTimeout(async () => { await ldb.kv.set(muniKey('progress', muni), app.progressBy[muni]); await queue({ progress: muni }); scheduleFlush(); }, 400);
}

/** Registra una respuesta: actualiza los conceptos de repaso espaciado del municipio activo. */
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
  s.muni ||= app.muni;
  app.allSessions = app.allSessions.filter((x) => x.id !== s.id).concat(s).sort((a, b) => a.endedAt - b.endedAt);
  refreshSessions();
  await ldb.sessions.put(s); await queue({ session: s.id });
  emit('sessions'); scheduleFlush(1500);
  return s;
}
export async function deleteSession(id) {
  app.allSessions = app.allSessions.filter((x) => x.id !== id); refreshSessions();
  await ldb.sessions.del(id); await queue({ deleteSession: id });
  emit('sessions'); scheduleFlush();
}
export async function saveOverrides(o) {
  app.overrides = o;
  await ldb.kv.set(muniKey('overrides'), o); await queue({ overrides: app.muni });
  rebuildModel(); scheduleFlush();
}

/** Borra los datos de estudio. muniOnly: solo los del municipio activo. */
export async function resetAll({ muniOnly = false } = {}) {
  if (muniOnly) {
    for (const s of app.sessions) { await ldb.sessions.del(s.id); await queue({ deleteSession: s.id }); }
    app.allSessions = app.allSessions.filter((s) => sessionMuni(s) !== app.muni);
    app.progress = emptyProgress(); app.overrides = emptyOverrides();
    await ldb.kv.set(muniKey('progress'), app.progress); await ldb.kv.set(muniKey('overrides'), app.overrides);
    await ldb.kv.del(muniKey('simInProgress'));
    await queue({ progress: app.muni, overrides: app.muni });
    refreshSessions(); rebuildModel(); emit('progress'); emit('sessions'); scheduleFlush(500);
    return;
  }
  if (app.user) { try { await cloud.wipe(app.user.uid, app.munis.flatMap((m) => [cloudId('progress', m.id), cloudId('overrides', m.id)])); } catch (e) { throw new Error(cloud.explain(e).msg); } }
  await ldb.sessions.clear();
  for (const m of app.munis) for (const k of ['progress', 'overrides', 'simInProgress']) await ldb.kv.del(muniKey(k, m.id));
  for (const k of ['outbox', 'syncMeta', 'settings']) await ldb.kv.del(k);
  await loadUserData(); rebuildModel(); emit('progress'); emit('sessions'); emit('settings');
}

// ---------- Copia de seguridad ----------
export function exportBackup() {
  return { app: 'estudio-callejero', version: 2, exportedAt: new Date().toISOString(), settings: app.settings, progressBy: app.progressBy, overridesBy: app.overridesBy, sessions: app.allSessions };
}
export async function importBackup(b) {
  // Admite también las copias de la versión anterior (solo Cieza)
  if (b?.app === 'callejero-cieza') b = { ...b, progressBy: { [LEGACY_MUNI]: b.progress }, overridesBy: { [LEGACY_MUNI]: b.overrides } };
  else if (b?.app !== 'estudio-callejero') throw new Error('El archivo no es una copia de seguridad de esta aplicación.');
  app.settings = { ...DEFAULT_SETTINGS, ...b.settings };
  await ldb.kv.set('settings', app.settings); await queue({ user: true });
  for (const [m, p] of Object.entries(b.progressBy || {})) {
    if (!p) continue;
    const cur = app.progressBy[m] || emptyProgress();
    app.progressBy[m] = { ...cur, ...p, items: mergeProgress(cur.items, p.items || {}) };
    await ldb.kv.set(muniKey('progress', m), app.progressBy[m]); await queue({ progress: m });
  }
  for (const [m, o] of Object.entries(b.overridesBy || {})) {
    if (!o) continue;
    app.overridesBy[m] = o; await ldb.kv.set(muniKey('overrides', m), o); await queue({ overrides: m });
  }
  for (const s of b.sessions || []) { await ldb.sessions.put(s); await queue({ session: s.id }); }
  app.allSessions = await ldb.sessions.all(); refreshSessions();
  rebuildModel(); emit('progress'); emit('sessions'); emit('settings'); scheduleFlush(500);
}

// ---------- Sincronización ----------
async function getOutbox() {
  const ob = (await ldb.kv.get('outbox')) || {};
  // Formato anterior: progress/overrides como booleanos (eran de Cieza)
  const arr = (v) => (Array.isArray(v) ? v : v ? [LEGACY_MUNI] : []);
  return { user: !!ob.user, progress: arr(ob.progress), overrides: arr(ob.overrides), sessions: ob.sessions || [], deleteSessions: ob.deleteSessions || [] };
}
async function queue(change) {
  const ob = await getOutbox();
  if (change.progress && !ob.progress.includes(change.progress)) ob.progress.push(change.progress);
  if (change.overrides && !ob.overrides.includes(change.overrides)) ob.overrides.push(change.overrides);
  if (change.user) ob.user = true;
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
  const ob = await getOutbox();
  const empty = !ob.user && !ob.progress.length && !ob.overrides.length && !ob.sessions.length && !ob.deleteSessions.length;
  if (empty) { setSync('ok'); return; }
  try {
    const all = new Map(app.allSessions.map((s) => [s.id, s]));
    const ids = ob.sessions.filter((id) => all.has(id));
    const states = {};
    for (const m of ob.progress) if (app.progressBy[m]) states[cloudId('progress', m)] = { items: app.progressBy[m].items, mudo: app.progressBy[m].mudo };
    for (const m of ob.overrides) if (app.overridesBy[m]) states[cloudId('overrides', m)] = app.overridesBy[m];
    for (let i = 0; i < Math.max(1, ids.length); i += 400) {
      const first = i === 0;
      await cloud.push(app.user.uid, {
        user: first && ob.user ? { settings: app.settings, email: app.user.email, name: app.user.name } : null,
        states: first ? states : {},
        sessions: ids.slice(i, i + 400).map((id) => toCloud(all.get(id))),
        deleteSessions: first ? ob.deleteSessions : [],
      });
    }
    await ldb.kv.set('outbox', { sessions: [], deleteSessions: [], progress: [], overrides: [] });
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
    const stateIds = app.munis.flatMap((m) => [cloudId('progress', m.id), cloudId('overrides', m.id)]);
    const r = await cloud.pull(app.user.uid, meta.lastPull || 0, stateIds);
    const ob = await getOutbox();
    if (r.user?.settings) { app.settings = { ...DEFAULT_SETTINGS, ...r.user.settings, ...(ob.user ? app.settings : {}) }; await ldb.kv.set('settings', app.settings); }
    for (const m of app.munis) {
      const rp = r.states[cloudId('progress', m.id)];
      const local = app.progressBy[m.id] ||= emptyProgress();
      if (rp?.items) {
        local.items = mergeProgress(local.items, rp.items);
        if (rp.mudo && (rp.mudo.level || 1) > (local.mudo?.level || 1)) local.mudo = rp.mudo;
        await ldb.kv.set(muniKey('progress', m.id), local);
      } else if (Object.keys(local.items).length) await queue({ progress: m.id }); // la nube no lo tenía
      const ro = r.states[cloudId('overrides', m.id)];
      if (ro && !ob.overrides.includes(m.id)) { const { updatedAt, ...o } = ro; app.overridesBy[m.id] = { ...emptyOverrides(), ...o }; await ldb.kv.set(muniKey('overrides', m.id), app.overridesBy[m.id]); }
    }
    let maxEnd = meta.lastPull || 0;
    for (const rawS of r.sessions) { const s = fromCloud(rawS); await ldb.sessions.put(s); maxEnd = Math.max(maxEnd, s.endedAt); }
    app.allSessions = await ldb.sessions.all(); refreshSessions();
    meta.lastPull = maxEnd; await ldb.kv.set('syncMeta', meta);
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
