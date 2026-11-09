// SUSTITUTO MÍNIMO DE LEAFLET PARA PRUEBAS AUTOMÁTICAS (no se usa en la aplicación).
// Implementa solo la parte de la API que usa src/ui/map.js y dibuja en SVG, para poder
// probar los flujos en un navegador sin instalar dependencias.

const TILE = 256;
const project = (lat, lng, z) => {
  const s = TILE * 2 ** z, x = ((lng + 180) / 360) * s;
  const r = (lat * Math.PI) / 180, y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s;
  return [x, y];
};
const unproject = (x, y, z) => {
  const s = TILE * 2 ** z, lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
};
const toLL = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);

class Bounds {
  constructor(a, b) { this.s = Infinity; this.w = Infinity; this.n = -Infinity; this.e = -Infinity; if (a) this.extend(a); if (b) this.extend(b); }
  extend(p) {
    if (p instanceof Bounds) { this.extend({ lat: p.s, lng: p.w }); this.extend({ lat: p.n, lng: p.e }); return this; }
    if (Array.isArray(p) && Array.isArray(p[0])) { p.forEach((x) => this.extend(x)); return this; }
    const q = toLL(p); this.s = Math.min(this.s, q.lat); this.n = Math.max(this.n, q.lat); this.w = Math.min(this.w, q.lng); this.e = Math.max(this.e, q.lng); return this;
  }
  pad(r) { const dl = (this.n - this.s) * r, dg = (this.e - this.w) * r; const b = new Bounds(); b.s = this.s - dl; b.n = this.n + dl; b.w = this.w - dg; b.e = this.e + dg; return b; }
  contains(p) { const q = toLL(p); return q.lat >= this.s && q.lat <= this.n && q.lng >= this.w && q.lng <= this.e; }
}

class Evented { constructor() { this._ev = {}; } on(t, fn) { for (const k of t.split(' ')) (this._ev[k] ||= []).push(fn); return this; } off() { this._ev = {}; return this; } fire(t, e) { (this._ev[t] || []).forEach((f) => f(e)); } }

