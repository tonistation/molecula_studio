# Entorno de desarrollo M1

Este documento describe lo que existe hoy en M1: schema, `ProjectStore`,
frontera HTTP loopback y el estudio React que guarda, reabre e importa borradores
con manifest y revinculación explícita de recursos (F05). No
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
(`lightpanda serve`). Si el binario o `dist/studio` faltan, el test se marca
`skipped`, que **no** es un pase.

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
    timeline.ts           # totalFrames / frameTimeMs
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
| `PUT /api/projects/:id` | Guarda con `expectedRevision` + `operationId` (idempotente) |
| `POST /api/projects/:id/copy` | Copia portable con identidad nueva y `approval: null` |
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
