# Estudio de Callejero · Oposición Policía Local

Aplicación web (PWA) para preparar la **prueba de callejero** de las oposiciones de Agente de Policía Local de **Cieza** y **Jumilla** (Murcia), ampliable a otros municipios: mapa interactivo, mapa mudo, entrenamiento geográfico, simulacros con el formato y la puntuación de cada convocatoria y repaso espaciado de errores.

Cada municipio es una «vertiente» independiente: su callejero, progreso, estadísticas, historial de simulacros, correcciones de datos y simulacro en curso son propios. Se cambia de municipio con las pestañas superiores o el selector del menú.

| Municipio | Formato del simulacro oficial | Fuente |
|---|---|---|
| Cieza | Test de 20 preguntas, +0,10 / −0,03 / 0, máximo 2 | Bases BORM n.º 140 de 20/06/2026 |
| Jumilla | Rellenar un mapa mudo (20 vías por defecto), nota de 0 a 10, mínimo 5 | Bases BORM n.º 76 de 01/04/2022 (convocatoria anterior; confirmar con las vigentes) |

Los formatos se configuran en `data/municipios.json`.

- **Gratuita**: GitHub Free + Firebase Spark (Hosting, Authentication y Firestore dentro de cuota). Sin servidores propios, sin IA, sin tarjeta bancaria.
- **Funciona sin conexión**: el callejero se guarda como datos vectoriales locales (GeoJSON) y la aplicación se instala en ordenador y móvil.
- **Acceso restringido**: solo cuentas de Google; entra el propietario (`VITE_OWNER_EMAIL`) y las cuentas que él autorice desde Ajustes. Lo impone Firestore con sus reglas.
- **Datos honestos**: todo procede de OpenStreetMap; cada vía, cruce y edificio indica su fuente, fecha y estado de verificación. Las preguntas solo se generan cuando los datos permiten una respuesta inequívoca.

> Instalación paso a paso: **[GUIA_INSTALACION.md](GUIA_INSTALACION.md)**.

## Puesta en marcha rápida

```bash
npm install
cp .env.example .env.local      # valores de Firebase y VITE_OWNER_EMAIL (sin ellos: modo local de desarrollo)
npm run data:import             # descarga de OpenStreetMap los callejeros que falten (una vez)
npm run dev                     # http://localhost:5173
npm run deploy                  # pruebas + validación + compilación + publicación en Firebase
```

## Módulos

| Módulo | Qué hace |
|---|---|
| **Inicio** | Dominio del callejero, calles estudiadas, últimos resultados, mejor nota, repasos pendientes y recomendación según tus errores. |
| **Mapa** | Leaflet con búsqueda, capas (mapa base, nombres, vías, edificios, puntos de interés), filtro por zona y categoría, ficha de cada vía (cruces, próximas, paralelas, edificios, fuente) y **modo mapa mudo**. |
| **Zonas** | Barrios, pedanías y polígonos de OSM + áreas de estudio (centro, residencial, periferia, accesos, entorno de edificios públicos). Cada una con nº de vías, estudiadas, dominio y modo estudio con nombres ocultables. |
| **Entrenamiento** | Una, varias o todas (mixto) de las 10 modalidades (localizar, identificar, cruces, próximas, paralelas, perpendiculares, edificios, accesos, orientación, recorridos) en 3 dificultades o progresiva, por zona o por calle; corrección inmediata con explicación y mapa. |
| **Simulacro** | Según el municipio. *Test* (Cieza): localizar, identificar, cruces, edificios y accesos (4/4/5/5/2), 20 preguntas, 4 alternativas, +0,10 / −0,03 / 0, máximo 2. Cronómetro, navegación, blancos, resumen antes de entregar, revisión con explicaciones. *Mapa mudo* (Jumilla): vías numeradas en un mapa sin nombres; se escribe cada nombre (no hace falta «Calle», artículos ni tildes) y se corrige con nota sobre 10. En todos: simulacros tipo test de práctica de 5, 10, 20 o 30 preguntas. Se recupera si se cierra la página. |
| **Mapa mudo** | 5 niveles progresivos (vías principales → localizar → cruces → calles secundarias → experto) que se desbloquean con 8 aciertos de 10. |
| **Repaso** | Repetición espaciada por conceptos (calles, cruces, edificios, relaciones) con intervalos configurables; prioriza fallos, olvidos y respuestas lentas. Repite falladas o genera preguntas nuevas sobre lo mismo. |
| **Estadísticas** | Aciertos, nota media y mejor, evolución, aciertos por semana, por categoría y por zona, calles dominadas/pendientes, errores frecuentes, tiempos e historial. |
| **Administración** | Revisar y corregir nombres, validar vías/edificios/cruces con su fuente, consultar avisos de importación, probar un nuevo conjunto de datos y exportar `verificaciones.json`. |

## Arquitectura

