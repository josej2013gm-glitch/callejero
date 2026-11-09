// Gráficos SVG sencillos y accesibles (sin librerías).

import { esc } from './dom.js';

const W = 640, H = 220, P = { l: 38, r: 12, t: 14, b: 30 };

/** Línea temporal. series: [{name, color, points:[{x: etiqueta, y}]}]; las x deben coincidir. */
export function lineChart(series, { yMax = null, yMin = 0, refLine = null, refLabel = '', fmt = (v) => v } = {}) {
  const xs = series[0]?.points.map((p) => p.x) || [];
  if (!xs.length) return '<p class="muted">Sin datos todavía.</p>';
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
  const max = yMax ?? Math.max(1, ...all);
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const x = (i) => P.l + (xs.length === 1 ? iw / 2 : (i * iw) / (xs.length - 1));
  const y = (v) => P.t + ih - ((v - yMin) / (max - yMin)) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = yMin + ((max - yMin) * k) / 4;
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${esc(fmt(v))}</text>`;
  }
  const step = Math.ceil(xs.length / 8);
  xs.forEach((lbl, i) => { if (i % step === 0 || i === xs.length - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(lbl)}</text>`; });
  if (refLine != null) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(refLine)}" y2="${y(refLine)}" class="ref"/><text x="${W - P.r}" y="${y(refLine) - 4}" text-anchor="end" class="ax ref-t">${esc(refLabel)}</text>`;
  for (const s of series) {
    const pts = s.points.map((p, i) => (p.y == null ? null : [x(i), y(p.y), p])).filter(Boolean);
    if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}"/>`;
    for (const [px, py, p] of pts) g += `<circle cx="${px}" cy="${py}" r="3.5" fill="${s.color}"><title>${esc(s.name)} · ${esc(p.x)}: ${esc(fmt(p.y))}</title></circle>`;
  }
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolución">${g}</svg>${legend}`;
}

/** Barras horizontales. items: [{label, value (0–100), note}] */
export function barList(items, { suffix = ' %', max = 100 } = {}) {
  if (!items.length) return '<p class="muted">Sin datos todavía.</p>';
  return `<div class="barlist">${items.map((it) => {
    const p = Math.max(0, Math.min(100, (it.value / max) * 100));
    const cls = it.value >= 80 ? 'good' : it.value >= 50 ? 'mid' : 'low';
    return `<div class="barrow"><div class="bl">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</div><div class="bt"><span class="${cls}" style="width:${p}%"></span></div><div class="bv">${esc(Math.round(it.value))}${suffix}</div></div>`;
  }).join('')}</div>`;
}
