// Persistencia local en IndexedDB (sin dependencias).
// Una base de datos por usuario ('local' = sin cuenta) para no mezclar datos en un dispositivo compartido.
// Almacenes: kv (ajustes, progreso, correcciones, cola de sincronización…) y sessions (historial).

const VERSION = 1;
let db = null, dbName = null;

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function openDb(owner = 'local') {
  const name = 'callejero-' + owner;
  if (db && dbName === name) return db;
  if (db) db.close();
  const r = indexedDB.open(name, VERSION);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('endedAt', 'endedAt');
  };
  db = await req(r); dbName = name;
  return db;
}

function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }

export const kv = {
  get: (k) => req(store('kv').get(k)),
  set: (k, v) => req(store('kv', 'readwrite').put(v, k)),
  del: (k) => req(store('kv', 'readwrite').delete(k)),
};

export const sessions = {
  all: async () => (await req(store('sessions').getAll())).sort((a, b) => a.endedAt - b.endedAt),
  put: (s) => req(store('sessions', 'readwrite').put(s)),
  del: (id) => req(store('sessions', 'readwrite').delete(id)),
  clear: () => req(store('sessions', 'readwrite').clear()),
};

/** ¿Tiene datos la base local de un propietario? (para ofrecer migrarlos a la cuenta) */
export async function hasData(owner) {
  const prev = dbName;
  await openDb(owner);
  const n = (await sessions.all()).length + Object.keys((await kv.get('progress'))?.items || {}).length;
  if (prev && prev !== dbName) await openDb(prev.replace('callejero-', ''));
  return n > 0;
}

export async function readAll(owner) {
  await openDb(owner);
  return { progress: await kv.get('progress'), sessions: await sessions.all(), overrides: await kv.get('overrides'), settings: await kv.get('settings') };
}

export function currentDbName() { return dbName; }
