// Repetición espaciada por «conceptos» (calles, cruces, edificios, relaciones).
// Cada concepto tiene una caja (0..n); al acertar sube de caja y el próximo repaso
// se aplaza según el intervalo de esa caja; al fallar vuelve a la caja 0.
//
// Claves de concepto:
//   st:<idCalle>   ix:<idA>|<idB>   poi:<idEdificio>   rel:<tipo>:<idA>|<idB>

export const DEFAULT_INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // días por caja
export const DAY = 86400000;
export const RETRY_MS = 10 * 60000; // un fallo vuelve a estar pendiente a los 10 minutos

export function newItem(k) {
  return { k, b: 0, due: 0, n: 0, ok: 0, ko: 0, lapses: 0, t: 0, last: 0, lastOk: null };
}

/**
 * Registra una respuesta.
 * ms: tiempo de respuesta; slowMs: umbral a partir del cual una respuesta correcta se
 * considera «lenta» y no sube de caja.
 */
export function review(item, { correct, ms = 0, now = Date.now(), intervals = DEFAULT_INTERVALS, slowMs = 25000 }) {
  const it = { ...item };
  it.n++; it.last = now; it.lastOk = !!correct;
  it.t = it.t ? Math.round(it.t * 0.7 + ms * 0.3) : ms;
  if (correct) {
    it.ok++;
    const slow = ms > slowMs;
    if (!slow) it.b = Math.min(it.b + 1, intervals.length - 1);
    const days = intervals[Math.max(1, it.b)];
    it.due = now + days * DAY;
    it.slow = slow;
  } else {
    it.ko++;
    if (it.b > 0) it.lapses++;
    it.b = 0; it.due = now + RETRY_MS; it.slow = false;
  }
  return it;
}

export function isDue(it, now = Date.now()) { return it.n > 0 && it.due <= now; }
export function isMastered(it) { return !!it && it.b >= 3 && it.lastOk === true; }

/** Prioridad de repaso: mayor = más urgente. */
export function priority(it, now = Date.now(), slowMs = 25000) {
  if (!it || !it.n) return 0;
  const overdueDays = Math.max(0, (now - it.due) / DAY);
  const errRate = it.ko / it.n;
  let p = 0;
  if (it.due <= now) p += 10 + Math.min(overdueDays, 30);
  p += errRate * 20 + it.lapses * 4;
  if (it.lastOk === false) p += 15;
  if (it.t > slowMs) p += 6;
  if (it.k.startsWith('ix:')) p += 2;   // los cruces confundidos se priorizan
  if (it.k.startsWith('rel:')) p += 2;  // y las relaciones geográficas
  return Math.round(p * 10) / 10;
}

/** Motivo legible de la prioridad. */
export function reason(it, now = Date.now(), slowMs = 25000) {
  const r = [];
  if (it.lastOk === false) r.push('fallada la última vez');
  else if (it.due <= now) r.push('repaso vencido');
  if (it.lapses) r.push(`${it.lapses} olvido${it.lapses > 1 ? 's' : ''}`);
  if (it.t > slowMs) r.push('respuesta lenta');
  if (!r.length) r.push(`caja ${it.b}`);
  return r.join(' · ');
}

/** Fusiona dos mapas de progreso (dispositivos distintos): gana la respuesta más reciente. */
export function mergeProgress(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || (v.last || 0) > (out[k].last || 0)) out[k] = v;
  return out;
}

export function parseIntervals(str) {
  const arr = String(str).split(/[,;\s]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  if (arr.length < 3) return null;
  arr.sort((x, y) => x - y);
  if (arr[0] !== 0) arr.unshift(0);
  return arr.slice(0, 10);
}
