// Configuración PÚBLICA de Firebase, leída de las variables de entorno de Vite (.env.local).
// Estos valores identifican el proyecto y no son secretos: la protección real de los datos
// está en las reglas de Firestore (firestore.rules) y en los dominios autorizados de Authentication.
// Si faltan, la aplicación funciona en modo local (sin cuenta ni sincronización).

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

/** Métodos de acceso activados: "google", "email" o ambos separados por coma. */
export const authMethods = String(env.VITE_AUTH_METHODS || 'google,email').split(',').map((s) => s.trim()).filter(Boolean);

export const APP_VERSION = env.VITE_APP_VERSION || '1.0.0';
