// Prueba del control de acceso con Firebase SIMULADO (tests/browser/firebase-stub).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 5182;
const srv = spawn(process.execPath, ['tests/browser/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const OWNER = 'propietario@gmail.com';
const results = [], errors = [];
const check = (n, c, x = '') => results.push([c ? 'OK ' : 'ERR', n, x]);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const google = (email) => ({ uid: 'u-' + email, email, displayName: email, emailVerified: true, providerData: [{ providerId: 'google.com' }] });

async function scenario(name, state, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.addInitScript((st) => { window.__FB = st; }, state);
  await page.route('**/src/config/firebase.js', (r) => r.fulfill({ contentType: 'text/javascript', body:
    `export const firebaseConfig={apiKey:'x',projectId:'p',appId:'a'};export const firebaseEnabled=true;export const ownerEmail='${OWNER}';export const APP_VERSION='test';` }));
  await page.route(`http://localhost:${PORT}/`, async (r) => {
    const res = await r.fetch(); let b = await res.text();
    b = b.replace('"leaflet":"/tests/browser/leaflet-stub.js"', '"leaflet":"/tests/browser/leaflet-stub.js","firebase/app":"/tests/browser/firebase-stub/app.js","firebase/auth":"/tests/browser/firebase-stub/auth.js","firebase/firestore":"/tests/browser/firebase-stub/firestore.js"');
    r.fulfill({ response: res, body: b });
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(800);
  await fn(page);
  await ctx.close();
}

try {
  await scenario('sin sesión', { current: null, owner: OWNER, list: [] }, async (p) => {
    check('Sin sesión → pantalla de acceso', await p.locator('#g').isVisible());
    check('Solo botón de Google (sin correo/contraseña ni modo local)', (await p.locator('input[type=password]').count()) === 0 && !(await p.textContent('body')).includes('sin cuenta'));
    await p.goto(`http://localhost:${PORT}/#/estadisticas`); await p.waitForTimeout(600);
    check('Sin sesión no se puede abrir otra sección', await p.locator('#g').isVisible());
  });
  await scenario('no autorizado', { current: null, loginAs: google('intruso@gmail.com'), owner: OWNER, list: [] }, async (p) => {
    await p.click('#g'); await p.waitForTimeout(900);
    check('Cuenta no autorizada → expulsada con aviso', (await p.textContent('#err')).includes('no está autorizada') && await p.locator('#g').isVisible());
  });
  await scenario('no google', { current: null, loginAs: { ...google('a@b.com'), providerData: [{ providerId: 'password' }] }, owner: OWNER, list: ['a@b.com'] }, async (p) => {
    await p.click('#g'); await p.waitForTimeout(900);
    check('Cuenta que no es de Google → expulsada', (await p.textContent('#err')).includes('Google'));
  });
  await scenario('propietario', { current: null, loginAs: google(OWNER), owner: OWNER, list: [] }, async (p) => {
    await p.click('#g'); await p.waitForTimeout(1200);
    check('Propietario entra en la app', await p.locator('.stat').first().isVisible());
    await p.goto(`http://localhost:${PORT}/#/ajustes`); await p.waitForTimeout(800);
    check('Propietario ve «Cuentas autorizadas»', await p.locator('#acc').isVisible());
    await p.fill('#accf input', 'Amigo@Gmail.com'); await p.click('#accf button'); await p.waitForTimeout(500);
    check('Autoriza una cuenta (en minúsculas)', (await p.textContent('#acc')).includes('amigo@gmail.com'));
    await p.screenshot({ path: '/tmp/e2e2/acceso-ajustes.png' });
  });
  await scenario('autorizado', { current: null, loginAs: google('amigo@gmail.com'), owner: OWNER, list: ['amigo@gmail.com'] }, async (p) => {
    await p.click('#g'); await p.waitForTimeout(1200);
    check('Cuenta autorizada entra', await p.locator('.stat').first().isVisible());
    await p.goto(`http://localhost:${PORT}/#/ajustes`); await p.waitForTimeout(800);
    check('Cuenta autorizada NO ve la gestión de cuentas', (await p.locator('#acc').count()) === 0);
  });
} catch (e) { errors.push('EXCEPCIÓN: ' + e.message); }
finally { await browser.close(); srv.kill(); }
for (const r of results) console.log(r.join('  '));
console.log(errors.length ? 'Errores:\n' + errors.join('\n') : 'Sin errores de JavaScript.');
process.exit(errors.length || results.some((r) => r[0] === 'ERR') ? 1 : 0);
