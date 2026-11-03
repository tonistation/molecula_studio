# Entorno de desarrollo M1

Este documento describe el scaffold real de M1 (unidades F01 y F02). No promete
render, proveedores ni exportación: esa evidencia pertenece a M2 en adelante.

## Alcance local de M1

- Un solo paquete npm en la raíz del repositorio; no hay workspaces ni monorepo.
- `src/shared/` es isomorfo (Node y navegador) y contiene el schema ejecutable,
  la canonicalización, los digests y el reloj de frames.
- `src/companion/` y `src/studio/` existen solo como carpetas de trabajo. Sus
  scripts `dev:companion` y `dev:studio` son marcadores que fallan de forma
  explícita hasta que lleguen las unidades F03/F04.
- Sin renderer, sin React, sin Vite, sin proveedores, sin secretos y sin red más
  allá de `npm install`.

## Versiones instaladas

Verificado el 2026-11-03 con `node --version`, `npm --version` y las versiones
resueltas en `package-lock.json`:

| Herramienta | Versión | Notas |
|---|---|---|
| Node.js | 26.3.0 | LTS Lithium; `engines: ">=26.3.0 <27"` y `.nvmrc` con `26.3.0` |
| npm | 11.16.0 | Instalación con versiones exactas (`--save-exact`) |
| TypeScript | 7.0.2 | `devDependencies`; `tsc --noEmit` para typecheck |
| @types/node | 26.6.6 | Tipos de `node:*`, `crypto.subtle`, `TextEncoder` |
| zod | 4.6.7 | `dependencies`; reservado para unidades posteriores, **no se usa en F02** |

El schema de F02 es un validador propio de objetos cerrados: zod no participa en
`parseProjectText` ni en `validateProject`. Se instaló por decisión del
coordinador para no bloquear unidades siguientes.

Los tests se ejecutan con el runner nativo de Node y type stripping nativo
(Node 26 ejecuta `.ts` directamente). No hay `ts-node`, `tsx`, Jest ni Vitest.

## Comandos

```sh
npm install            # instala y respeta package-lock.json
npm run typecheck      # tsc --noEmit (strict, sin emitir)
npm test               # node --test "tests/**/*.test.ts"
npm run test:unit      # solo tests/unit
npm run test:integration  # solo tests/integration (usa disco real en tmpdir)
```

`npm run dev:companion` y `npm run dev:studio` existen por contrato de F01 y
salen con código 1 indicando que el entrypoint llega en una unidad posterior.

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
  companion/              # placeholder (.gitkeep)
  studio/                 # placeholder (.gitkeep)
tests/
  unit/                   # canonical, timeline, schema, hostile, digests
  integration/            # roundtrip real por disco
  helpers/fixtures.ts
fixtures/projects/
  empty.json              # copia de docs/plan/examples/empty-project.json
  storyboard.json         # copia de docs/plan/examples/storyboard-project.json
  draft-partial.json      # una escena, visual null, palabras vacías, audio en manifest
  unknown-style.json      # estilo no instalado, abre en modo solo lectura
```

`.molecula-workspaces/` está ignorado por git y queda reservado para datos de
ejecución local (workspace del companion). Los tests usan `mkdtemp` del sistema.

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

## Modo solo lectura

Un `styleId`/`styleVersion` distinto de `stylized-3d@1` no invalida el archivo:
se valida el envoltorio y los límites, y cada `visual` no nulo se conserva como
JSON inerte (`{ inert: payload }`) con `mode: 'read-only'`. El payload original
también queda en `inertVisual` (array `{ sceneId, visual }`) para copiarlo sin
interpretarlo. Nunca se hace preview, export ni jobs con ese contenido.
