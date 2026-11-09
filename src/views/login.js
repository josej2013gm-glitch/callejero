import { html, setHTML, $ } from '../ui/dom.js';
import * as cloud from '../services/cloud.js';

export default {
  title: 'Acceso',
  bare: true,
  render(root) {
    const notice = sessionStorage.getItem('loginError') || '';
    sessionStorage.removeItem('loginError');
    setHTML(root, html`
      <div class="login card">
        <img src="icons/icon-192.png" alt="" width="72" height="72">
        <h1>Callejero Cieza</h1>
        <p>Preparación de la prueba de callejero · Agente de Policía Local</p>
        <button class="btn primary big" id="g" type="button">Entrar con Google</button>
        <p class="err" id="err" role="alert">${notice}</p>
        <p class="small muted">Acceso restringido a cuentas de Google autorizadas.</p>
      </div>`);
    $('#g', root).addEventListener('click', () => cloud.signInGoogle().catch((e) => { $('#err', root).textContent = cloud.explain(e).msg; }));
  },
};
