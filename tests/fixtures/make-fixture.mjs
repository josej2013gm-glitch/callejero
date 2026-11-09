// Genera un volcado OSM SINTÉTICO de una localidad ficticia («Villaprueba»), situada
// en coordenadas (10° N, 10° E) que no corresponden a Cieza. Solo se usa en las pruebas
// automáticas y en la prueba visual; nunca debe publicarse como dato real.
//
//   node tests/fixtures/make-fixture.mjs salida.json

import { writeFileSync } from 'node:fs';

const LAT0 = 10, LON0 = 10;
const DX = 120 / (111320 * Math.cos(LAT0 * Math.PI / 180)); // 120 m en longitud
const DY = 100 / 111320;                                    // 100 m en latitud

export function makeFixture() {
  const elements = [];
  let nid = 1000, wid = 1;
  const grid = new Map();
  const node = (x, y, tags) => {
    const e = { type: 'node', id: nid++, lat: LAT0 + y * DY, lon: LON0 + x * DX };
    if (tags) e.tags = tags;
    elements.push(e); return e.id;
  };
  const g = (x, y) => { const k = x + ',' + y; if (!grid.has(k)) grid.set(k, node(x, y)); return grid.get(k); };
  const way = (nodes, tags) => { elements.push({ type: 'way', id: wid++, nodes, tags }); };

  const ns = ['Calle del Olmo', 'Calle del Pino', 'Avenida Central', 'Calle del Roble', 'Calle del Sauce', 'Calle del Fresno'];
  const ew = ['Calle Primera', 'Calle Segunda', 'Calle Mayor', 'Calle Cuarta', 'Calle Quinta', 'Calle Sexta'];
  // Calles norte-sur, divididas en dos vías OSM cada una (como en la realidad)
  ns.forEach((name, x) => {
    const hw = name.startsWith('Avenida') ? 'tertiary' : 'residential';
    way([0, 1, 2].map((y) => g(x, y)), { highway: hw, name });
    way([2, 3, 4, 5].map((y) => g(x, y)), { highway: hw, name });
  });
  ew.forEach((name, y) => {
    const hw = name === 'Calle Mayor' ? 'secondary' : 'residential';
    way([0, 1, 2, 3, 4, 5].map((x) => g(x, y)), { highway: hw, name });
  });
  // Diagonal que atraviesa la cuadrícula
  way([0, 1, 2, 3, 4, 5].map((i) => g(i, i)), { highway: 'residential', name: 'Avenida Diagonal' });
  // Carretera de acceso hacia el oeste, con referencia
  way([g(0, 2), node(-2, 2), node(-4, 2.2), node(-7, 2.5)], { highway: 'primary', name: 'Carretera de Villaprueba', ref: 'VP-1' });
  // Calle curva al este, sin cruces con la cuadrícula salvo en su arranque
  way([g(5, 0), node(5.8, 0.4), node(6.4, 1.2), node(6.7, 2.2), node(6.8, 3.2)], { highway: 'residential', name: 'Calle Curva' });
  // Polígono industrial
  const pa = [node(7.5, -1), node(8.5, -1), node(9.5, -1)];
  way(pa, { highway: 'service', name: 'Calle Industria A' });
  way([node(8.5, -2), pa[1], node(8.5, 0)], { highway: 'service', name: 'Calle Industria B' });
  const ring = [node(7, -2.5), node(10, -2.5), node(10, 0.5), node(7, 0.5)];
  way([...ring, ring[0]], { landuse: 'industrial', name: 'Polígono Industrial Ficticio' });
  // Aldea a 3 km con una calle que repite nombre
  node(30, 3, { place: 'hamlet', name: 'Aldea Ficticia' });
  way([node(29, 2.5), node(31, 2.5), node(32, 2.6)], { highway: 'residential', name: 'Calle del Olmo' });
  // Camino rural
  way([node(-7, 2.5), node(-12, 6), node(-20, 8)], { highway: 'track', name: 'Camino de los Pinos' });
  // Lugares
  node(2.5, 2.5, { place: 'town', name: 'Villaprueba' });
  node(2.5, 4.6, { place: 'neighbourhood', name: 'Barrio Norte' });
  node(2.5, 0.4, { place: 'neighbourhood', name: 'Barrio Sur' });
  // Puntos de interés
  node(2.1, 2.12, { amenity: 'townhall', name: 'Ayuntamiento de Villaprueba', 'addr:street': 'Calle Mayor', 'addr:housenumber': '1' });
  node(3.07, 1.5, { amenity: 'police', name: 'Policía Local de Villaprueba' });
  node(0.92, 3.5, { amenity: 'clinic', name: 'Centro de Salud Villaprueba' });
  node(4.5, 0.08, { amenity: 'marketplace', name: 'Mercado de Abastos' });
  node(1.5, 4.92, { amenity: 'library', name: 'Biblioteca Municipal', 'addr:street': 'Calle Inexistente' });
  node(3.5, 5.1, { amenity: 'pharmacy' }); // sin nombre: se descarta
  const sc = [node(4.15, 3.15), node(4.85, 3.15), node(4.85, 3.85), node(4.15, 3.85)];
  way([...sc, sc[0]], { amenity: 'school', name: 'Colegio Público Ficticio' });
  return { version: 0.6, generator: 'fixture', osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z' }, elements };
}

if (process.argv[1] && process.argv[1].endsWith('make-fixture.mjs')) {
  const out = process.argv[2] || 'fixture-osm.json';
  writeFileSync(out, JSON.stringify(makeFixture()));
  console.log('Fixture escrito en', out);
}
