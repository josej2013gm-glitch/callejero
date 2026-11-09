// Configuración PÚBLICA de Firebase, leída de las variables de entorno de Vite
// (.env.local en local o variables del repositorio en GitHub Actions).
// Estos valores identifican el proyecto y no son secretos: la protección real de los datos
// está en las reglas de Firestore (firestore.rules) y en los dominios autorizados de Authentication.
// Si faltan, la aplicación funciona en modo local (solo para desarrollo).

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** Correo del propietario: siempre tiene acceso y es el único que gestiona las cuentas autorizadas. */
export const ownerEmail = String(env.VITE_OWNER_EMAIL || '').trim().toLowerCase();

export const APP_VERSION = env.VITE_APP_VERSION || '1.1.0';
