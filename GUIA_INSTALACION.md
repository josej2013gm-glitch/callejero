# Guía de instalación y puesta en marcha — Estudio de Callejero

Esta guía está pensada para alguien con conocimientos informáticos básicos. Sigue los pasos en orden. Todo es **gratuito** y no hace falta introducir ninguna tarjeta bancaria.

**Convenciones**

- «Terminal» es la ventana de comandos: en Windows, **PowerShell** (botón Inicio → escribe «PowerShell»); en macOS, la app **Terminal**; en Linux, la terminal de tu escritorio.
- Los bloques de código son comandos: cópialos y pulsa Intro. Si hay versión para Windows y para macOS/Linux, usa la tuya.
- Salvo que se diga otra cosa, **todos los comandos se ejecutan dentro de la carpeta del proyecto** (`callejero-cieza`). Para entrar en ella: `cd ruta/a/callejero-cieza`.

**Índice**

1. [Requisitos previos](#1-requisitos-previos)
2. [Instalación de Node.js](#2-instalación-de-nodejs)
3. [Instalación de Git](#3-instalación-de-git)
4. [Creación de un repositorio en GitHub](#4-creación-de-un-repositorio-en-github)
5. [Subida y clonación del proyecto](#5-subida-y-clonación-del-proyecto)
6. [Instalación de dependencias](#6-instalación-de-dependencias)
7. [Configuración de Firebase: visión general](#7-configuración-de-firebase-visión-general)
8. [Creación del proyecto Firebase](#8-creación-del-proyecto-firebase)
9. [Selección del plan Spark](#9-selección-del-plan-spark)
10. [Registro de la aplicación web](#10-registro-de-la-aplicación-web)
11. [Configuración de Firebase Authentication](#11-configuración-de-firebase-authentication)
12. [Creación de Cloud Firestore](#12-creación-de-cloud-firestore)
13. [Configuración de las reglas de seguridad](#13-configuración-de-las-reglas-de-seguridad)
14. [Configuración de Firebase Hosting](#14-configuración-de-firebase-hosting)
15. [Archivo de variables de entorno](#15-archivo-de-variables-de-entorno)
16. [Importación de los datos geográficos](#16-importación-de-los-datos-geográficos)
17. [Ejecución local](#17-ejecución-local)
18. [Compilación de producción](#18-compilación-de-producción)
19. [Publicación en Firebase Hosting](#19-publicación-en-firebase-hosting)
20. [Comprobación del funcionamiento](#20-comprobación-del-funcionamiento)
21. [Actualización desde GitHub](#21-actualización-desde-github)
22. [Copias de seguridad y recuperación de datos](#22-copias-de-seguridad-y-recuperación-de-datos)
23. [Verificación de los datos del callejero](#23-verificación-de-los-datos-del-callejero)
24. [Solución de problemas](#24-solución-de-problemas)

---

## 1. Requisitos previos

- Un ordenador con Windows 10/11, macOS o Linux y conexión a Internet (solo para instalar, importar datos y publicar).
- Una **cuenta de Google** (para Firebase y, si quieres, para entrar en la aplicación).
- Una **cuenta de GitHub** gratuita: <https://github.com/signup>.
- Unos 30–45 minutos la primera vez.

## 2. Instalación de Node.js

Node.js ejecuta las herramientas del proyecto (Vite, scripts de datos, Firebase CLI).

1. Entra en <https://nodejs.org> y descarga la versión **LTS** (la recomendada; 20 o superior).
2. Ejecuta el instalador con las opciones por defecto.
3. **Cierra y vuelve a abrir** la terminal y comprueba:

```bash
node -v
npm -v
```

Deben mostrar números de versión (por ejemplo `v22.x.x` y `10.x.x`).

> **Windows**: si al ejecutar `npm` aparece «la ejecución de scripts está deshabilitada en este sistema», ejecuta una vez en PowerShell:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y responde `S`.

## 3. Instalación de Git

1. Descarga Git desde <https://git-scm.com/downloads> e instálalo con las opciones por defecto (en macOS puedes ejecutar `xcode-select --install`).
2. Comprueba y configura tu nombre y correo (aparecerán en el historial de cambios):

```bash
git --version
git config --global user.name "Tu Nombre"
git config --global user.email "tu-correo@ejemplo.com"
```

## 4. Creación de un repositorio en GitHub

1. Entra en GitHub y pulsa **New repository** (botón verde o <https://github.com/new>).
2. **Repository name**: `callejero-cieza`.
3. Marca **Private** (recomendado: es tu herramienta de estudio).
4. **No** marques «Add a README», «.gitignore» ni licencia (el proyecto ya los trae).
5. Pulsa **Create repository** y deja la página abierta: verás la dirección del repositorio, del tipo `https://github.com/TU-USUARIO/callejero-cieza.git`.

## 5. Subida y clonación del proyecto

### 5.a Primera vez: subir el proyecto que has recibido

Descomprime el archivo `callejero-cieza.zip` donde quieras (por ejemplo en Documentos) y, en la terminal:

```bash
cd ruta/a/callejero-cieza
git init
git add .
git commit -m "Versión inicial de Callejero Cieza"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/callejero-cieza.git
git push -u origin main
```

La primera vez que hagas `git push`, Git abrirá el navegador para que inicies sesión en GitHub. Recarga la página del repositorio: verás los archivos.

### 5.b En otro ordenador: clonar el proyecto

```bash
git clone https://github.com/TU-USUARIO/callejero-cieza.git
cd callejero-cieza
```

Recuerda que el archivo `.env.local` (paso 15) **no** se sube a GitHub: tendrás que crearlo también en el otro ordenador.

## 6. Instalación de dependencias

Dentro de la carpeta del proyecto:

```bash
npm install
```

Descarga Vite, Leaflet y Firebase en la carpeta `node_modules` (no se sube a GitHub). Tarda uno o dos minutos. Las advertencias amarillas («warn») no son errores.

Instala también la herramienta de línea de comandos de Firebase (una sola vez por ordenador):

```bash
npm install -g firebase-tools
firebase --version
```

> macOS/Linux: si aparece un error de permisos (`EACCES`), usa `sudo npm install -g firebase-tools` o, sin instalar nada global, antepón `npx` a cada orden: `npx firebase-tools login`, `npx firebase-tools deploy`, etc.

## 7. Configuración de Firebase: visión general

Firebase aporta tres servicios gratuitos (plan Spark):

| Servicio | Para qué | ¿Obligatorio? |
|---|---|---|
| **Hosting** | Publicar la aplicación en una dirección `https://TU-PROYECTO.web.app` | Sí, para usarla desde el móvil |
| **Authentication** | Entrar con Google o con correo y contraseña | Solo si quieres sincronizar |
| **Cloud Firestore** | Guardar tu progreso e historial en la nube y sincronizar dispositivos | Solo si quieres sincronizar |

Sin Authentication ni Firestore, la aplicación funciona igual en **modo local** (los datos quedan solo en ese navegador).

No se usa Cloud Functions, Cloud Storage, App Hosting ni ningún servicio que requiera el plan de pago Blaze.

## 8. Creación del proyecto Firebase

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google.
2. Pulsa **Crear un proyecto** (o «Añadir proyecto»).
3. Nombre: `callejero-cieza` (Firebase añadirá un sufijo si ya existe; anota el **ID del proyecto** que muestra, p. ej. `callejero-cieza-1a2b3`).
4. **Google Analytics**: desactívalo (no se usa).
5. Pulsa **Crear proyecto** y después **Continuar**.

## 9. Selección del plan Spark

Los proyectos nuevos se crean en el plan gratuito **Spark**. Compruébalo:

1. En la parte inferior del menú izquierdo verás el plan actual: debe decir **Spark** («Sin coste»).
2. **No pulses «Actualizar» ni vincules ninguna cuenta de facturación.** Si en algún momento la consola te propone pasar a Blaze para una función, cancela: esta aplicación no la necesita.

Con Spark, si se alcanza un límite diario, el servicio se detiene hasta el día siguiente pero **nunca se cobra nada**. La aplicación lo detecta, muestra un aviso y guarda los resultados en el dispositivo hasta que se pueda sincronizar.

## 10. Registro de la aplicación web

1. En la página principal del proyecto, pulsa el icono **Web** (`</>`) («Añadir app»).
2. Apodo: `callejero-web`. Puedes marcar «Configurar también Firebase Hosting» (opcional; lo haremos por terminal).
3. Pulsa **Registrar app**. Aparecerá un bloque de código con `const firebaseConfig = { ... }`. **Copia esos valores**; los usarás en el paso 15:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "callejero-cieza-1a2b3.firebaseapp.com",
  projectId: "callejero-cieza-1a2b3",
  storageBucket: "callejero-cieza-1a2b3.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef..."
};
```

Si lo cierras, puedes volver a verlo en ⚙️ **Configuración del proyecto** → pestaña **General** → sección **Tus apps** → **Configuración del SDK** → opción **Config**.

> Estos valores **no son contraseñas**: identifican tu proyecto y viajan dentro de la aplicación publicada. La seguridad de los datos la garantizan las reglas de Firestore (paso 13) y los dominios autorizados (paso 11). Aun así, el proyecto los mantiene fuera de GitHub en `.env.local`.

## 11. Configuración de Firebase Authentication

1. Menú izquierdo → **Compilación** (Build) → **Authentication** → **Comenzar**.
2. Pestaña **Método de acceso** (Sign-in method):
   - **Google** → Habilitar → elige tu correo como «correo de asistencia» → **Guardar**.
3. Pestaña **Configuración** → **Dominios autorizados**: deben aparecer `localhost`, `TU-PROYECTO.firebaseapp.com` y `TU-PROYECTO.web.app`. Si publicas en otro dominio, añádelo aquí.

La app solo admite cuentas de Google. Quién puede entrar se explica en el anexo B.

## 12. Creación de Cloud Firestore

1. Menú izquierdo → **Compilación** → **Firestore Database** → **Crear base de datos**.
2. Si te pregunta la edición, elige la **estándar** (Standard).
3. **ID de la base de datos**: deja `(default)`.
4. **Ubicación**: una europea, por ejemplo `eur3 (europe)` o `europe-southwest1 (Madrid)`. **No se puede cambiar después.**
5. Reglas iniciales: elige **Iniciar en modo de producción** (todo denegado). En el paso siguiente publicarás las reglas del proyecto.
6. Pulsa **Crear**.

## 13. Configuración de las reglas de seguridad

El archivo `firestore.rules` del proyecto permite que **cada usuario lea y escriba solo sus propios datos** (`users/{su uid}`) y deniega todo lo demás. Se publica desde la terminal:

```bash
firebase login                 # abre el navegador para autorizar con tu cuenta de Google
firebase use --add             # elige tu proyecto de la lista y escribe el alias: default
npm run deploy                 # publica la app y las reglas con tu correo (requiere el paso 15 y el 16)
```

Debe terminar con `✔ Deploy complete!`. Puedes comprobarlo en la consola: **Firestore Database** → pestaña **Reglas**.

> Alternativa sin terminal: copia el contenido de `firestore.rules` en esa pestaña **Reglas**, sustituye `__OWNER_EMAIL__` por tu correo de Google y pulsa **Publicar**.

**Comprobar las reglas** (opcional, recomendado): en la pestaña **Reglas** pulsa **Área de pruebas de reglas** (Rules Playground):
- Tipo `get`, ruta `/users/ABC`, con «Autenticado» y UID de proveedor `ABC` → debe salir **permitido**.
- Misma ruta con UID `XYZ` → **denegado**.
- Sin autenticar → **denegado**.

## 14. Configuración de Firebase Hosting

El proyecto ya incluye `firebase.json` configurado para publicar la carpeta `dist` (la aplicación compilada) con cabeceras de caché adecuadas para la PWA. Solo tienes que haber ejecutado `firebase use --add` (paso 13). Para comprobar el proyecto activo:

```bash
firebase projects:list
firebase use
```

No ejecutes `firebase init`: sobrescribiría la configuración incluida. (Si ya lo hiciste y te preguntó si sobrescribir `firebase.json`, recupera el original con `git checkout firebase.json firestore.rules`.)

## 15. Archivo de variables de entorno

1. Copia la plantilla:

   ```powershell
   # Windows (PowerShell)
   Copy-Item .env.example .env.local
   ```
   ```bash
   # macOS / Linux
   cp .env.example .env.local
   ```

2. Abre `.env.local` con un editor de texto (Bloc de notas, VS Code…) y pega los valores del paso 10, **sin comillas**:

   | En `firebaseConfig` | En `.env.local` |
   |---|---|
   | `apiKey` | `VITE_FIREBASE_API_KEY=` |
   | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN=` |
   | `projectId` | `VITE_FIREBASE_PROJECT_ID=` |
   | `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET=` |
   | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID=` |
   | `appId` | `VITE_FIREBASE_APP_ID=` |
   | (tu correo de Google) | `VITE_OWNER_EMAIL=` |

   Ejemplo:
   ```
   VITE_FIREBASE_API_KEY=AIzaSyA...
   VITE_FIREBASE_AUTH_DOMAIN=callejero-cieza-1a2b3.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=callejero-cieza-1a2b3
   ...
   ```

3. Guarda el archivo. `.env.local` está en `.gitignore`: **nunca se sube a GitHub**.

Si dejas los valores vacíos, la aplicación arranca en modo local, sin pantalla de acceso.

## 16. Importación de los datos geográficos

La aplicación necesita el archivo `public/data/callejero.geojson`, que se genera a partir de OpenStreetMap con un único comando (requiere Internet):

```bash
npm run data:import
```

Qué hace:
1. Envía **una** consulta a la API pública Overpass (definida en `data/overpass-query.overpassql`) para el término municipal de Cieza: vías con nombre o referencia, edificios y servicios públicos, lugares (barrios, pedanías) y polígonos industriales.
2. Guarda el volcado original en `data-raw/osm-cieza.json` (y una copia fechada).
3. Construye `public/data/callejero.geojson`: une los tramos de cada calle, calcula cruces, ángulos, calles próximas y paralelas, asocia los edificios a su vía y deriva las zonas.
4. Escribe `data/informe-importacion.md` con los recuentos y los **avisos a revisar** (calles sin cruces, nombres abreviados, edificios con dirección que no coincide, nombres repetidos…).

Después valida el resultado:

```bash
npm run data:validate
```

Genera más de mil preguntas y comprueba cada una de forma independiente. Debe terminar con «0 con errores». Al final indica cuántas preguntas se pueden generar por modalidad: si alguna sale a 0, OSM no tiene datos suficientes para ella (por ejemplo, si no hay vías con referencia de carretera).

Guarda el callejero en el repositorio:

```bash
git add public/data/callejero.geojson data/informe-importacion.md
git commit -m "Callejero de Cieza importado de OpenStreetMap"
git push
```

**Si la descarga falla** (servidor saturado, error 429 o 504):
- Espera unos minutos y repite, o usa otro servidor: `npm run data:import -- --endpoint https://overpass.kumi.systems/api/interpreter`
- O hazlo a mano: abre <https://overpass-turbo.eu>, pega el contenido de `data/overpass-query.overpassql`, pulsa **Ejecutar**, después **Exportar** → **Datos sin procesar (raw data)** y guarda el archivo como `data-raw/osm-cieza.json`. Luego ejecuta `npm run data:build`.

**No programes importaciones automáticas.** El callejero cambia poco: reimporta cuando sepas que hay cambios (y siempre antes del examen). Las verificaciones que hayas hecho se conservan (paso 23).

## 17. Ejecución local

```bash
npm run dev
```

Se abre <http://localhost:5173>. Entra con Google (o «Continuar sin cuenta») y recorre la aplicación. Los cambios en el código se ven al instante. Para detener el servidor: `Ctrl + C` en la terminal.

> Si cambias `.env.local`, detén el servidor y vuelve a ejecutar `npm run dev`.

## 18. Compilación de producción

```bash
npm test
npm run build
npm run preview
```

- `npm test` ejecuta las pruebas automáticas del motor (deben salir todas `pass`).
- `npm run build` genera la carpeta `dist/` (aplicación optimizada + service worker para el modo sin conexión).
- `npm run preview` la sirve en <http://localhost:4173> para comprobarla antes de publicar. Aquí ya funciona la instalación como app y el modo sin conexión.

## 19. Publicación en Firebase Hosting

```bash
npm run deploy
```

Ejecuta, por este orden: pruebas, validación del callejero, compilación y publicación de la aplicación y de las reglas (con tu correo insertado). Al terminar muestra:

```
✔ Deploy complete!
Hosting URL: https://TU-PROYECTO.web.app
```

Esa es la dirección de tu aplicación. Ábrela en el móvil y el ordenador.

## 20. Comprobación del funcionamiento

Recorre esta lista en la dirección publicada:

1. **Acceso**: entra con Google. Arriba a la derecha el icono ☁️ indica «Sincronizado».
2. **Mapa**: busca una calle conocida, comprueba sus cruces y activa el **modo mapa mudo**.
3. **Entrenamiento**: haz 5 preguntas de «Cruces de calles».
4. **Simulacro oficial**: haz uno completo. Comprueba la nota: aciertos × 0,10 − errores × 0,03.
5. **Sincronización**: en Firebase Console → Firestore Database → **Datos** debe aparecer `users/<tu uid>/sessions/...`. Abre la aplicación en otro dispositivo con la misma cuenta: verás el mismo historial.
6. **Seguridad**: en otro navegador, entra con otra cuenta: no debe ver tus datos.
7. **Instalación**: en Chrome/Edge de escritorio, icono de instalar en la barra de direcciones; en Android, menú ⋮ → «Instalar aplicación»; en iPhone (Safari), Compartir → «Añadir a pantalla de inicio».
8. **Sin conexión**: con la app instalada y abierta una vez, activa el modo avión, ábrela y haz un entrenamiento. Al recuperar la conexión, el icono pasa de 📴 a ☁️ y el resultado se sincroniza.

## 21. Actualización desde GitHub

Cuando haya cambios en el código (tuyos o descargados):

```bash
git pull                 # trae los cambios del repositorio
npm install              # por si cambiaron las dependencias
npm run deploy           # prueba, compila y publica
```

Si los cambios los has hecho tú en este ordenador, primero súbelos:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

**Tus datos no se pierden al actualizar**: el progreso y el historial están en Firestore y en cada dispositivo, no en el código. Los dispositivos con la app instalada mostrarán el aviso «Hay una versión nueva» con el botón **Actualizar**.

Para actualizar el callejero: `npm run data:import`, `npm run data:validate`, `git add public/data data/informe-importacion.md`, `git commit`, `git push` y `npm run deploy`.

## 22. Copias de seguridad y recuperación de datos

**Copia personal (recomendada)**: en la aplicación, **Ajustes → Copia de seguridad → Descargar copia**. Genera un JSON con ajustes, progreso, historial y correcciones. Hazla de vez en cuando y guárdala en tu nube personal.

**Recuperar**: **Ajustes → Importar copia**. Se fusiona con lo existente (no borra nada) y se sincroniza con Firestore.

**Código y callejero**: están en GitHub. Para recuperar el proyecto en un ordenador nuevo: pasos 2, 3, 5.b, 6 y 15.

**Correcciones del callejero**: exporta `verificaciones.json` desde Administración (paso 23) y súbelo al repositorio; así quedan a salvo con el código.

> Las exportaciones automáticas de Firestore de Google Cloud requieren el plan Blaze y por eso no se usan. La copia desde la aplicación cubre todos tus datos.

## 23. Verificación de los datos del callejero

OpenStreetMap es una fuente abierta y, en general, fiable para calles, pero **no oficial**. Para estudiar con seguridad, contrasta los datos con fuentes oficiales como el callejero del Ayuntamiento de Cieza, el callejero del censo electoral (INE) o la Sede Electrónica del Catastro.

1. Abre **Administración → Avisos** y revisa los avisos de importación.
2. En **Administración → Calles**, busca cada vía, compárala con la fuente oficial y marca su estado:
   - **Verificado**: el nombre y el trazado coinciden. Indica la fuente.
   - **Corregido**: el nombre de OSM es incorrecto; escribe el oficial.
   - **Dudoso**: no está claro (se excluye de las preguntas).
   - **Excluido**: no debe usarse en las preguntas.
   En la misma ficha puedes marcar cada **cruce** como confirmado o erróneo.
3. Revisa también **Administración → Edificios** (nombre y vía en la que están).
4. Las correcciones se guardan en tu cuenta y se aplican al instante. Para incorporarlas al proyecto: **Administración → Importación y exportación → Descargar verificaciones.json**, sustituye `data/verificaciones.json`, y ejecuta:

   ```bash
   npm run data:build
   npm run data:validate
   git add data/verificaciones.json public/data/callejero.geojson
   git commit -m "Verificaciones del callejero"
   git push
   npm run deploy
   ```

5. Cuando tengas una parte importante verificada, activa **Ajustes → Usar solo datos verificados en las preguntas**.

Si encuentras errores en OpenStreetMap, lo ideal es corregirlos también en <https://www.openstreetmap.org> (es libre) y reimportar.

Si al reimportar una calle cambia de nombre en OSM respecto al que verificaste, el informe lo marcará como «verificación desfasada» y la calle pasará a «Dudoso» hasta que la revises.

## 24. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `node` o `npm` «no se reconoce como comando» | Node.js no está instalado o la terminal se abrió antes. Reinstala (paso 2) y abre una terminal nueva. |
| `npm.ps1 no se puede cargar… ejecución de scripts deshabilitada` (Windows) | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` en PowerShell. |
| `EACCES` al instalar `firebase-tools` (macOS/Linux) | Usa `sudo npm install -g firebase-tools` o `npx firebase-tools …`. |
| `npm install` falla con errores de red o de certificado | Comprueba la conexión, proxy o antivirus; repite `npm install`. Si persiste, borra `node_modules` y `package-lock.json` y repite. |
| `Port 5173 is already in use` | Ya hay un `npm run dev` abierto; ciérralo o usa `npm run dev -- --port 5174`. |
| La app arranca sin pantalla de acceso | `.env.local` no existe, tiene otro nombre (p. ej. `.env.local.txt` en Windows) o faltan valores. Revisa el paso 15 y reinicia `npm run dev`. |
| «Este dominio no está autorizado» (`auth/unauthorized-domain`) | Añade el dominio en Authentication → Configuración → Dominios autorizados. |
| «Este método de acceso no está activado» | Activa Google o Correo/contraseña en Authentication (paso 11). |
| La ventana de Google se cierra o se bloquea | Permite ventanas emergentes para el sitio; la app intenta además el acceso por redirección. |
| «Firestore ha denegado el acceso» (`permission-denied`) | Las reglas no están publicadas: `firebase deploy --only firestore` (paso 13). |
| Aviso «Se ha alcanzado la cuota gratuita diaria» | Límite diario de Spark alcanzado. No hay que hacer nada: los datos se guardan en el dispositivo y se sincronizan al día siguiente. |
| «Falta el callejero» al abrir la app | No existe `public/data/callejero.geojson`: ejecuta `npm run data:import` y vuelve a compilar y publicar. |
| `npm run data:import` → `HTTP 429` o `504` | Servidor Overpass saturado: espera, usa `--endpoint` con otro servidor o la importación manual (paso 16). |
| `npm run data:import` → «La respuesta no contiene vías» | El nombre o nivel administrativo del municipio en OSM ha cambiado: revisa la primera línea `rel[...]` de `data/overpass-query.overpassql` en overpass-turbo. |
| `npm run data:import` falla tras un proxy corporativo | Node no usa el proxy del sistema: haz la importación manual con overpass-turbo (paso 16). |
| `firebase deploy` → «No currently active project» | Ejecuta `firebase use --add` (paso 13). |
| `firebase deploy` pide actualizar a Blaze | Estás desplegando algo que no es de este proyecto (p. ej. functions). Usa `npm run deploy`, que solo publica hosting y reglas. |
| La app publicada no muestra los cambios | Pulsa **Actualizar** en el aviso de nueva versión o cierra todas las pestañas de la app y vuelve a abrirla. |
| `npm run data:validate` muestra errores | Indica un problema en el generador o en los datos: abre una incidencia con la salida del comando. No publiques hasta que salga «0 con errores». |

---

## Anexo A · Puesta en marcha solo desde el navegador (GitHub Actions)

Si no quieres usar la terminal, GitHub compila y publica la aplicación por ti con `.github/workflows/publicar.yml`:

1. Firebase: crea el proyecto (Spark), registra la app web, activa **solo Google** en Authentication y crea Firestore (pasos 8–12).
2. Firebase → Configuración del proyecto → **Cuentas de servicio → Generar nueva clave privada**. Copia el contenido del JSON en GitHub → Settings → Secrets and variables → Actions → **Secrets** → `FIREBASE_SERVICE_ACCOUNT`. Borra el archivo descargado.
3. En la pestaña **Variables** crea `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (solo el valor, sin comillas) y `VITE_OWNER_EMAIL` (tu correo de Google).
4. En Google Cloud → IAM, da a la cuenta `firebase-adminsdk-…` los roles **Administrador de Firebase**, **Consumidor de Service Usage** y **Visor de claves de API**.
5. Actions → **Publicar** → **Run workflow**. La app queda en `https://TU-PROYECTO.web.app`.

Cada cambio que guardes en GitHub se publica solo y descarga los callejeros que falten. Para volver a descargar uno, ejecuta el flujo eligiendo en **importar** su identificador (`cieza`, `jumilla` o `todos`). Si OpenStreetMap no responde, el flujo publica igualmente los municipios que ya tienen datos.

## Anexo B · Control de acceso

- Solo se puede entrar con **cuentas de Google** (el acceso con correo y contraseña no existe en la app; desactívalo también en Firebase Authentication).
- Entra siempre el **propietario** (`VITE_OWNER_EMAIL`). Las demás cuentas solo si el propietario las añade en **Ajustes → Cuentas autorizadas**. Una cuenta no autorizada es expulsada al entrar con el aviso «no está autorizada».
- La protección real está en `firestore.rules`: al publicar, `__OWNER_EMAIL__` se sustituye por tu correo, y cualquier cuenta que no sea la tuya ni esté en la lista recibe «permiso denegado» en todos los datos. Cada cuenta autorizada ve solo su propio progreso.
- No publiques `firestore.rules` a mano con `__OWNER_EMAIL__` sin sustituir: nadie podría entrar. Usa el flujo de GitHub o `npm run deploy` (que lo sustituye automáticamente).
- Los archivos estáticos de la app (incluido el callejero de OSM, que es público) se pueden descargar desde la dirección web; el plan gratuito de Hosting no permite protegerlos con contraseña.

## Anexo C · Varios municipios

- La app estudia los municipios de `data/municipios.json` (ahora **Cieza** y **Jumilla**). Cada uno tiene su callejero, progreso, estadísticas, simulacros, correcciones y simulacro en curso. Los ajustes son comunes.
- Se cambia de municipio con las **pestañas de la barra superior** o con el **selector del menú lateral**.
- **Formato del examen** (`exam` en `data/municipios.json`):
  - `"format": "test"` → `questions`, `correct`, `wrong`, `max`, `pass` (Cieza: 20, 0,10, 0,03, 2, sin mínimo).
  - `"format": "mapaMudo"` → `items` (vías a rellenar), `max` (nota máxima) y `pass` (mínimo) (Jumilla: 20, 10, 5).
  Edita estos valores en GitHub cuando se publiquen las bases vigentes; la app se actualiza sola.
- **Datos de cada municipio**:
  - Consulta Overpass: `data/overpass/<id>.overpassql`.
  - Volcado de OpenStreetMap: `data-raw/osm-<id>.json`.
  - Verificaciones: `data/verificaciones-<id>.json` (Cieza también admite el antiguo `data/verificaciones.json`).
  - Informe de importación: `data/informe-importacion-<id>.md`.
- **Importación manual** (si OpenStreetMap da 502/504 desde GitHub): pega la consulta del municipio en <https://overpass-turbo.eu>, ejecuta, pulsa **Cancelar** si avisa de que hay muchos datos, **Exportar → raw OSM data** y sube el archivo a la carpeta `data-raw` con el nombre `osm-<id>.json`.
- **Añadir otro municipio**: copia una entrada en `data/municipios.json` con un `id` nuevo (minúsculas, sin espacios), crea `data/overpass/<id>.overpassql` copiando otra consulta y cambiando el nombre y el rectángulo de búsqueda, añade el `id` a la lista `options` de `.github/workflows/publicar.yml` y ejecuta el flujo con importar = `<id>`.
- **Compatibilidad**: los datos que ya tenías (progreso, historial y correcciones) pasan a ser de Cieza automáticamente; no se pierde nada.
