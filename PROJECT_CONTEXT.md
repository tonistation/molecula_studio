# Contexto de Molecula Studio

Estudio local-first para crear videos verticales animados mediante guion, voz, vista previa y exportación. **M1/G1 técnico local cerrado y V01 implementado/revisado** en la base `cbfc125`. Existen renderer 3D determinista del kit, subtítulos karaoke con fuente local, vista previa en Remotion Studio y exportación MP4 silenciosa por CLI (1.3b–1.5). El editor integra vista previa silenciosa del borrador con controles y seek por escena (2.2), y exportación de la revisión guardada con progreso y descarga (2.3); todavía no hay voz. El [ROADMAP](ROADMAP.md) es el plan activo; el backlog anterior está congelado. Evidencia histórica: 305 pruebas y 25 E2E, con procedencia diferenciada en [delivery](docs/plan/delivery.md); no implica una ejecución nueva ni aprobación estética.

## Lectura mínima

1. [ROADMAP activo](ROADMAP.md): decisiones, arquitectura y paso solicitado.
2. Este contexto y los archivos indicados por ese paso.
3. Como referencia histórica: [requisitos](docs/plan/requirements.md), [datos](docs/plan/project-format.md), [API](docs/plan/api-contracts.md) y [backlog congelado](docs/plan/implementation-tasks.md). Si difieren del ROADMAP, prevalece este último.

## Stack y bibliotecas permitidas

Instalado/declarado en `package.json` y lockfile: React/React DOM 19, TypeScript 7.0.2, Vite 8, plugin React, tipos Node/React y `playwright-core` para pruebas. Node fijado por `.nvmrc`; engines `>=26.3.0 <27`. Usar módulos ESM y APIs nativas Node para companion, archivos, HTTP, crypto y tests. No actualizar versiones como efecto lateral.

Instalados: Remotion para composición, preview y render MP4, y Three.js vía `@remotion/three`; consultar [licencias](docs/dev/licenses.md). Guion y voz tendrán modos automático y manual; Vibi es el proveedor previsto para voz. Sin DB: JSON schema 2, kit declarativo validado y migración pura desde schema 1 implementados en 1.3a; activos relativos y vínculos de medios se conservan. Abrir v1 no escribe en disco; el siguiente guardado usa v2. En 3.1 se añade el contrato estricto `ScriptProposal` y su prompt puro, sin parser ni generación todavía. Schema 2 admite metadatos raíz opcionales `sources`, `cover` y `postText`, validados y preservados sin completar los documentos anteriores; participan en el digest de contenido, no en los vínculos de medios. Las URLs de fuentes son referencias HTTP(S), nunca activos descargados. Renderer del kit implementado en 1.3b; `npm run video:studio` permite ver `Vertical` y `SalDelMar`. Cámara, objetos y partículas derivan del tiempo absoluto; `remotion.config.ts` selecciona ANGLE.

## Estilo de código y producto

Seguir el código cercano: TypeScript estricto, imports de tipos explícitos, extensiones `.ts`/`.tsx`, comillas simples, punto y coma, indentación de dos espacios; `camelCase` para funciones/variables, `PascalCase` para tipos/componentes y constantes de límites en mayúsculas. Identificadores y comentarios técnicos en inglés; extender la UI y documentación existentes en español profesional neutro. Componentes funcionales React y CSS propio; no imponer otro sistema visual. Las láminas HTML no son seis pantallas funcionales ni una aprobación estética. Texto importado es dato, nunca HTML ejecutable.

## Carpetas y propiedad

Existentes: `src/shared/` (schema, digests, timeline); `src/companion/store/` (disco/activos/recibos), `src/companion/server/` (HTTP), `studio/src/` (App, modelo, cliente, pantallas y CSS), `tests/` (unit/integration/e2e), `docs/plan/`, `docs/ux/`, `docs/dev/`. `docs/reference/original-specification.md` es inmutable. Rutas objetivo y responsabilidades: [arquitectura del ROADMAP](ROADMAP.md#arquitectura-objetivo).

## Límites operativos

Un companion escritor por workspace; loopback, token efímero, Origin/Host estrictos y handles, nunca rutas arbitrarias por HTTP. Guardar borradores sigue disponible sin audio/render. Los secretos van solo en variables de entorno. La exportación CLI usa la revisión guardada, sin bloquear por `approval`, y admite un render a la vez en memoria del servicio. Ejecutar solo el paso solicitado; instalación, proveedores, gasto, commit y push requieren autorización aplicable. Las decisiones y límites completos están en [ROADMAP](ROADMAP.md#reglas-para-opencode).
