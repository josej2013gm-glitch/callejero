import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Genera dist/sw.js con la lista de archivos a precargar (con sus nombres con hash),
 * sin depender de plugins externos. La versión cambia en cada compilación con cambios,
 * lo que activa el aviso «Hay una versión nueva» en los dispositivos instalados.
 */
function serviceWorker() {
  return {
    name: 'callejero-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = [];
      const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else pub.push(relative('public', p).split('\\').join('/')); } };
      walk('public');
      const list = [...new Set(['./', 'index.html', ...files, ...pub.filter((f) => !f.split('/').some((seg) => seg.startsWith('.')))])];
      const hash = createHash('sha256');
      for (const f of files) { const b = bundle[f]; hash.update(f); hash.update(b.code || b.source || ''); }
      for (const f of pub) { hash.update(f); hash.update(readFileSync(join('public', f))); }
      const tpl = readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(list, null, 0));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: tpl });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { leaflet: ['leaflet'] } },
    },
  },
  server: { port: 5173, open: true },
});