class Layer extends Evented {
  addTo(t) { t.addLayer(this); return this; }
  remove() { this._parent?.removeLayer(this); return this; }
  bindTooltip(t) { this._tip = t; return this; }
  setStyle(o) { Object.assign(this.opts, o); this._map?._render(); return this; }
  bringToBack() { return this; }
}
class Group extends Layer {
  constructor() { super(); this.layers = new Set(); }
  addLayer(l) { this.layers.add(l); l._parent = this; this._map?._render(); return this; }
  removeLayer(l) { this.layers.delete(l); this._map?._render(); return this; }
  clearLayers() { this.layers.clear(); this._map?._render(); return this; }
  _svg(m) { return [...this.layers].map((l) => l._svg(m)).join(''); }
}
class Poly extends Layer {
  constructor(ll, opts = {}, closed = false) { super(); this.ll = ll; this.opts = opts; this.closed = closed; }
  _svg(m) {
    const lines = Array.isArray(this.ll[0]?.[0]) ? this.ll : [this.ll];
    return lines.map((l) => `<polyline points="${l.map((p) => m._px(p).join(',')).join(' ')}" fill="${this.closed ? this.opts.fillColor || 'none' : 'none'}" fill-opacity="${this.opts.fillOpacity ?? 0.5}" stroke="${this.opts.color || '#3388ff'}" stroke-width="${this.opts.weight || 3}" stroke-opacity="${this.opts.opacity ?? 1}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  }
}
class Circle extends Layer {
  constructor(ll, opts = {}) { super(); this.ll = ll; this.opts = opts; }
  _svg(m) { const [x, y] = m._px(this.ll); return `<circle cx="${x}" cy="${y}" r="${this.opts.radius || 8}" fill="${this.opts.fillColor || '#38f'}" stroke="${this.opts.color || '#fff'}" stroke-width="${this.opts.weight || 2}"/>`; }
}
class Marker extends Layer {
  constructor(ll, opts = {}) { super(); this.ll = ll; this.opts = opts; }
  _svg(m) { const [x, y] = m._px(this.ll); return `<foreignObject x="${x - 14}" y="${y - 14}" width="28" height="28"><div xmlns="http://www.w3.org/1999/xhtml" class="${this.opts.icon?.o.className || ''}">${this.opts.icon?.o.html || ''}</div></foreignObject>`; }
}
class Tooltip extends Layer {
  constructor(o = {}) { super(); this.opts = o; }
  setLatLng(ll) { this.ll = ll; return this; } setContent(c) { this.c = c; return this; }
  _svg(m) { const [x, y] = m._px(this.ll); return `<text x="${x}" y="${y}" font-size="11" text-anchor="middle" class="stub-label" paint-order="stroke" stroke="#fff" stroke-width="3">${String(this.c).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`; }
}
class TileLayer extends Layer { _svg() { return ''; } }

class MapStub extends Group {
  constructor(el, opts = {}) {
    super(); this.el = el; this._map = this; this.z = 15; this.c = { lat: 38.24, lng: -1.42 };
    el.innerHTML = '<svg width="100%" height="100%" style="display:block"></svg>';
    el.style.position = el.style.position || 'relative';
    this.svg = el.firstChild;
    this.attributionControl = { setPrefix() {}, addAttribution() {} };
    this.svg.addEventListener('click', (e) => {
      const r = this.svg.getBoundingClientRect();
      this.fire('click', { latlng: this._ll(e.clientX - r.left, e.clientY - r.top) });
    });
  }
  addLayer(l) { super.addLayer(l); l._map = this; if (l instanceof Group) for (const x of l.layers) x._map = this; return this; }
  _size() { return [this.el.clientWidth || 600, this.el.clientHeight || 400]; }
  _px(p) { const q = toLL(p), [w, h] = this._size(), c = project(this.c.lat, this.c.lng, this.z), a = project(q.lat, q.lng, this.z); return [Math.round(a[0] - c[0] + w / 2), Math.round(a[1] - c[1] + h / 2)]; }
  _ll(x, y) { const [w, h] = this._size(), c = project(this.c.lat, this.c.lng, this.z); return unproject(c[0] + x - w / 2, c[1] + y - h / 2, this.z); }
  _render() { clearTimeout(this._t); this._t = setTimeout(() => { if (this.svg.isConnected) this.svg.innerHTML = this._svg(this); }, 10); }
  setView(ll, z) { this.c = toLL(ll); this.z = z ?? this.z; this._render(); this.fire('moveend'); return this; }
  fitBounds(b, o = {}) {
    if (!(b instanceof Bounds)) b = new Bounds(b[0], b[1]);
    const [w, h] = this._size(); this.c = { lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 };
    let z = 19; while (z > 3) { const a = project(b.n, b.w, z), c = project(b.s, b.e, z); if (c[0] - a[0] < w - 60 && c[1] - a[1] < h - 60) break; z--; }
    this.z = Math.min(z, o.maxZoom || 19); this._render(); this.fire('moveend'); return this;
  }
  getZoom() { return this.z; }
  getBounds() { const [w, h] = this._size(), a = this._ll(0, 0), b = this._ll(w, h); return new Bounds([b.lat, a.lng], [a.lat, b.lng]); }
  invalidateSize() { this._render(); }
  remove() { this.el.innerHTML = ''; }
}

const L = {
  map: (el, o) => new MapStub(el, o), canvas: () => ({}), tileLayer: () => new TileLayer(), layerGroup: () => new Group(),
  polyline: (ll, o) => new Poly(ll, o), polygon: (ll, o) => new Poly(ll, o, true), circleMarker: (ll, o) => new Circle(ll, o),
  marker: (ll, o) => new Marker(ll, o), divIcon: (o) => ({ o }), tooltip: (o) => new Tooltip(o),
  latLngBounds: (a, b) => new Bounds(a, b), DomEvent: { stopPropagation() {} },
};
export default L;
