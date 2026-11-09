# Informe de entrega — Callejero Cieza v1.0.0

Fecha: 9 de noviembre de 2026.

## 1. Resultados de las pruebas

### 1.1 Pruebas automáticas del motor (`npm test`) — 15/15 correctas

| Prueba | Qué comprueba |
|---|---|
| Geometría | Distancias (haversine), rumbos, ejes y rectitud, distancia entre líneas, cruce de segmentos, punto en polígono, puntos cardinales con zona ambigua. |
| Construcción del callejero | Unión de tramos con el mismo nombre; separación de calles homónimas lejanas con etiquetas distintas; longitudes; marca de caminos rurales. |
| Cruces y relaciones | Cruces por nodos compartidos, ángulo (90° / 40°), perpendicularidad, paralelismo, distancias. |
| Edificios | Vía por `addr:street`, por proximidad inequívoca, sin vía cuando es ambiguo; descarte de elementos sin nombre; avisos de direcciones inexistentes. |
| Zonas | Polígonos, barrios, áreas temáticas; todas con método documentado. |
| Verificaciones | Corrección de nombres, fuente y fecha, cruce marcado como erróneo excluido, correcciones locales. |
| Generador | 10 modalidades × 3 dificultades × 60 semillas: cada pregunta se verifica de forma **independiente** (la correcta cumple la condición y ningún distractor la cumple, con margen de seguridad). |
| Simulacro | 20 preguntas sin duplicados; modo solo texto sin mapas. |
| Sin datos | Con datos insuficientes el generador devuelve `null` en todas las modalidades (no inventa). |
| Puntuación | 20/20 → 2,00; blancos → 0; 15 A + 3 E + 2 B → 1,41; nota mínima 0; simulacros de 10 preguntas y escala a 2. |
| Repaso espaciado | Cajas e intervalos, fallo → caja 0, respuesta lenta no sube, prioridad, fusión entre dispositivos, intervalos configurables. |
| Firestore | El documento de sesión no contiene arrays anidados ni `undefined`, está por debajo de 1 MiB y se recupera idéntico. |

### 1.2 Validación del callejero (`npm run data:validate`)

Con el municipio ficticio de pruebas: **1.197 preguntas generadas, 0 con errores**; simulacro oficial completo (20/20).
Con los datos reales de Cieza este comando debe ejecutarse tras `npm run data:import` (`npm run deploy` lo hace siempre antes de publicar).

### 1.3 Prueba de extremo a extremo en Chrome (`npm run test:e2e`) — 21/21 correctas, sin errores de JavaScript

Dashboard · búsqueda y ficha de calle en el mapa · modo mudo · entrenamiento de 5 preguntas con corrección y resumen · simulacro oficial de 20 preguntas · pulsar de nuevo deja en blanco · resumen antes de entregar · **puntuación exacta (12 aciertos, 3 errores, 5 blancos → 1,11)** · revisión con explicaciones · persistencia en IndexedDB tras recargar · simulacro sin entregar recuperable con sus respuestas · mapa mudo con corrección · localizar tocando el mapa · repaso (prioridades y repetir falladas) · zonas y ficha de estudio · guardar una verificación en Administración · autocomprobación del generador desde la interfaz (299 preguntas, 0 errores) · navegación móvil.

### 1.4 Lo que no se ha podido probar en el entorno de desarrollo

El entorno donde se construyó el proyecto no tenía acceso a Internet, por lo que:

- **No se han descargado los datos reales de Cieza.** El repositorio no incluye `public/data/callejero.geojson`: se genera en tu ordenador con `npm run data:import` (paso 16 de la guía). Las pruebas usan un municipio **ficticio** («Villaprueba», en coordenadas que no son de España) que nunca se publica.
- **No se han instalado las dependencias** (Vite, Leaflet, Firebase). La prueba en navegador usó los módulos fuente con un sustituto mínimo de Leaflet; el dibujo real con Leaflet, la compilación `npm run build`, el service worker compilado, el acceso con Google y la sincronización con Firestore no se han ejecutado. El código sigue las API documentadas de esas librerías y se ha protegido frente a sus errores habituales (vista no fijada, contenedores ocultos, arrays anidados en Firestore…).
- **Las reglas de Firestore** no se han ejecutado en el emulador; la guía incluye su comprobación con el Área de pruebas de reglas.

Por eso, tras la instalación, haz la **comprobación del paso 20** de la guía.

## 2. Funcionalidades implementadas

| Requisito | Estado |
|---|---|
| A. Dashboard (progreso, calles estudiadas, % dominio, últimos resultados, mejor nota, repasos pendientes, accesos rápidos, recomendación por errores) | Implementado |
| B. Mapa interactivo (zoom, búsqueda de calles y edificios, resaltado, selección, próximas, cruces, edificios/POI, capas, filtro por zona y categoría, ficha de vía, modo mudo, funcionamiento sin conexión con datos vectoriales, mapa base opcional sin descarga masiva) | Implementado |
| C. Aprendizaje por zonas (centro, barrios, residencial, periferia, polígonos, accesos, entorno de edificios públicos; nº de vías, estudiadas, dominio, ejercicios y progreso; método de cada zona) | Implementado (las zonas dependen de lo que exista en OSM) |
| D. Entrenamiento: 10 modalidades × 3 dificultades + progresiva | Implementado |
| E. Generador sin IA (4 alternativas, explicación, categoría, dificultad, referencias, distractores geográficos, sin duplicados ni ambigüedades, no genera sin datos) | Implementado y verificado |
| F. Simulacro oficial (20 preguntas, cronómetro configurable, navegación, blancos, indicador, resumen, corrección, penalización exacta, nota /2, revisión, explicaciones) + entrenamiento 5/10/20/30 | Implementado |
| G. Mapa mudo (identificar, seleccionar, intersecciones, distribución, referencias; dificultad progresiva por niveles) | Implementado |
| H. Repaso inteligente (repetición espaciada configurable; prioriza calles falladas, cruces, zonas, relaciones y tiempos altos; repetir falladas; nuevas preguntas sobre los mismos conceptos) | Implementado |
| I. Estadísticas (aciertos, media, mejor, evolución, por categoría, por zona, dominadas, pendientes, errores frecuentes, tiempo medio, historial) | Implementado |
| Importación OSM, GeoJSON local, fuente/fecha/estado/observaciones por elemento, panel de administración | Implementado |
| Firebase Auth (Google y correo), Firestore con reglas por usuario, Hosting, IndexedDB, cola de sincronización, gestión de cuotas | Implementado (pendiente de comprobar en tu proyecto) |
| PWA: manifest, iconos, service worker, caché de recursos y datos, página sin conexión, aviso de nueva versión | Implementado |
| README, GUIA_INSTALACION.md, .gitignore, configuración Vite y Firebase | Incluidos |

## 3. Limitaciones conocidas

Ver la sección «Limitaciones conocidas» del [README](../README.md). En resumen: datos de OSM no oficiales hasta su verificación; zonas aproximadas; recorridos sin sentidos de circulación; duración de la prueba real desconocida (configurable); supuesto de nota mínima 0; cuotas de Spark; mapa base solo con conexión.

## 4. Publicar y actualizar

```bash
# Primera vez (tras configurar Firebase y .env.local)
npm install
npm run data:import && npm run data:validate
npm run deploy

# Cada actualización
git pull && npm install && npm run deploy
```

Detalle completo en [GUIA_INSTALACION.md](../GUIA_INSTALACION.md), pasos 16–21.
