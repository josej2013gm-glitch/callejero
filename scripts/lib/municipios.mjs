// Municipios configurados y rutas de sus archivos de datos.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadMunicipios() {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'data/municipios.json'), 'utf8'));
  const list = cfg.municipios || [];
  const ids = new Set();
  for (const m of list) {
    if (!/^[a-z0-9-]+$/.test(m.id)) throw new Error(`Identificador de municipio no válido: «${m.id}» (usa minúsculas, números y guiones).`);
    if (ids.has(m.id)) throw new Error(`Municipio repetido: ${m.id}`);
    ids.add(m.id);
  }
  return list;
}

export function paths(id) {
  const legacyVer = resolve(ROOT, 'data/verificaciones.json');
  const ver = resolve(ROOT, `data/verificaciones-${id}.json`);
  return {
    raw: resolve(ROOT, `data-raw/osm-${id}.json`),
    // Compatibilidad: antes de haber varios municipios, Cieza usaba data/verificaciones.json
    ver: existsSync(ver) ? ver : id === 'cieza' && existsSync(legacyVer) ? legacyVer : ver,
    out: resolve(ROOT, `public/data/callejero-${id}.geojson`),
    report: resolve(ROOT, `data/informe-importacion-${id}.md`),
    index: resolve(ROOT, 'public/data/municipios.json'),
  };
}

/** Interpreta el argumento --muni: un id, «todos», «faltantes» o «ninguno». */
export function selectMunicipios(list, arg = 'todos') {
  const a = String(arg || 'todos').toLowerCase();
  if (a === 'ninguno') return [];
  if (a === 'todos') return list;
  if (a === 'faltantes') return list.filter((m) => !existsSync(paths(m.id).raw));
  const m = list.find((x) => x.id === a);
  if (!m) throw new Error(`No existe el municipio «${arg}». Disponibles: ${list.map((x) => x.id).join(', ')}`);
  return [m];
}
