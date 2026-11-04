# Entorno de desarrollo M1

Este documento describe lo que existe hoy en M1: schema, `ProjectStore`,
frontera HTTP loopback y el estudio React que guarda y reabre borradores. No
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

Controles: bind solo a `127.0.0.1`; `Host` debe ser el origen del companion
(anti DNS rebinding); `Origin` debe estar en la allowlist y toda petición que
cambia estado lo exige (anti CSRF); sin cabeceras CORS; cuerpos JSON de 2 MiB
más 64 KiB de margen; handles opacos, nunca rutas; los errores no devuelven
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
