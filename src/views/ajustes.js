import { html, setHTML, $, toast, confirmDialog, fmtDate } from '../ui/dom.js';
import { app, saveSettings, syncNow, exportBackup, importBackup, resetAll, on } from '../app/store.js';
import { parseIntervals, DEFAULT_INTERVALS } from '../engine/srs.js';
import * as cloud from '../services/cloud.js';
import { APP_VERSION } from '../config/firebase.js';

const SYNC = { local: 'Modo local (sin cuenta)', ok: 'Sincronizado', pending: 'Cambios pendientes', syncing: 'Sincronizando…', offline: 'Sin conexión', quota: 'Cuota de Firebase agotada', error: 'Error de sincronización' };

export default {
  title: 'Ajustes',
  render(root) {
    const draw = () => {
      const s = app.settings, u = app.user;
      setHTML(root, html`
        <div class="grid cols2">
          <div class="card"><h3>Cuenta y sincronización</h3>
            ${u ? html`<p>Sesión iniciada como <b>${u.name}</b> (${u.email}).</p>
              <p>Estado: <b class="sync-${app.sync.state}">${SYNC[app.sync.state] || app.sync.state}</b>${app.sync.lastSync ? html` · última sincronización ${fmtDate(app.sync.lastSync, true)}` : ''}</p>
              ${app.sync.msg ? html`<p class="warnbox small">${app.sync.msg}</p>` : ''}
              <div class="row"><button class="btn" id="sync" type="button">Sincronizar ahora</button><button class="btn ghost" id="out" type="button">Cerrar sesión</button></div>`
            : cloud.isEnabled() ? html`<p>Estás usando la aplicación sin cuenta: los datos solo se guardan en este dispositivo.</p><a class="btn primary" href="#/login">Iniciar sesión para sincronizar</a>`
              : html`<p>Firebase no está configurado (falta el archivo <code>.env.local</code>). La aplicación funciona en modo local.</p>`}
            <p class="small muted">Para no superar la cuota gratuita, el progreso se envía agrupado (como mucho cada 20 s) y cada sesión terminada es un único documento.</p>
          </div>
          <form class="card form" id="study"><h3>Estudio</h3>
            <label>Intervalos de repaso (días, separados por comas) <input name="intervals" value="${s.intervals.join(', ')}"></label>
            <label>Respuesta lenta a partir de (segundos) <input type="number" name="slow" min="5" max="120" value="${Math.round(s.slowMs / 1000)}"></label>
            <label class="sw"><input type="checkbox" name="rural" ${s.includeRural ? 'checked' : ''}> Incluir caminos y sendas rurales en las preguntas</label>
            <label class="sw"><input type="checkbox" name="verified" ${s.onlyVerified ? 'checked' : ''}> Usar solo datos verificados en las preguntas</label>
            <label class="sw"><input type="checkbox" name="tiles" ${s.baseTiles ? 'checked' : ''}> Mostrar el mapa base de OpenStreetMap cuando haya conexión</label>
            <div class="row"><button class="btn primary" type="submit">Guardar</button><button class="btn ghost" id="defIv" type="button">Intervalos por defecto</button></div>
          </form>
        </div>
        <div class="grid cols2">
          <div class="card"><h3>Copia de seguridad</h3>
            <p class="small">Descarga tus ajustes, progreso, historial y correcciones en un archivo JSON. Al importarla se fusiona con lo que ya tienes.</p>
            <div class="row wrap"><button class="btn" id="bk" type="button">Descargar copia</button><label class="btn ghost file">Importar copia<input type="file" id="bkIn" accept=".json" hidden></label></div>
            <h3>Borrar datos</h3>
            <p class="small">Elimina el progreso, el historial y las correcciones${u ? ' de este dispositivo y de tu cuenta en la nube' : ' de este dispositivo'}.</p>
            <button class="btn danger" id="wipe" type="button">Borrar todo</button>
          </div>
          <div class="card"><h3>Acerca de</h3>
            <ul class="kv small">
              <li><span>Versión</span><b>${APP_VERSION}</b></li>
              <li><span>Datos geográficos</span><b>© colaboradores de OpenStreetMap (ODbL)</b></li>
              <li><span>Importados</span><b>${fmtDate(app.model?.meta.importedAt)}</b></li>
            </ul>
            <p class="small">Herramienta de estudio no oficial. Los nombres y relaciones proceden de OpenStreetMap y pueden contener errores: contrástalos con el callejero del Ayuntamiento de Cieza.</p>
            <button class="btn ghost small" id="upd" type="button">Buscar actualización de la aplicación</button>
          </div>
        </div>`);
      $('#sync', root)?.addEventListener('click', () => syncNow().then(() => toast(app.sync.state === 'ok' ? 'Sincronizado.' : app.sync.msg || 'Pendiente', app.sync.state === 'ok' ? 'ok' : 'warn')));
      $('#out', root)?.addEventListener('click', async () => { await syncNow().catch(() => {}); await cloud.signOut(); });
      $('#study', root).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target);
        const iv = parseIntervals(f.get('intervals'));
        if (!iv) return toast('Indica al menos tres intervalos, p. ej. 1, 3, 7, 14, 30', 'warn');
        await saveSettings({ intervals: iv, slowMs: Math.max(5, Number(f.get('slow')) || 25) * 1000, includeRural: !!f.get('rural'), onlyVerified: !!f.get('verified'), baseTiles: !!f.get('tiles') });
        toast('Ajustes guardados.', 'ok'); draw();
      });
      $('#defIv', root).addEventListener('click', () => { root.querySelector('[name=intervals]').value = DEFAULT_INTERVALS.join(', '); });
      $('#bk', root).addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(exportBackup())], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `callejero-cieza-copia-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      });
      $('#bkIn', root).addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { await importBackup(JSON.parse(await f.text())); toast('Copia importada.', 'ok'); draw(); } catch (err) { toast(err.message, 'error', 6000); }
      });
      $('#wipe', root).addEventListener('click', async () => {
        if (!(await confirmDialog('Borrar todos los datos', 'Esta acción no se puede deshacer. Descarga antes una copia de seguridad si quieres conservarlos.', 'Borrar'))) return;
        try { await resetAll(); toast('Datos borrados.', 'ok'); draw(); } catch (err) { toast(err.message, 'error', 6000); }
      });
      $('#upd', root).addEventListener('click', async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return toast('La actualización automática solo está disponible en la versión publicada.', 'info');
        await reg.update(); toast(reg.waiting ? 'Hay una versión nueva: pulsa «Actualizar» en el aviso.' : 'Ya tienes la última versión.', 'info');
      });
    };
    draw();
    const off = on((w) => { if (w === 'sync' || w === 'user') draw(); });
    return off;
  },
};
