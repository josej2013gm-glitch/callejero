// Prueba de extremo a extremo en Chrome (Playwright) con el callejero ficticio.
// Requiere playwright instalado. Uso: node tests/browser/e2e.mjs [carpeta-capturas]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/e2e';
mkdirSync(OUT, { recursive: true });
const PORT = 5181;
const srv = spawn(process.execPath, ['tests/browser/serve.mjs', String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 900));
const BASE = `http://localhost:${PORT}/`;
const errors = [];
const results = [];
const check = (name, cond, extra = '') => { results.push([cond ? 'OK ' : 'ERR', name, extra]); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'es-ES' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const go = async (h) => { await page.goto(BASE + h); await page.waitForTimeout(500); };

try {
  await go('');
  await page.waitForSelector('.stat');
  check('Dashboard carga en modo local', (await page.locator('.stat').count()) === 4);
  await shot('01-dashboard');

  // Mapa
  await go('#/mapa');
  await page.fill('#q', 'mayor');
  await page.waitForTimeout(200);
  await page.click('#results a[data-s]');
  await page.waitForTimeout(300);
  const info = await page.textContent('#info');
  check('Mapa: búsqueda y ficha de calle', info.includes('Calle Mayor') && info.includes('Cruces'), info.slice(0, 80));
  await shot('02-mapa');
  await page.check('#lyMudo'); await page.waitForTimeout(300);
  check('Mapa: modo mudo activable', await page.isChecked('#lyMudo'));

  // Entrenamiento
  await go('#/entrenamiento');
  await page.check('#all'); await page.uncheck('#all'); await page.check('input[name=tipo][value=cruces]');
  await page.selectOption('select[name=n]', '5');
  await page.click('#cfg button[type=submit]');
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('.opt');
    if (i === 0) await shot('03-entrenamiento-pregunta');
    await page.locator('.opt').first().click();
    await page.waitForSelector('.q-feedback:not(.hidden)');
    if (i === 0) await shot('04-entrenamiento-correccion');
    await page.locator('.q-feedback .btn').click();
  }
  await page.waitForSelector('.result');
  check('Entrenamiento: 5 preguntas y resumen', (await page.textContent('.result')).includes('aciertos de 5'));
  await shot('05-entrenamiento-resumen');

  // Simulacro oficial
  await go('#/simulacro');
  await page.fill('#off input[name=min]', '0');
  await page.click('#off button[type=submit]');
  await page.waitForSelector('.exam');
  check('Simulacro: 20 preguntas en la navegación', (await page.locator('#qnav button').count()) === 20);
  await shot('06-simulacro');
  // Lee la clave de respuestas del simulacro guardado en IndexedDB para responder 12 bien, 3 mal y 5 en blanco
  await page.waitForTimeout(300);
  const key = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('callejero-local'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('simInProgress'); g.onsuccess = () => res(g.result.qs.map((q) => q.answer)); }; }));
  for (let i = 0; i < 15; i++) { await page.locator('#qnav button').nth(i).click(); await page.locator('.opt').nth(i < 12 ? key[i] : (key[i] + 1) % 4).click(); }
  // Pulsar de nuevo la opción marcada deja la pregunta en blanco
  await page.locator('#qnav button').nth(3).click(); await page.locator('.opt').nth(key[3]).click();
  check('Simulacro: pulsar de nuevo deja en blanco', (await page.textContent('#answered')).startsWith('14 contestadas'));
  await page.locator('.opt').nth(key[3]).click();
  await page.click('#submit');
  await page.waitForSelector('.modal');
  check('Simulacro: resumen antes de entregar', (await page.textContent('.modal')).includes('15'));
  await shot('07-simulacro-confirmar');
  await page.locator('.modal .btn.primary').click();
  await page.waitForSelector('.result');
  const rtxt = await page.textContent('.result');
  const m = rtxt.match(/(\d+) aciertos × 0,10.*?(\d+) errores × 0,03.*?(\d+) en blanco/s);
  const nota = rtxt.match(/(\d,\d\d)\s*\/\s*2,00/);
  if (m && nota) {
    const [c, w, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const expected = Math.max(0, Math.round((c * 0.1 - w * 0.03) * 100) / 100).toFixed(2).replace('.', ',');
    check('Simulacro: puntuación +0,10/−0,03 exacta', c === 12 && w === 3 && b === 5 && nota[1] === '1,11' && expected === '1,11', `${c} A, ${w} E, ${b} B → ${nota[1]} (esperado ${expected})`);
  } else check('Simulacro: resultado legible', false, rtxt.slice(0, 200));
  check('Simulacro: revisión con explicaciones', (await page.locator('.review-item .q-feedback').count()) === 20);
  await shot('08-simulacro-resultado');

  // Persistencia tras recargar
  await page.reload(); await page.waitForTimeout(600); await go('#/estadisticas');
  check('Persistencia: historial tras recargar', (await page.locator('.tbl tbody tr').count()) >= 1);
  await shot('09-estadisticas');

  // Simulacro en curso se recupera
  await go('#/simulacro');
  await page.selectOption('#tr select[name=n]', '5');
  await page.click('#tr button[type=submit]');
  await page.waitForSelector('.exam');
  await page.locator('.opt').first().click();
  await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(700);
  await go('#/simulacro');
  check('Simulacro sin entregar se puede continuar', await page.locator('#resume').isVisible());
  await page.click('#resume'); await page.waitForSelector('.exam');
  check('Simulacro recuperado conserva respuestas', (await page.textContent('#answered')).startsWith('1 contestadas'));

  // Mapa mudo
  await go('#/mudo');
  await shot('10-mudo-niveles');
  await page.click('button[data-l="1"]');
  await page.waitForSelector('.opt');
  await page.waitForTimeout(300);
  await shot('11-mudo-pregunta');
  await page.locator('.opt').first().click();
  check('Mapa mudo: corrección inmediata', await page.locator('.q-feedback:not(.hidden)').isVisible());

  // Localizar tocando el mapa
  await go('#/entrenamiento');
  await page.check('#all'); await page.uncheck('#all'); await page.check('input[name=tipo][value=localizar]');
  await page.selectOption('select[name=diff]', '1');
  await page.click('#cfg button[type=submit]');
  let tapped = false;
  for (let k = 0; k < 8 && !tapped; k++) {
    await page.waitForSelector('.q-prompt');
    if ((await page.textContent('.q-prompt')).startsWith('Toca')) {
      await page.waitForTimeout(300);
      const box = await page.locator('.q-map').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector('.q-feedback:not(.hidden)'); tapped = true;
      await shot('12-localizar-toque');
    } else { await page.locator('.opt').first().click(); await page.locator('.q-feedback .btn').click(); }
  }
  check('Localizar por toque evalúa el clic', tapped);

  // Entrenamiento con varias modalidades: solo salen las elegidas
  await go('#/'); await go('#/entrenamiento');
  await page.check('#all'); await page.uncheck('#all');
  await page.check('input[name=tipo][value=cruces]'); await page.check('input[name=tipo][value=edificios]');
  check('Entrenamiento: «Mixto» se desmarca al elegir algunas', !(await page.isChecked('#all')));
  await page.selectOption('select[name=n]', '10');
  await page.click('#cfg button[type=submit]');
  const cats = new Set();
  for (let i = 0; i < 10; i++) {
    await page.waitForSelector('.opt');
    cats.add(await page.locator('.q-meta .chip').first().textContent());
    await page.locator('.opt').first().click(); await page.locator('.q-feedback .btn').click();
  }
  check('Entrenamiento: solo modalidades elegidas', [...cats].every((c) => ['Cruces de calles', 'Edificios públicos y servicios'].includes(c)), [...cats].join(' | '));
  // Simulacro: solo las 5 modalidades del simulacro
  await go('#/simulacro');
  await page.click('#discard').catch(() => {});
  await page.waitForTimeout(200);
  await page.selectOption('#tr select[name=n]', '30');
  await page.click('#tr button[type=submit]'); await page.waitForSelector('.exam');
  const simCats = new Set();
  const nq = await page.locator('#qnav button').count();
  for (let i = 0; i < nq; i++) { await page.locator('#qnav button').nth(i).click(); simCats.add(await page.locator('.q-meta .chip').first().textContent()); }
  const okCats = ['Localizar una calle en el mapa', 'Identificar una calle resaltada', 'Cruces de calles', 'Edificios públicos y servicios', 'Accesos y vías principales'];
  check('Simulacro: solo las 5 modalidades', nq === 30 && [...simCats].every((c) => okCats.includes(c)), `${nq} preg.: ` + [...simCats].join(' | '));
  await go('#/simulacro'); await page.click('#discard').catch(() => {});

  // ---- Varios municipios: datos separados y simulacro de mapa mudo ----
  await go('#/'); await page.waitForSelector('.muni-tabs');
  await page.click('[data-muni="jumilla"]'); await page.waitForTimeout(700);
  check('Municipios: cambio con las pestañas', (await page.textContent('.muni-tabs .on')).includes('Otrapueba') && (await page.inputValue('#muniSel')) === 'jumilla');
  await go('#/estadisticas');
  check('Municipios: historial separado (vacío en el segundo)', (await page.textContent('main')).includes('Aún no has hecho simulacros'));
  await go('#/simulacro');
  check('Municipios: formato de simulacro propio (mapa mudo)', await page.locator('#mm').isVisible() && !(await page.locator('#off').count()));
  await page.click('#mm button[type=submit]'); await page.waitForSelector('.mm-list input');
  const nItems = await page.locator('.mm-list input').count();
  await page.waitForTimeout(300); await shot('19-mapa-mudo-examen');
  // Lee las vías numeradas guardadas y responde 5 bien (sin «Calle» ni tildes), 1 mal, resto en blanco
  const mm = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('callejero-local'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('simInProgress:jumilla'); g.onsuccess = () => res(g.result); }; }));
  const geo = await page.evaluate(async () => (await (await fetch('/data/callejero-jumilla.geojson')).json()).features.filter((f) => f.properties.kind === 'street').map((f) => [f.properties.id, f.properties.name]));
  const nameOf = Object.fromEntries(geo);
  for (let i = 0; i < 6; i++) {
    const txt = i < 5 ? nameOf[mm.ids[i]].replace(/^(Calle|Avenida) (del |de la |de )?/, '').toLowerCase() : 'Calle Inventada';
    await page.locator('.mm-list input').nth(i).fill(txt);
  }
  await page.click('#submit'); await page.waitForSelector('.modal'); await page.locator('.modal .btn.primary').click();
  await page.waitForSelector('.result');
  const rtxt2 = await page.textContent('.result');
  const exp2 = (Math.round((5 / nItems) * 1000) / 100).toFixed(2).replace('.', ',');
  check('Mapa mudo: corrección y nota sobre 10', rtxt2.includes('5 aciertos') && rtxt2.includes('1 errores') && rtxt2.includes(exp2 + ' / 10,00'), `${nItems} vías → ${exp2}`);
  await page.waitForTimeout(300); await shot('20-mapa-mudo-resultado');
  await go('#/estadisticas');
  check('Municipios: el simulacro queda en el historial del segundo', (await page.locator('.tbl tbody tr').count()) >= 1 && (await page.textContent('main')).includes('mapa mudo'));
  await page.click('[data-muni="vacio"]'); await page.waitForTimeout(600);
  check('Municipio sin datos: instrucciones', (await page.textContent('main')).includes('Todavía no hay callejero de Sindatos'));
  await page.click('[data-muni="cieza"]'); await page.waitForTimeout(700); await go('#/estadisticas');
  check('Municipios: al volver, el historial del primero sigue igual', (await page.textContent('main')).includes('Oficial · test') && !(await page.textContent('main')).includes('mapa mudo'));

  // Repaso, zonas, admin, ajustes
  await go('#/repaso');
  check('Repaso: lista de prioridades', (await page.textContent('main')).includes('conceptos pendientes'));
  await shot('13-repaso');
  if (await page.locator('#rFail').isEnabled()) { await page.click('#rFail'); await page.waitForSelector('.opt'); check('Repaso: repetir falladas', true); }
  await go('#/zonas');
  check('Zonas: tarjetas', (await page.locator('.zone').count()) >= 3);
  await shot('14-zonas');
  await page.locator('.zone .btn', { hasText: 'Estudiar' }).first().click(); await page.waitForTimeout(400);
  check('Zonas: ficha de estudio', (await page.locator('.study-list li').count()) > 0);
  await go('#/admin');
  await page.locator('#list li').first().click(); await page.waitForSelector('#sf');
  await page.selectOption('#sf select[name=status]', 'verificado');
  await page.fill('#sf input[name=source]', 'Prueba automática');
  await page.click('#sf button[type=submit]'); await page.waitForTimeout(300);
  check('Admin: guardar verificación', (await page.textContent('#list')).includes('Verificado'));
  await shot('15-admin');
  await go('#/admin?tab=datos');
  await page.click('#selftest'); await page.waitForSelector('#stres p', { timeout: 15000 });
  const st = await page.textContent('#stres');
  check('Admin: autocomprobación del generador sin errores', /, 0 con errores/.test(st.replace(/\s+/g, ' ')), st.slice(0, 80));
  await go('#/ajustes');
  await shot('16-ajustes');

  // Móvil
  await page.setViewportSize({ width: 390, height: 844 });
  await go('');
  await shot('17-movil-inicio');
  await go('#/simulacro');
  await page.click('#discard').catch(() => {});
  await page.waitForTimeout(200);
  await page.click('#tr button[type=submit]'); await page.waitForSelector('.exam'); await page.waitForTimeout(400);
  await shot('18-movil-simulacro');
  check('Móvil: navegación inferior visible', await page.locator('.bottomnav').isVisible());
} catch (e) {
  errors.push('EXCEPCIÓN: ' + e.message);
  await shot('error').catch(() => {});
} finally {
  await browser.close(); srv.kill();
}
for (const r of results) console.log(r.join('  '));
console.log(errors.length ? '\nErrores:\n' + errors.join('\n') : '\nSin errores de JavaScript.');
process.exit(errors.length || results.some((r) => r[0] === 'ERR') ? 1 : 0);
