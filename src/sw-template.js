/* Service worker de Callejero Cieza. Lo genera vite.config.js al compilar (no editar dist/sw.js).
 *  - Precarga la aplicación completa y el callejero (GeoJSON) para funcionar sin conexión.
 *  - Navegación: red primero y, sin conexión, la aplicación en caché (o offline.html).
 *  - Datos del callejero: caché primero y actualización en segundo plano.
 *  - No intercepta teselas del mapa base, Firebase ni otros dominios: no se guarda en
 *    caché ningún recurso de terceros (respeta la política de uso de tile.openstreetmap.org).
 *  - Actualización: la versión nueva espera hasta que el usuario pulsa «Actualizar».
 */
const VERSION = '__VERSION__';
const CACHE = 'callejero-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('callejero-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // teselas, Firebase, etc.: sin caché
  if (url.pathname.startsWith('/__/')) return;      // rutas reservadas de Firebase Hosting

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch { const c = await caches.open(CACHE); return (await c.match('index.html')) || (await c.match('offline.html')); }
    })());
    return;
  }
  if (url.pathname.endsWith('/data/callejero.geojson')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response('{}', { status: 503 });
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return new Response('', { status: 504, statusText: 'Sin conexión' }); }
  })());
});
