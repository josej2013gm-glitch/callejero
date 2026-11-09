import { html, setHTML, $, toast } from '../ui/dom.js';
import * as cloud from '../services/cloud.js';
import { authMethods } from '../config/firebase.js';
import { setLocalMode } from '../app/store.js';

export default {
  title: 'Acceso',
  bare: true,
  render(root) {
    setHTML(root, html`
      <div class="login card">
        <img src="icons/icon-192.png" alt="" width="72" height="72">
        <h1>Callejero Cieza</h1>
        <p>Preparación de la prueba de callejero · Agente de Policía Local</p>
        ${authMethods.includes('google') ? html`<button class="btn primary big" id="g" type="button">Entrar con Google</button>` : ''}
        ${authMethods.includes('email') ? html`
          <form id="ef" class="form">
            <label>Correo electrónico <input type="email" name="email" required autocomplete="email"></label>
            <label>Contraseña <input type="password" name="pass" required minlength="6" autocomplete="current-password"></label>
            <div class="row"><button class="btn" type="submit" name="act" value="in">Entrar</button><button class="btn ghost" type="submit" name="act" value="up">Crear cuenta</button></div>
            <button class="link small" id="reset" type="button">He olvidado la contraseña</button>
          </form>` : ''}
        <p class="err" id="err" role="alert"></p>
        <hr>
        <button class="link" id="local" type="button">Continuar sin cuenta (solo en este dispositivo)</button>
      </div>`);
    const err = (e) => { $('#err', root).textContent = cloud.explain(e).msg; };
    $('#g', root)?.addEventListener('click', () => cloud.signInGoogle().catch(err));
    $('#ef', root)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target), act = e.submitter?.value;
      (act === 'up' ? cloud.registerEmail : cloud.signInEmail)(f.get('email'), f.get('pass')).catch(err);
    });
    $('#reset', root)?.addEventListener('click', () => {
      const email = root.querySelector('[name=email]').value;
      if (!email) return toast('Escribe primero tu correo.', 'warn');
      cloud.resetPassword(email).then(() => toast('Te hemos enviado un correo para restablecer la contraseña.', 'ok', 6000)).catch(err);
    });
    $('#local', root).addEventListener('click', async () => { await setLocalMode(true); location.hash = '#/'; location.reload(); });
  },
};
