// Acceso a Firebase (Authentication + Firestore). El SDK se carga bajo demanda solo si
// hay configuración, así la aplicación arranca rápido y funciona sin conexión.
//
// Estructura en Firestore (minimiza lecturas/escrituras):
//   users/{uid}                    perfil + ajustes                (1 documento)
//   users/{uid}/state/progress     repaso espaciado de conceptos   (1 documento, escritura diferida)
//   users/{uid}/state/overrides    correcciones del panel admin    (1 documento)
//   users/{uid}/sessions/{id}      un documento por sesión/simulacro terminado

import { firebaseConfig, firebaseEnabled } from '../config/firebase.js';

let fb = null; // { app, auth, db, mods }

async function load() {
  if (fb) return fb;
  if (!firebaseEnabled) throw new Error('Firebase no está configurado');
  const [appM, authM, fsM] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  auth.languageCode = 'es';
  const db = fsM.getFirestore(app);
  fb = { app, auth, db, A: authM, F: fsM };
  return fb;
}

export const isEnabled = () => firebaseEnabled;

export async function onAuth(cb) {
  if (!firebaseEnabled) { cb(null); return () => {}; }
  try {
    const { auth, A } = await load();
    try { await A.getRedirectResult(auth); } catch (e) { console.warn('redirect', e); }
    return A.onAuthStateChanged(auth, cb);
  } catch (e) {
    console.warn('No se pudo cargar Firebase (¿sin conexión?)', e);
    cb(null, e); return () => {};
  }
}

export async function signInGoogle() {
  const { auth, A } = await load();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { return await A.signInWithPopup(auth, provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return A.signInWithRedirect(auth, provider);
    throw e;
  }
}
export async function signOut() { const { auth, A } = await load(); return A.signOut(auth); }

// ---------- Firestore ----------
const userRef = (F, db, uid) => F.doc(db, 'users', uid);
const accessRef = (F, db) => F.doc(db, 'config', 'access');

/** Solo se admiten cuentas de Google con el correo verificado. */
export function isGoogleUser(user) {
  return !!user && user.emailVerified && (user.providerData || []).some((p) => p.providerId === 'google.com');
}

/**
 * ¿Está autorizada esta cuenta? Lo decide Firestore con sus reglas: si no lo está,
 * leer su propio documento devuelve «permission-denied». Sin conexión no se puede
 * comprobar y se permite el uso local (los datos de la nube siguen protegidos).
 */
export async function checkAccess(uid) {
  const { db, F } = await load();
  try { await F.getDoc(userRef(F, db, uid)); return true; }
  catch (e) { if (e.code === 'permission-denied') return false; return true; }
}

/** Lista de correos autorizados (solo la puede leer y cambiar el propietario). */
export async function getAllowed() {
  const { db, F } = await load();
  const d = await F.getDoc(accessRef(F, db));
  return d.exists() ? d.data().emails || [] : [];
}
export async function setAllowed(emails) {
  const { db, F } = await load();
  await F.setDoc(accessRef(F, db), { emails, updatedAt: Date.now() });
}
const stateRef = (F, db, uid, id) => F.doc(db, 'users', uid, 'state', id);

/** Descarga perfil, documentos de estado (progreso y correcciones de cada municipio) y sesiones nuevas. */
export async function pull(uid, sinceMs = 0, stateIds = ['progress', 'overrides']) {
  const { db, F } = await load();
  const [u, ...st] = await Promise.all([F.getDoc(userRef(F, db, uid)), ...stateIds.map((id) => F.getDoc(stateRef(F, db, uid, id)))]);
  const q = F.query(F.collection(db, 'users', uid, 'sessions'), F.where('endedAt', '>', sinceMs), F.orderBy('endedAt'));
  const snap = await F.getDocs(q);
  const states = {};
  stateIds.forEach((id, i) => { if (st[i].exists()) states[id] = st[i].data(); });
  return { user: u.exists() ? u.data() : null, states, sessions: snap.docs.map((d) => d.data()) };
}

/** Escribe un lote de cambios en una sola operación atómica (writeBatch). */
export async function push(uid, { user, states = {}, sessions = [], deleteSessions = [] }) {
  const { db, F } = await load();
  const b = F.writeBatch(db);
  const ts = Date.now();
  if (user) b.set(userRef(F, db, uid), { ...user, updatedAt: ts }, { merge: true });
  for (const [id, data] of Object.entries(states)) b.set(stateRef(F, db, uid, id), { ...data, updatedAt: ts });
  for (const s of sessions) b.set(F.doc(db, 'users', uid, 'sessions', s.id), s);
  for (const id of deleteSessions) b.delete(F.doc(db, 'users', uid, 'sessions', id));
  await b.commit();
}

/** Borra todos los datos del usuario en la nube (ajustes → borrar datos). */
export async function wipe(uid, stateIds = ['progress', 'overrides']) {
  const { db, F } = await load();
  const snap = await F.getDocs(F.collection(db, 'users', uid, 'sessions'));
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 400) {
    const b = F.writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.delete(F.doc(db, 'users', uid, 'sessions', id)));
    await b.commit();
  }
  const b = F.writeBatch(db);
  for (const id of stateIds) b.delete(stateRef(F, db, uid, id));
  b.delete(userRef(F, db, uid));
  await b.commit();
}

/** Traduce errores de Firebase a mensajes comprensibles. */
export function explain(e) {
  const c = e?.code || '';
  if (c === 'resource-exhausted' || /quota/i.test(e?.message || '')) return { kind: 'quota', msg: 'Se ha alcanzado la cuota gratuita diaria de Firebase. Tus resultados se guardan en este dispositivo y se sincronizarán automáticamente más tarde.' };
  if (c === 'permission-denied') return { kind: 'perm', msg: 'Firestore ha denegado el acceso. Comprueba que las reglas de seguridad (firestore.rules) están publicadas.' };
  if (c === 'unavailable' || c === 'auth/network-request-failed' || !navigator.onLine) return { kind: 'offline', msg: 'Sin conexión con Firebase. Los cambios quedan pendientes en este dispositivo.' };
  if (c === 'auth/unauthorized-domain') return { kind: 'auth', msg: 'Este dominio no está autorizado en Firebase Authentication (Configuración → Dominios autorizados).' };
  if (c === 'auth/operation-not-allowed') return { kind: 'auth', msg: 'El acceso con Google no está activado en Firebase Authentication.' };
  if (c === 'auth/popup-closed-by-user') return { kind: 'auth', msg: 'Se cerró la ventana de acceso antes de terminar.' };
  if (c === 'auth/too-many-requests') return { kind: 'auth', msg: 'Demasiados intentos. Espera unos minutos.' };
  if (c === 'failed-precondition') return { kind: 'index', msg: 'Firestore necesita un índice o la configuración no es válida: ' + (e.message || '') };
  return { kind: 'other', msg: e?.message || String(e) };
}
