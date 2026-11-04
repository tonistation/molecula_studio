# Entorno de desarrollo M1 y timeline V01

Este documento describe lo que existe hoy en M1: schema, `ProjectStore`,
frontera HTTP loopback y el estudio React que guarda, reabre e importa borradores
con manifest, revinculación explícita de recursos (F05), copias del borrador
y protección de salida (F06), con roundtrip y recuperación entre procesos reales
(F08), más el muestreo determinista de reloj/escena V01. La evidencia por criterio
está en [G1](../plan/delivery.md#evidencia-local-de-g1--f08-2026-11-04), cerrado
en alcance técnico local tras revisión independiente F08. No
promete render, proveedores ni exportación: esa evidencia pertenece a M2 en
adelante.

## Alcance local de M1

- Un solo paquete npm en la raíz del repositorio; no hay workspaces ni monorepo.
- `src/shared/` es isomorfo (Node y navegador) y contiene el schema ejecutable,
  la canonicalización, los digests y el reloj de frames.
- `src/companion/` contiene el `ProjectStore` (F03) y la frontera HTTP loopback
  (F07): token efímero, `Origin`/`Host` estrictos, sin CORS comodín.
- `studio/` es la app React + Vite (F04); el companion sirve su build desde
  `dist/studio` e inyecta el token en `index.html`. No hay dev server ni proxy.
- Sin renderer, sin proveedores, sin secretos y sin red más allá de
  `npm install` y el navegador local de E2E.

## Versiones instaladas

Verificado el 2026-11-03 con `node --version`, `npm --version` y las versiones
resueltas en `package-lock.json`:

| Herramienta | Versión | Notas |
|---|---|---|
| Node.js | 26.3.0 | LTS Lithium; `engines: ">=26.3.0 <27"` y `.nvmrc` con `26.3.0` |
| npm | 11.16.0 | Instalación con versiones exactas (`--save-exact`) |
| TypeScript | 7.0.2 | `devDependencies`; `tsc --noEmit` para raíz y studio |
| @types/node | 26.6.6 | Tipos de `node:*`, `crypto.subtle`, `TextEncoder` |
| react / react-dom | 19.3.1 | `dependencies`; UI del estudio (F04) |
| @types/react / @types/react-dom | 19.3.0 | `devDependencies`; tipos de la UI |
| vite | 8.3.5 | `devDependencies`; solo build del estudio (`build:studio`) |
| @vitejs/plugin-react | 6.2.1 | `devDependencies`; transformación JSX/Fast Refresh |
| playwright-core | 1.64.1 | `devDependencies`; cliente CDP del E2E (sin navegador propio) |

El schema es un validador propio de objetos cerrados; no hay zod ni otra
librería de validación instalada. Los tests se ejecutan con el runner nativo de
Node y type stripping nativo (Node 26 ejecuta `.ts` directamente). No hay
`ts-node`, `tsx`, Jest ni Vitest.

El E2E no descarga navegadores: usa `playwright-core` contra Lightpanda por CDP
(`lightpanda serve`) para lógica DOM. La prueba de cancelación nativa de recarga
y cierre, y la descarga nativa de JSON, usan el Chrome ya instalado en
`/Applications/Google Chrome.app`: Lightpanda no ofrece esas interfaces
nativas. Si falta Lightpanda, las pruebas
correspondientes se marcan `skipped`, que **no** es un pase. El comando E2E
compila previamente el estudio; si falta Chrome, su prueba falla explícitamente.
No se acredita revisión visual.

F08 agrega tres E2E DOM con **procesos nuevos de Lightpanda y del companion**,
no solo pestañas o instancias HTTP nuevas. Esos recorridos fallan explícitamente
si Lightpanda no está disponible (no se sustituyen por un pase ni por Chrome).

## Comandos

```sh
npm install            # instala y respeta package-lock.json
npm run typecheck      # tsc --noEmit raíz + studio (strict, sin emitir)
npm test               # node --test "tests/**/*.test.ts"
npm run test:unit      # solo tests/unit
npm run test:integration  # solo tests/integration (disco real en tmpdir)
npm run test:e2e       # build del estudio + E2E de navegador real
npm run build:studio   # vite build → dist/studio
npm start              # build del estudio + companion en 127.0.0.1:4787
npm run dev:companion  # companion sobre un build ya existente
```

`npm start` es el único camino soportado para abrir el estudio: el companion
sirve `dist/studio` en loopback e inyecta el token efímero en `index.html`. No
hay dev server de Vite, proxy ni CORS; un `dist/studio` ausente responde 503.

Variables del companion: `MOLECULA_WORKSPACE` (default `./workspace`),
`MOLECULA_PORT` (default `4787`), `MOLECULA_STUDIO_DIR` (default
`dist/studio`) y `MOLECULA_FORCE_UNLOCK=1` para reclamar un lock cuyo dueño ya
murió.

## Estructura

```text
package.json
package-lock.json
tsconfig.json
.nvmrc
src/
  shared/                 # isomorfo, sin dependencias de Node salvo WebCrypto
    canonical.ts          # RFC 8785 JCS (binding-v1)
    digests.ts            # sha256Hex + proyecciones de bindings
    timeline.ts           # totalFrames / frameTimeMs / evaluateFrame (V01)
    schema/
      limits.ts           # SCHEMA_VERSION y LIMITS (única fuente de verdad)
      types.ts            # modelo Project, Issue, ParseOutcome
      errors.ts           # códigos de issue y error interno del parser
      parse.ts            # límites, UTF-8, JSON estricto, versión
      validate.ts         # reglas cerradas de schema 1
      serialize.ts        # 2 espacios, newline final, orden declarado
      empty.ts            # emptyProject validado
      index.ts            # API pública
  companion/
    main.ts               # CLI: workspace, puerto, studio dir, force unlock
    store/                # ProjectStore: commit atómico, lock, recibos, copias
    server/http.ts        # frontera loopback: token, Origin/Host, API, estáticos
studio/                   # app React + Vite (F04)
  index.html
  vite.config.ts          # outDir ../dist/studio, sin dev server
  tsconfig.json           # typecheck con lib DOM
  src/
    main.tsx              # bootstrap de React
    App.tsx               # lista ↔ editor
    api.ts                # cliente tipado del companion
    model.ts              # borrador, escenas contiguas, descarga JSON
    screens/
      ProjectList.tsx     # P1: crear y abrir
      Editor.tsx          # P2/P3: idea, estilo, subtítulos, escenas
      AssetManifest.tsx   # manifest, archivo elegido y sustitución explícita
tests/
  unit/                   # canonical, timeline, schema, hostile, digests
  integration/            # roundtrip real por disco + frontera HTTP
  e2e/studio.e2e.ts       # navegador real (Lightpanda por CDP)
  helpers/fixtures.ts
fixtures/projects/
  empty.json              # copia de docs/plan/examples/empty-project.json
  storyboard.json         # copia de docs/plan/examples/storyboard-project.json
  draft-partial.json      # una escena, visual null, palabras vacías, audio en manifest
  unknown-style.json      # estilo no instalado, abre en modo solo lectura
```

El workspace por defecto es `./workspace`, ignorado por git: ahí viven los
`project.json` que el companion escribe. `.molecula-workspaces/` también está
ignorado y queda reservado para datos de ejecución local alternativos. Los
tests usan `mkdtemp` del sistema y nunca tocan el workspace real.

## API pública de F02

Desde `src/shared/schema/index.ts`:

- `SCHEMA_VERSION`, `LIMITS`
- `parseProjectText(input: string | Uint8Array): ParseOutcome`
- `validateProject(value: unknown): ValidateOutcome`
- `serializeProject(project: Project): string`
- `emptyProject({ projectId, now, title? }): Project`

Desde `src/shared/canonical.ts`, `src/shared/digests.ts` y `src/shared/timeline.ts`:

- `canonicalize(value): string`
- `sha256Hex(data): Promise<string>`
- `bindingDigests(project): Promise<BindingDigests>`
- `totalFrames(durationMs, fps): number`
- `frameTimeMs(frameIndex, fps): number`
- `evaluateFrame(snapshot, frameIndex): FrameSample` (V01; metadatos, no render)

## Límites de entrada aplicados antes de validar

1. Tamaño: 2 MiB UTF-8 exactos (`LIMITS.maxJsonBytes`); un byte más es
   `too-large`.
2. UTF-8 estricto: bytes inválidos son `invalid-json`.
3. JSON estricto propio: rechaza truncados, comas finales, números no finitos,
   claves duplicadas y claves `__proto__` / `constructor` / `prototype` en
   cualquier nivel.
4. Profundidad: 16 contenedores; 17 es `too-deep`.
5. Versión: `schemaVersion > 1` es `unsupported-version`; ausente, `0` o no
   entero es `invalid-schema`.
6. Schema: objetos cerrados, referencias, rangos y límites agregados.

## API del companion (F07)

Todas las rutas `/api/*` exigen `Authorization: Bearer <token efímero>` (o
`x-companion-token`). El token se genera al arrancar, se inyecta en
`index.html` como `<meta name="companion-token">` y nunca se persiste, se pone
en una URL ni se escribe en logs.

| Método y ruta | Efecto |
|---|---|
| `GET /api/health` | Comprueba que el companion responde |
| `GET /api/projects` | Lista resúmenes (handle, revisión, modo, recursos faltantes) |
| `POST /api/projects` | Crea un borrador vacío validado (rev. 0) |
| `GET /api/projects/:id` | Lee y revalida el documento desde disco |
| `PUT /api/projects/:id` | Guarda con `expectedRevision`, `operationId` y `expectedDigest` opcional; la UI envía los tres |
| `POST /api/projects/:id/copy` | `{text?, newProjectId?, operationId?}`; copia del snapshot validado (o disco si falta `text`), con identidad nueva y `approval: null` |
| `POST /api/imports` | `{text, collision?: 'reject' \| 'copy'}`; valida y publica JSON externo sin sobrescribir |
| `PUT /api/projects/:id/assets/:assetId` | Bytes crudos; MIME del manifest; `x-confirm-replace: 1` para contenido distinto; snapshot mediante `x-expected-revision` y `x-expected-digest` (SHA-256); la UI envía ambos |

Controles: bind solo a `127.0.0.1`; `Host` debe ser el origen del companion
(anti DNS rebinding); `Origin` debe estar en la allowlist y toda petición que
cambia estado lo exige (anti CSRF); sin cabeceras CORS; cuerpos JSON de 2 MiB
más 64 KiB de margen (importación: envoltorio acotado a seis veces 2 MiB +
1 KiB para escapes JSON, manteniendo el límite de 2 MiB del documento fuente);
activos crudos hasta 50 MiB exactos; handles opacos, nunca rutas; los errores no devuelven
rutas del workspace ni stack traces.

Códigos de error estables: 401 `unauthorized`, 403 `origin-*`/`host-not-allowed`,
409 `conflict`/`workspace-locked`/`read-only-project`/`project-exists`, 413
`body-too-large`, 415 `unsupported-media-type`, 422 `invalid-project`.

## Comportamiento del estudio (F04)

- Guardar es explícito. «Guardado · rev. N» aparece solo tras la confirmación
  del companion; una petición enviada no es un guardado.
- Si el usuario edita mientras se guarda, el éxito corresponde a la instantánea
  enviada y el borrador sigue sucio con los cambios nuevos.
- Un `409 conflict` ofrece recargar desde disco o crear una copia portable;
  nunca se sobrescribe en silencio.
- «Descargar copia JSON» es 100% cliente: no incluye activos, no confirma
  guardado y no limpia «cambios sin guardar».
- La copia portable sí crea un proyecto nuevo en el workspace, con identidad
  fresca, aprobación limpia y aviso de recursos faltantes.
- Un estilo desconocido abre en solo lectura: se puede leer y descargar, no
   reescribir.

## Copias y salida consciente (F06)

| Acción / resultado | Comportamiento implementado |
|---|---|
| Guardado confirmado | Actualiza revisión/digest; solo limpia dirty si no hubo ediciones posteriores a la instantánea enviada. |
| Recibo `uncertain` | No muestra «Guardado», no limpia dirty ni avanza la última revisión confirmada. **Verificar guardado** relee disco y compara revisión/digest; solo esa coincidencia confirma la instantánea, sin prometer persistencia física adicional. |
| Respuesta perdida o fallo ambiguo | Reintentar reutiliza payload, fecha y `operationId`. Antes de aceptar un recibo confirmado de ese reintento, relee revisión/digest canónicos: un recibo histórico no limpia dirty ni permite navegar si el archivo ya cambió. Los cambios posteriores permanecen pendientes y requieren otro guardado. Un rechazo 4xx permite corregir el borrador; no obliga a repetir bytes inválidos. No hay reintento automático. |
| Copia portable | Envía el borrador actual, incluso ante conflicto o JSON canónico corrupto. Valida el snapshot independientemente y mantiene controles de directorio fuente, entradas symlink, contención de recursos y hashes. Crea otra carpeta, revisión 0, fechas nuevas y aprobación nula; conserva entidades, escenas y bindings. No limpia dirty del origen ni lo sobrescribe. Advierte activos faltantes y persistencia incierta sin llamar completa a la copia. |
| Descarga JSON | Entrega los bytes del borrador al mecanismo de descarga; normaliza título vacío y metadatos de la instantánea, limpia aprobación con aviso y conserva el proyecto activo. No incluye recursos, no confirma escritura del navegador y nunca cambia dirty ni la revisión canónica. Solo lectura entrega los bytes originales sin normalización, incluido el BOM UTF-8 aceptado. |
| Salir, recargar o abrir copia con cambios | Ofrece **Guardar y continuar**, **Descartar cambios y continuar** y **Seguir editando** en un bloque de decisión, no un modal. Guardar solo navega si se confirma el borrador actual; fallo, incertidumbre o edición durante el guardado detienen la navegación. |
| Lectura de reemplazo fallida | Incluso tras elegir descartar, el documento activo permanece intacto hasta tener un reemplazo válido. Recargar actualiza también el modo de solo lectura y los bytes originales del nuevo documento. |
| Cerrar o refrescar pestaña | `beforeunload` solicita la advertencia nativa cuando hay dirty u operación en curso. Depende del navegador y de interacción previa: no promete texto propio ni bloqueo del sistema operativo. |

La UI reserva `newProjectId` y `operationId` antes de copiar. Ante respuesta
perdida, el reintento conserva destino e instantánea y el companion activo
reproduce el recibo sin publicar otra carpeta. La memoria de idempotencia no
sobrevive al reinicio del companion: el destino ya existente se rechaza, nunca
se sobrescribe ni se asigna otro silenciosamente; se ofrece abrirlo para revisar.
Una copia incierta o un error posterior a publicar conserva el aviso, no promete
rollback. Abrir una copia mantiene el aviso «Sin aprobación».

Los guardados de la UI comparan su digest explícito, no solo el último archivo
visto por el proceso: otro lector no puede refrescar su línea base de conflicto.
Las fechas de guardado/descarga no retroceden respecto de `updatedAt`, incluso
si un documento válido tiene fechas posteriores al reloj local.

### Evidencia F06 y límites

- `tests/integration/store/draft-copy.test.ts`: disco y HTTP reales; borrador
  frente a conflicto, reintento idempotente, activos copiados/faltantes,
  identidades/bindings, límites JSON escapado y digest de guardado entre lectores.
- `tests/e2e/protection.e2e.ts`: respuestas HTTP reales retenidas o perdidas
  después del commit, fallos reales de escritura/sync inyectados, decisiones de
  salida, apertura fallida, descarga con bytes parseados y solo lectura. La
  observación del Blob prueba contenido entregado a la API, **no** una descarga
  completada por el sistema operativo. Una prueba adicional usa el mecanismo
  real de descarga de Chrome y lee sus bytes temporales; esto no convierte la
  petición de descarga de la UI en confirmación general de guardado.
- `tests/integration/store/review-recovery.test.ts` y
  `tests/e2e/review-recovery.e2e.ts`: regresiones de la revisión independiente:
  replay histórico frente a reemplazo externo, copia desde JSON corrupto con
  recursos reales y defensas de rutas/hash intactas, y BOM conservado hasta una
  descarga nativa de Chrome. Cubren además lectura de recarga fallida, edición
  durante verificación incierta y reintentos con instancias nuevas de
  companion/ProjectStore, sin transferir mapas de recibos. El reinicio HTTP
  conserva un token configurado de prueba para aislar idempotencia de rotación
  de credenciales; no acredita reinicio abrupto de proceso ni corte eléctrico.
- La cancelación de recarga/cierre nativos y la descarga nativa se prueban en
  Chrome existente; los otros recorridos usan Lightpanda. Se capturan errores JS y de consola y se
  admiten únicamente los errores HTTP exactos provocados por casos negativos.
  No hay evidencia nueva de layout, accesibilidad visual, codecs ni render.

## Reinicio offline y recuperación entre procesos (F08)

Verificación local del 2026-11-04: `npm run typecheck`, **297 pruebas
unitarias/integración** y **25 E2E** (22 Lightpanda, 3 Chrome), sin omisiones.
La revisión independiente final F08 completó esos mismos checks sin bloqueantes;
unidad revisada en `d4348cf573d897137b4dc2310e5cdda5f36c5ce8`.
G1 queda cerrado en alcance técnico local, no como PASS global de producto ni
aceptación visual humana. La autorización posterior permite V01 local; no
habilita proveedores, despliegue ni ejecución nativa de medios.

| Recorrido | Evidencia reproducible |
|---|---|
| Vacío y parcial | `tests/e2e/process-roundtrip.e2e.ts`, caso `empty and partial`: crear/editar/guardar desde UI, terminar y esperar salida del navegador y CLI productivo, iniciar PIDs nuevos y comparar JSON completo y bytes; conserva nulls, arrays y manifest faltante. |
| Identidad y medios históricos | Mismo archivo, caso `imported approval notice`: aviso de aprobación eliminada y estado persistente **Sin aprobación**; entities completas (seed, versión, identidad y proporciones), instancias, audio, palabras y bindings deliberadamente obsoletos se conservan. Revincula bytes sintéticos sin reproducirlos, guarda, reinicia ambos procesos y transporta la carpeta a un segundo workspace aislado. Compara contenido y bytes del recurso. |
| Token rotado | Caso `token rotation`: reinicio del CLI en el puerto previo, token nuevo; la página vieja recibe 401, conserva dirty y no cambia el archivo. Tras descarte explícito de esa edición de prueba y recarga, recupera el último commit y guarda con el token nuevo. No renueva credenciales ni descarta cambios automáticamente. |
| Escritores reales | `tests/integration/process-recovery.test.ts`, caso `live lock`: un segundo CLI se rechaza incluso con force unlock mientras el dueño vive; SIGKILL del hijo propio deja lock y exige recuperación explícita del dueño muerto. |
| Escritura interrumpida | Caso `failed write and SIGKILL`: fallo previo a escribir y muerte después de escribir realmente 17 bytes de temporal; otro proceso recupera los bytes canónicos anteriores. Reporta temporales parciales o válidos sin promoverlos, también si el canónico está corrupto. |

### Cómo se aísla la evidencia

- `tests/helpers/companion-process.ts` crea exclusivamente raíces `mkdtemp`,
  comprueba puertos loopback aleatorios (también el puerto al reutilizarlo) y
  conserva referencias únicamente a hijos propios. El cierre espera su salida;
  SIGKILL es intencional en dos escenarios, limitado a esos hijos/raíces.
  No toca el workspace real ni mata procesos para obtener un puerto.
- Los recorridos normales usan `src/companion/main.ts`. Solo la inyección de
  fallo usa `tests/helpers/fault-companion.ts`: mismo HTTP/ProjectStore con
  operaciones de disco reales envueltas; ningún interruptor de fallo entra al CLI
  productivo. La integración usa un HTML inerte propio para obtener el token,
  por lo que `npm test` no exige un build previo; los E2E sí usan el build real.
- `tests/helpers/process-browser.ts` instala routing antes de cargar la app:
  permite solo el origen loopback del companion y aborta lo demás. Un intento
  controlado a TEST-NET prueba el bloqueo; luego exige cero solicitudes externas
  de la app, cero errores runtime y cero errores de consola, salvo los dos 401
  exactos del caso de token obsoleto. El probe se aísla en otra página.
- `tests/helpers/loopback-only.ts`, precargado solo en hijos de prueba, rechaza
  conexiones TCP y lookup DNS no loopback (callback y promesas, incluido el
  import nombrado de `node:dns/promises`) antes de salir; cada hijo verifica esa
  barrera. No es firewall del sistema ni certifica tráfico UDP/WebRTC o actividad
  fuera del proceso instrumentado. La evidencia offline es de estos recorridos
  HTTP/DOM; no se afirma aislamiento universal de red del sistema operativo.
- No hay esperas fijas para completar operaciones: readiness tiene reintento
  acotado y deadline; la interrupción espera el marcador de escritura parcial.

`tests/unit/process-helpers.test.ts` cubre las dos correcciones residuales de
revisión: resolutores DNS sustituidos por stubs de registro antes de cargar la
barrera (sin red externa), y rechazo inyectado de `browser.close()` que aun así
detiene y espera la salida del hijo propio mediante `finally`.

### Límites de esta evidencia

La UI muestra **Sin aprobación** siempre que `approval` sea null, también al
reabrir sin el aviso de importación. Esto no implementa aprobar ni exportar.
Los digests obsoletos se comparan y preservan, no se renuevan. Identidad y
proporciones están verificadas como datos persistidos, **no** como continuidad
visual renderizada. No se ejecuta codec nativo, audio, renderer ni FFmpeg.
Siguen vigentes los límites de inspección F05: cabeceras/contenedores, techo
conservador de 100 MiB y watchdog de 10 s, sin validación completa de codecs.
SIGKILL no simula pérdida de energía ni certifica durabilidad física.

Lightpanda incluye el contenido inicial del textarea en ciertos nombres de
etiqueta exactos: la reapertura comprueba el control por su etiqueta parcial y
su valor, sin clicks forzados ni afirmaciones de layout. Context7 siguió sin cuota;
se consultó la documentación oficial de
[routing de Playwright](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).

## Timeline determinista (V01)

`evaluateFrame(project, frameIndex)` comparte el reloj F02 y valida el snapshot
schema 1 en cada llamada; no mantiene estado ni modifica el proyecto. Devuelve
`{frameIndex, timeMs, sceneIndex, sceneId, sceneTimeMs, seed}` sin referencias
mutables al documento. No interpreta visuales ni consume activos/bindings.

- Dominio: índices enteros seguros en `[0, ceil(durationMs × fps / 1000))`.
  Vacío y endpoint no tienen muestra: `RangeError`, sin clamp silencioso.
- Tiempo: `frameIndex × 1000 / fps`, conserva fracciones; tiempo local por resta.
  Escenas contiguas con intervalo activo `[startMs, startMs + durationMs)`.
- Rechaza snapshots inválidos y estilos en solo lectura. Visual/audio nulos,
  palabras vacías y medios faltantes no impiden muestrear un borrador válido.
- Seed raíz se expone sin cambiarla; seeds/versiones de entidades permanecen en
  el documento. No hay PRNG nuevo: diseño procedural corresponde a V02.

`tests/unit/timeline.test.ts`: tres pruebas F02 existentes + ocho nuevas V01.
RED: **3 pasan / 8 fallan** con cuerpo del evaluador aún no implementado (exit 1);
GREEN: **11/11**, cero omisiones. Cubre fronteras, todos los frames del fixture,
último frame, seek inverso/fuera de orden, errores sin mutación y seed roundtrip.
La [matriz V01](../plan/delivery.md#evidencia-local-de-v01--reloj-y-selección-de-escena-2026-11-04)
delimita los criterios. La revisión técnica independiente de V01 se completó
sin bloqueantes: repitió **305/305** pruebas, **11/11** enfocadas, typecheck y
diff check; además verificó **2 163 600** comparaciones de fronteras contra
aritmética racional y **1800** frames con snapshots congelados.

Regresión completa de esta unidad: `npm run typecheck` y `git diff --check`
con exit 0; `npm test` **305/305** y `npm run test:e2e` **25/25**
(22 Lightpanda DOM, 3 Chrome para interfaces nativas), cero fallos/omisiones.
Los **25/25 E2E** fueron ejecutados por el implementador, no repetidos por el
revisor independiente. Verifican que M1 sigue funcionando; no integran aún este
sampler en UI.

Sin evidencia nueva de poses/cámara, overlays, sincronía audible, capturas ni
rendimiento. Validar por llamada es intencionalmente conservador; no hay medición
ni optimización del futuro hot path de render. El schema/formato no cambió.

## Modo solo lectura

Un `styleId`/`styleVersion` distinto de `stylized-3d@1` no invalida el archivo:
se valida el envoltorio y los límites, y cada `visual` no nulo se conserva como
JSON inerte (`{ inert: payload }`) con `mode: 'read-only'`. El payload original
también queda en `inertVisual` (array `{ sceneId, visual }`) para copiarlo sin
interpretarlo. Nunca se hace preview, export ni jobs con ese contenido.

## Importación y revinculación (F05)

1. En Proyectos, seleccione **JSON externo**. Solo se lee ese archivo, no su
   carpeta ni rutas/URLs declaradas en él. El original permanece intacto.
2. Si el ID está libre se conserva. Si ya existe, elija **Abrir existente**,
   **Crear copia importada** con ID nuevo o cancelar; nunca se sobrescribe.
3. Una aprobación externa se elimina con revisión/fecha actualizadas (la copia
   nueva comienza en revisión 0). El aviso permanece en el editor, separado de
   los mensajes transitorios. Visuales, medios y bindings históricos se conservan.
4. El manifest muestra recursos faltantes. Guarde el borrador antes de elegir
   un archivo para **Revincular**. Un hash distinto exige confirmación y crea un
   assetId nuevo; actualiza referencias y revisiones sin renovar bindings.
5. La restauración idéntica no edita el JSON. Incorporar hash/metadatos sí es
   una edición persistente. Durante la petición no se permite editar ni navegar;
  si se edita mientras se lee el archivo local, no se aplica una respuesta vieja
  sobre ese borrador. Un resultado incierto se muestra como tal, no como rollback.
  El digest detecta cambios externos aunque no cambie la revisión. Se comprueba
  antes de inspeccionar y se relee el snapshot antes de escribir los recursos y
  de publicar el JSON.

Las carpetas de proyecto y `assets/` deben ser directorios normales, sin symlinks.
La publicación usa staging, fsync de archivos y directorios y rename. Un fallo
previo a publicar no crea un proyecto visible. Un fallo de sync posterior devuelve
recibo `uncertain`; `ProjectStore.verifyReceipt` relee el digest, sin garantizar
persistencia física. Un relink fallido limpia archivos nuevos solo si puede probar
que sigue vigente el JSON anterior; ante ambigüedad conserva ambos archivos para
recuperación. No hay recolección automática de esos archivos huérfanos.
Restaurar un archivo idéntico también sincroniza el directorio del proyecto, no
solo `assets/`: así se persiste una entrada de carpeta recreada. Si falla ese sync,
la operación devuelve error (los bytes pueden estar visibles, no promete rollback);
el reintento vuelve a sincronizar el padre aunque la carpeta ya exista.

### Alcance de inspección de medios

- WAV PCM/float: comprueba RIFF completo, chunks, canales, frecuencia,
  bits/alineación/byteRate coherentes y duración derivada del tamaño de datos.
- MP3: recorre frames Layer III completos y frecuencia consistente; rechaza
  colas truncadas/no soportadas. No decodifica muestras ni certifica audibilidad.
- PNG/JPEG: firma, dimensiones y estructura acotada del contenedor (PNG exige
  IHDR, IDAT e IEND; JPEG segmentos completos, SOF, SOS y terminador).
- Se aplican 50 MiB, 2 canales, 48 kHz, 60 s y 4096 px/16 megapíxeles.
- El tamaño decodificado se acota conservadoramente desde cabeceras a **100 MiB**:
  PNG/JPEG se presupuestan como RGBA8 o RGBA16 según profundidad; audio como
  muestras float64. Un PNG RGBA16 de 4000×4000 se rechaza por requerir 128 000 000
  bytes. Formatos de muestra desconocidos, PNG animado y múltiples frames JPEG se
  rechazan en lugar de adivinar el presupuesto.
- La inspección se ejecuta en un worker Node descartable, con watchdog del padre
  de **10 s** (incluye inicio/transferencia). Al vencer se termina el worker y solo
  después se devuelve error; no se escriben recursos por una inspección rechazada.
  Se admiten como máximo dos inspecciones concurrentes, sin cola ilimitada; una
  petición adicional falla con `inspection-busy`. No se desprenden los bytes del
  llamador: se transfiere una copia de hasta 50 MiB.

**No es validación completa de codecs:** no comprueba CRC/deflate de PNG ni
decodifica JPEG/MP3. El presupuesto de 100 MiB es de datos de salida derivados
de cabeceras, no una medición ni un límite de memoria total de un codec real
(incluidos metadatos comprimidos, buffers auxiliares y memoria nativa). El límite
de heap JS del worker tampoco limita sus ArrayBuffers o la memoria del proceso.
Los archivos son datos pasivos; que un
archivo esté presente o revinculado no habilita preview/export ni declara medios
actuales. Antes de consumirlos en M2 se requiere decodificador acotado y rechazo
de contenido que no pueda verificarse. No se ejecutan herramientas externas ni
se instalaron dependencias nuevas para esta unidad.

### Evidencia y límites de verificación

`tests/integration/store/import-relink.test.ts` usa dos workspaces reales y
fallos de disco inyectados; cubre identidad/colisión, aprobación, visual inerte,
restauración/reemplazo, bindings históricos, symlinks, validación previa a escribir,
revisión/digest obsoletos, sync de la carpeta recreada y fsync incierto.
`tests/integration/companion/server.test.ts` comprueba rutas exactas, autorización,
el límite del JSON escapado y rechazo HTTP de RGBA16 sobredimensionado.
`tests/unit/inspection-runner.test.ts` ejecuta un worker realmente bloqueado en
un bucle CPU, acredita que el padre sigue respondiendo y verifica su terminación
antes del rechazo (deadline abreviado de 1 s en prueba, techo productivo de 10 s).

`tests/e2e/studio.e2e.ts` usa Lightpanda/CDP y disco real: importación inválida,
aviso de aprobación, borrador dirty, lectura tardía, respuesta HTTP retenida,
cancelar/confirmar sustitución, digest externo con misma revisión y colisión como copia. Captura errores JS y de
consola; solo admite los errores HTTP exactos provocados por casos negativos.
Es evidencia DOM/lógica, **no** revisión visual, de layout o de codecs. Context7
no estuvo disponible por cuota; se consultó documentación oficial de React para
limpieza de efectos y descarte de respuestas tardías.
