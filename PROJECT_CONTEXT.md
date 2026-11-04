# Contexto de Molecula Studio

Estudio local-first para preparar videos verticales animados, conservar borradores y exportar sin depender de proveedores. **M1/G1 técnico local cerrado y V01 implementado/revisado** en la base `cbfc125`; 9 de 27 unidades completas, 18 restantes. No existe todavía composición 3D, preview audiovisual ni exportación MP4. Evidencia histórica: 305 pruebas y 25 E2E, con procedencia diferenciada en [delivery](docs/plan/delivery.md); no se repitieron para esta intervención documental. No confundir implementación, aceptación técnica y aprobación estética humana.

## Lectura mínima

1. [PRD canónico](docs/plan/requirements.md): R01–R20, alcance y trazabilidad.
2. [Datos](docs/plan/project-format.md) y [API actual/diseñada](docs/plan/api-contracts.md).
3. [Componentes y layout](docs/ux/components.md), [pantallas](docs/ux/screens.md) y [flujos](docs/ux/flows.md).
4. [Tarjetas delegables](docs/plan/implementation-tasks.md): dependencias, límites y revisión.

## Stack y bibliotecas permitidas

Instalado/declarado en `package.json` y lockfile: React/React DOM 19, TypeScript 7.0.2, Vite 8, plugin React, tipos Node/React y `playwright-core` para pruebas. Node fijado por `.nvmrc`; engines `>=26.3.0 <27`. Usar módulos ESM y APIs nativas Node para companion, archivos, HTTP, crypto y tests. No actualizar versiones como efecto lateral.

Propuesto, **no instalado por este plan**: Three.js para `stylized-3d@1`; Chromium y FFmpeg/ffprobe para captura/inspección local. Su instalación, ejecución nativa y redistribución requieren respetar los gates de [decisiones](docs/plan/implementation-tasks.md#registro-de-decisiones-y-autorizaciones). No añadir un framework UI, gestor de estado o validador nuevo sin justificar y revisar el cambio de contrato. Remotion, Motion Canvas y Theatre están excluidos del baseline. Sin DB: JSON schema 1 y activos relativos ya están implementados; journal/cache futuros quedan fuera del JSON portable.

## Estilo de código y producto

Seguir el código cercano: TypeScript estricto, imports de tipos explícitos, extensiones `.ts`/`.tsx`, comillas simples, punto y coma, indentación de dos espacios; `camelCase` para funciones/variables, `PascalCase` para tipos/componentes y constantes de límites en mayúsculas. Identificadores y comentarios técnicos en inglés; extender la UI y documentación existentes en español profesional neutro. Componentes funcionales React y CSS propio; no imponer otro sistema visual. Las láminas HTML no son seis pantallas funcionales ni una aprobación estética. Texto importado es dato, nunca HTML ejecutable.

## Carpetas y propiedad

Existentes: `src/shared/` (schema, digests, timeline); `src/companion/store/` (disco/activos/recibos), `src/companion/server/` (HTTP), `studio/src/` (App, modelo, cliente, pantallas y CSS), `tests/` (unit/integration/e2e), `docs/plan/`, `docs/ux/`, `docs/dev/`. `docs/reference/original-specification.md` es inmutable. Rutas **propuestas**, todavía no existentes: `src/shared/contracts/`, `src/composition/`, `src/companion/render/`, `src/companion/jobs/`, `src/companion/providers/` y `studio/src/components/`. Las tarjetas asignan dueño; cambios compartidos de schema/HTTP/Editor se integran de forma serializada.

## Límites operativos

Un companion escritor por workspace; loopback, token efímero, Origin/Host estrictos y handles, nunca rutas arbitrarias. Guardar borradores sigue disponible sin audio/render. Ningún JSON, aprobación editorial o plan autoriza red, proveedor, gasto, credenciales, instalación, ejecución nativa, commit, push o despliegue. Esta intervención solo cambia documentación; no inicia V02 ni elige modelo. El coordinador delegará después de revisión documental fresca y de autorización de ejecución aplicable.