```
index.html, src/main.js        Interfaz (JavaScript sin framework) y enrutado
src/engine/                    Lógica pura, probada con Node: geometría, construcción del callejero,
                               generador de preguntas, verificador, puntuación, repaso espaciado
src/app/                       Estado, persistencia local, sincronización y métricas
src/services/                  IndexedDB (local) y Firebase (carga diferida)
src/views/, src/ui/            Pantallas y componentes (mapa Leaflet, pregunta, gráficos SVG)
scripts/                       Importación desde OpenStreetMap, construcción y validación de datos
data/municipios.json           Municipios, configuración y formato de examen de cada uno
data/overpass/<id>.overpassql  Consulta Overpass de cada municipio
data/verificaciones-<id>.json  Verificaciones manuales de cada municipio
data-raw/osm-<id>.json         Volcado de OpenStreetMap de cada municipio
public/data/                   Callejeros generados (callejero-<id>.geojson) e índice municipios.json
firestore.rules, firebase.json Seguridad y publicación
tests/                         Pruebas unitarias (node --test) y de extremo a extremo (Playwright)
```

**Datos**: `npm run data:import` consulta una sola vez la API Overpass, guarda el volcado en `data-raw/` y genera `public/data/callejero.geojson` con vías (tramos con el mismo nombre unidos), cruces por nodos compartidos con su ángulo, proximidad (≤ 200 m), paralelismo, edificios públicos asociados a su vía (por `addr:street` o por proximidad inequívoca), zonas y avisos de calidad. Es un GeoJSON estándar que puede abrirse en QGIS para contrastarlo con cartografía oficial.

**Publicación desde el navegador**: `.github/workflows/publicar.yml` instala, importa (si hace falta), prueba, valida, compila y publica en Firebase con cada cambio en `main` (ver GUIA_INSTALACION.md, anexo A).

**Firestore** guarda solo datos del usuario y la lista `config/access` de cuentas autorizadas. El progreso y las correcciones van en un documento por municipio (`progress`, `overrides` para Cieza; `progress-jumilla`, `overrides-jumilla`…) y cada sesión lleva el campo `muni`: `users/{uid}` (ajustes), `users/{uid}/state/progress` (repaso), `users/{uid}/state/overrides` (correcciones) y `users/{uid}/sessions/{id}` (un documento por sesión). IndexedDB es la fuente de verdad local; los cambios se envían agrupados y diferidos. Si se agota la cuota se avisa y se reintenta más tarde sin perder nada.

## Comandos

| Comando | Uso |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm run preview` | Compilación de producción y vista previa |
| `npm test` | Pruebas del motor (geometría, datos, generador, puntuación, repaso) |
| `npm run test:e2e` | Prueba en navegador con datos ficticios (requiere `npm i -D playwright` y Chrome) |
| `npm run data:import -- --muni <id\|todos\|faltantes>` | Descarga de OSM + construcción de los callejeros |
| `npm run data:build` | Reconstruye el callejero (p. ej. tras actualizar `data/verificaciones.json`) |
| `npm run data:validate` | Valida el callejero y verifica cientos de preguntas generadas |
| `npm run deploy` | Pruebas, validación, compilación y publicación |

## Limitaciones conocidas

- **Los datos de OpenStreetMap no son oficiales.** Pueden faltar calles, nombres o cruces, o estar desactualizados. La aplicación marca cada pregunta como «Datos OSM sin verificar» hasta que verificas sus elementos en Administración; puedes limitar las preguntas a datos verificados en Ajustes.
- **Las zonas no son delimitaciones oficiales**: se basan en etiquetas de OSM o en criterios explícitos (distancias al centro, tipo de vía), indicados en cada zona.
- **Sentidos de circulación**: los recorridos no consideran direcciones prohibidas ni giros.
- **Formato real de la prueba**: en Cieza las bases citan 20 preguntas con 4 alternativas y la puntuación indicada, pero no la duración ni si habrá plano; el tiempo es configurable y existe un modo «solo texto». Se supone que la nota mínima es 0 (no negativa): contrástalo con las bases generales (BORM n.º 260/2023). En Jumilla el formato procede de la convocatoria de 2022 (rellenar un mapa mudo, 0–10, mínimo 5); las bases no fijan el número de calles ni cómo se corrigen los nombres: ajusta `data/municipios.json` cuando se publiquen las vigentes.
- **Cuotas de Firebase Spark**: 50.000 lecturas y 20.000 escrituras diarias en Firestore; el uso típico de una persona es de unas pocas decenas al día. Las exportaciones gestionadas de Firestore requieren el plan Blaze, por eso la copia de seguridad se hace desde la propia aplicación (Ajustes → Copia de seguridad).
- **Mapa base**: las teselas de tile.openstreetmap.org solo se muestran con conexión y nunca se guardan en caché (política de uso de OSM). Sin conexión se ven las geometrías locales sobre fondo neutro.

## Licencias

Código: MIT. Datos geográficos: © colaboradores de OpenStreetMap, disponibles bajo la licencia ODbL 1.0 (la atribución aparece en el mapa). Leaflet: BSD-2. Firebase JS SDK: Apache 2.0.

Herramienta de estudio personal, no oficial ni vinculada al Ayuntamiento de Cieza.
