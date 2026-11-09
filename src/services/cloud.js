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
export async function signInEmail(email, pass) { const { auth, A } = await load(); return A.signInWithEmailAndPassword(auth, email, pass); }
export async function registerEmail(email, pass) { const { auth, A } = await load(); return A.createUserWithEmailAndPassword(auth, email, pass); }
export async function resetPassword(email) { const { auth, A } = await load(); return A.sendPasswordResetEmail(auth, email); }
export async function signOut() { const { auth, A } = await load(); return A.signOut(auth); }

// ---------- Firestore ----------
const userRef = (F, db, uid) => F.doc(db, 'users', uid);
const stateRef = (F, db, uid, id) => F.doc(db, 'users', uid, 'state', id);

/** Descarga perfil, progreso, correcciones y sesiones nuevas desde sinceMs. */
export async function pull(uid, sinceMs = 0) {
  const { db, F } = await load();
  const [u, p, o] = await Promise.all([F.getDoc(userRef(F, db, uid)), F.getDoc(stateRef(F, db, uid, 'progress')), F.getDoc(stateRef(F, db, uid, 'overrides'))]);
  const q = F.query(F.collection(db, 'users', uid, 'sessions'), F.where('endedAt', '>', sinceMs), F.orderBy('endedAt'));
  const snap = await F.getDocs(q);
  return {
    user: u.exists() ? u.data() : null,
    progress: p.exists() ? p.data() : null,
    overrides: o.exists() ? o.data() : null,
    sessions: snap.docs.map((d) => d.data()),
  };
}

/** Escribe un lote de cambios en una sola operación atómica (writeBatch). */
export async function push(uid, { user, progress, overrides, sessions = [], deleteSessions = [] }) {
  const { db, F } = await load();
  const b = F.writeBatch(db);
  const ts = Date.now();
  if (user) b.set(userRef(F, db, uid), { ...user, updatedAt: ts }, { merge: true });
  if (progress) b.set(stateRef(F, db, uid, 'progress'), { ...progress, updatedAt: ts });
  if (overrides) b.set(stateRef(F, db, uid, 'overrides'), { ...overrides, updatedAt: ts });
  for (const s of sessions) b.set(F.doc(db, 'users', uid, 'sessions', s.id), s);
  for (const id of deleteSessions) b.delete(F.doc(db, 'users', uid, 'sessions', id));
  await b.commit();
}

/** Borra todos los datos del usuario en la nube (ajustes → borrar datos). */
export async function wipe(uid) {
  const { db, F } = await load();
  const snap = await F.getDocs(F.collection(db, 'users', uid, 'sessions'));
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 400) {
    const b = F.writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.delete(F.doc(db, 'users', uid, 'sessions', id)));
    await b.commit();
  }
  const b = F.writeBatch(db);
  b.delete(stateRef(F, db, uid, 'progress')); b.delete(stateRef(F, db, uid, 'overrides')); b.delete(userRef(F, db, uid));
  await b.commit();
}

/** Traduce errores de Firebase a mensajes comprensibles. */
export function explain(e) {
  const c = e?.code || '';
  if (c === 'resource-exhausted' || /quota/i.test(e?.message || '')) return { kind: 'quota', msg: 'Se ha alcanzado la cuota gratuita diaria de Firebase. Tus resultados se guardan en este dispositivo y se sincronizarán automáticamente más tarde.' };
  if (c === 'permission-denied') return { kind: 'perm', msg: 'Firestore ha denegado el acceso. Comprueba que las reglas de seguridad (firestore.rules) están publicadas.' };
  if (c === 'unavailable' || c === 'auth/network-request-failed' || !navigator.onLine) return { kind: 'offline', msg: 'Sin conexión con Firebase. Los cambios quedan pendientes en este dispositivo.' };
  if (c === 'auth/unauthorized-domain') return { kind: 'auth', msg: 'Este dominio no está autorizado en Firebase Authentication (Configuración → Dominios autorizados).' };
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') return { kind: 'auth', msg: 'Correo o contraseña incorrectos.' };
  if (c === 'auth/email-already-in-use') return { kind: 'auth', msg: 'Ya existe una cuenta con ese correo.' };
  if (c === 'auth/weak-password') return { kind: 'auth', msg: 'La contraseña debe tener al menos 6 caracteres.' };
  if (c === 'auth/operation-not-allowed') return { kind: 'auth', msg: 'Este método de acceso no está activado en Firebase Authentication.' };
  if (c === 'auth/popup-closed-by-user') return { kind: 'auth', msg: 'Se cerró la ventana de acceso antes de terminar.' };
  if (c === 'auth/too-many-requests') return { kind: 'auth', msg: 'Demasiados intentos. Espera unos minutos.' };
  if (c === 'failed-precondition') return { kind: 'index', msg: 'Firestore necesita un índice o la configuración no es válida: ' + (e.message || '') };
  return { kind: 'other', msg: e?.message || String(e) };
}
