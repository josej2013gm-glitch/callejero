// Utilidades mínimas de interfaz (sin framework).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Plantillas con escape automático: html`<b>${texto}</b>`; usa raw() para HTML de confianza. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.s : esc(x))).join('');
      else out += v.__raw ? v.s : esc(v);
    }
  });
  return { __raw: true, s: out, toString() { return out; } };
}
export const raw = (s) => ({ __raw: true, s: String(s), toString() { return String(s); } });

export function setHTML(el, tpl) { el.innerHTML = tpl.__raw ? tpl.s : String(tpl); return el; }

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 3500) {
  let t = $('#toast');
  if (!t) { t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.className = 'toast show ' + kind; t.textContent = msg;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Ventana modal. Devuelve una promesa con el valor del botón pulsado. */
export function modal({ title, body, buttons = [{ label: 'Cerrar', value: null }] }) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    setHTML(box, html`<h3>${title}</h3><div class="modal-body"></div><div class="modal-actions"></div>`);
    const b = $('.modal-body', box);
    if (typeof body === 'string' || body?.__raw) setHTML(b, body.__raw ? body : html`${body}`); else if (body) b.append(body);
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    for (const btn of buttons) $('.modal-actions', box).append(el('button', { class: 'btn ' + (btn.kind || ''), onclick: () => close(btn.value) }, btn.label));
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey);
    back.append(box); document.body.append(back);
    box.querySelector('.modal-actions .btn.primary, .modal-actions .btn')?.focus();
  });
}

export const confirmDialog = (title, body, okLabel = 'Aceptar') =>
  modal({ title, body, buttons: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, kind: 'primary' }] });

export function fmtDate(ts, withTime = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) + (withTime ? ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
}
export function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min ${r.toString().padStart(2, '0')} s` : `${r} s`;
}
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function progressBar(value, max = 100, cls = '') {
  const p = max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return html`<div class="bar ${cls}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
}
