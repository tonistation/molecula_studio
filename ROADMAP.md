# Ruta al primer video — plan activo

Guía para terminar Molecula Studio con OpenCode, paso a paso, hasta exportar el **primer video vertical de punta a punta**: idea → guion → voz → vista previa → MP4. Sustituye a [`docs/plan/implementation-tasks.md`](docs/plan/implementation-tasks.md) como plan activo; ese backlog queda congelado como endurecimiento posterior ([mapeo](#qué-pasa-con-el-plan-anterior)).

Base: commit `ad26d62`. Uso local, una persona. Servidor: [más adelante](#camino-a-servidor-no-ahora).

> **Regla de oro:** cada paso termina con algo que se puede **ver o escuchar**. Si un paso no acerca el primer video, no va antes del primer video.

## Cómo usar esta guía

1. Una sesión de OpenCode = un paso (por ejemplo `1.3`), en su propia rama `feat/<paso>-<slug>`.
2. Pegar el [prompt de ejecución](#prompt-de-ejecución) con el ID del paso.
3. OpenCode implementa, ejecuta `npm run typecheck` y los tests del paso, y explica cómo verificar a mano.
4. OpenCode hace commit en la rama del paso y lo marca en [Progreso](#progreso). Verificar el criterio de aceptación (ver/escuchar); si se cumple, fusionar la rama en `main` (o pedírselo a OpenCode).
5. Al cerrar cada fase: sesión nueva con el [prompt de revisión](#prompt-de-revisión).

## Dónde estamos

| Pieza | Estado | En esta ruta |
|---|---|---|
| Schema `project.json` v2, migración desde v1, validación, digests | ✅ | Se extiende la base existente sin cambiar los vínculos de medios |
| Companion local: HTTP loopback, token, `ProjectStore` atómico | ✅ | Se extiende con rutas nuevas |
| Estudio React: proyectos, escenas (texto/duración), guardar/reabrir, importar, relink | ✅ | Se extiende |
| Reloj por frame (`src/shared/timeline.ts`) | ✅ | Se reutiliza para calcular frames |
| Composición visual 3D + subtítulos | ✅ | Fase 1 |
| Exportar MP4 | ✅ CLI y UI, silencioso | Fase 1 (CLI) y Fase 2 (UI) |
| Vista previa en el estudio | ✅ Borrador con audio manual por escena | Fases 2 y 4.2 |
| Guion automático / manual | Ambos implementados ✅ · proveedor real pendiente | Fase 3 |
| Voz automática / manual | Manual implementada ✅ · automática pendiente | Fase 4 |

Del plan anterior están completas 9 de 27 unidades (≈33 %), pero son la **base de persistencia**. Ninguna de las cuatro piezas que producen un video existe todavía. Esta ruta las pone primero.

## Decisiones

| ID | Decisión | Por qué | Descartado |
|---|---|---|---|
| ADR-01 | **Remotion** para composición, vista previa (`@remotion/player`) y render MP4 (`@remotion/renderer`). Three.js vía `@remotion/three`. | Resuelve reloj por frame, sincronía de audio, captura en Chromium y codificación (trae su propio FFmpeg). Elimina V03c, V05 y casi todo V06. Tiene skills oficiales para agentes. Licencia gratuita para personas y empresas de hasta 3 personas. | Pipeline propio Chromium + FFmpeg. El motivo anterior («licencia comercial obligatoria») no aplica a uso individual. |
| ADR-02 | **Modo dual por paso generativo**: `auto` (proveedor) y `manual` (copiar prompt/texto, importar resultado). Ambos modos producen el mismo tipo y pasan por la **misma** función `apply`. | Es la metodología central del producto; garantiza costo cero cuando se quiera. | Proveedor real como opcional al final (E05). |
| ADR-03 | Guion `auto` con **Codex CLI** (`codex exec --output-schema`) usando la sesión ChatGPT local. | Costo marginal cero; salida JSON validada por schema. | API de pago desde el inicio. |
| ADR-04 | Voz `auto` con **Vibi** (`api.vibi.pro`, voces ElevenLabs/MiniMax/CapCut), una tarea por escena. Tiempos por palabra con el **speech-to-text de Vibi** (`timestamps_granularity: word`), que sirve igual para audio subido a mano. Clave en variable de entorno del companion. | Proveedor que ya se usa. El TTS de Vibi no devuelve tiempos por palabra (solo SRT opcional); su STT sí, y unifica la alineación de ambos modos. | ElevenLabs directo con `/with-timestamps`. |
| ADR-05 | `builtin-sans-heavy-v1` = archivo de fuente **OFL** local (p. ej. Montserrat ExtraBold) dentro del repo. | Cierra D01 para la fuente; sin red en runtime. | Google Fonts en runtime. |
| ADR-06 | Exportar usa la **revisión guardada** en disco. `approval` no bloquea exportar en v1. | Lo exportado = lo guardado; sin preflight ni snapshots. | V04b/V06a. |
| ADR-07 | **Un render a la vez**, estado en memoria del companion, sin journal ni recuperación tras reinicio. | Uso local de una persona. | Cola recuperable (V06b–c). |
| ADR-09 | Escenas **declarativas sobre un kit** (`visual.kind: 'kit'`): la IA devuelve JSON validado que combina piezas del kit (cielo, terreno, agua, objetos, personaje, partículas, rótulos, cámara). Se reserva `visual.kind: 'code'` (componente generado por IA) como salida de emergencia **posterior y solo local**. Requiere `schemaVersion: 2` con migración desde v1. | Seguro (datos, no código), determinista, vista previa instantánea, modo manual pegando JSON y apto para un servicio futuro sin sandbox. Las [referencias](docs/ux/references/README.md) piden objetos específicos del tema: el catálogo fijo de 5 entidades no alcanza. | Solo código generado (exige compilar en preview y render, y sandbox en servidor). |
| ADR-08 | `implementation-tasks.md` **congelado**. Se retoma una tarjeta solo si aparece el problema que resuelve. | Las 37 tarjetas anteponen robustez a producto. | Ejecutarlas en orden. |

## Arquitectura objetivo

```text
idea + estilo
   │
   ├─ Guion ── auto: companion → codex exec ──┐
   │           manual: copiar prompt / pegar ─┴→ ScriptProposal → applyScriptProposal() → borrador → Guardar
   │
   ├─ Voz ──── auto: companion → Vibi TTS ────┐
   │           manual: subir audio por escena ┴→ audio → words (Vibi STT o estimadas) → ProjectStore.attachSceneAudio() (guarda)
   │
   ├─ Vista previa: <Player> + src/video  (mismo código que el render)
   │
   └─ Exportar: companion → @remotion/renderer → <workspace>/.renders/<projectId>/<rev>-<fecha>.mp4
```

### Carpetas nuevas

| Ruta | Contenido | Reglas |
|---|---|---|
| `src/video/` | Composición Remotion: `index.ts`, `Root.tsx`, `VerticalVideo.tsx`, `styles/`, `captions/`, `fonts.ts`, `assets/fonts/` | React puro, sin APIs Node. Todo movimiento deriva de `useCurrentFrame()`. |
| `src/shared/video-props.ts` | `projectToVideoProps(project, assetUrls)` | Puro, `.ts` sin JSX (Node lo importa). |
| `src/shared/script/` | `schema.ts`, `prompt.ts`, `parse.ts`, `apply.ts` | Puro; lo usan estudio (manual) y companion (auto). |
| `src/shared/kit/` | Contrato `KitScene`, validador, prompt y parseo de dibujo | Puro; datos, nunca código. |
| `src/video/kit/` | Renderer del kit: entorno, objetos, partículas, overlays, cámara | Determinista. |
| `src/shared/voice/` | `estimate.ts`, `alignment.ts` | Puro. |
| `src/companion/render/` | `render-service.ts`, `render-assets.ts` | Un render a la vez. |
| `src/companion/providers/` | `capabilities.ts`, `codex-cli.ts`, `vibi.ts` | Únicos módulos con red o procesos externos. |
| `studio/src/components/` | `PreviewPlayer.tsx`, `ExportPanel.tsx`, `ScriptStep.tsx`, `VoiceStep.tsx`, `Stepper.tsx` | Reutilizan `api.ts` y `model.ts`. |

### Rutas HTTP nuevas

Todas bajo la frontera actual (token + Origin/Host), salvo `render-assets`.

| Método y ruta | Uso | Paso |
|---|---|---|
| `GET /api/projects/:id/assets/:assetId` | Bytes de un activo del manifest; el estudio crea un blob URL | 2.1 |
| `POST /api/projects/:id/renders` | `{ expectedRevision }` → `{ renderId }`; 409 si la revisión no coincide o ya hay un render | 2.3 |
| `GET /api/projects/:id/renders/:renderId` | `{ status, progress, outputPath?, error? }` | 2.3 |
| `GET /api/projects/:id/renders/:renderId/file` | Descarga del MP4 | 2.3 |
| `GET /render-assets/:token/:assetId` | Solo durante un render; token aleatorio de un render; fuera de `/api` porque Remotion no envía cabeceras | 2.3 |
| `GET /api/capabilities` | `{ codex: boolean, vibi: boolean }` | 3.5 |
| `POST /api/script/generate` | `{ idea, styleId, locale, targetSeconds }` → `ScriptProposal` (no guarda) | 3.5 |
| `POST /api/drawing/generate` | `{ project, sceneId }` → una `KitScene` del borrador validado, con continuidad (no guarda) | 3.5 |
| `PUT /api/projects/:id/scenes/:sceneId/audio` | Modo manual: bytes de audio (+ `?align=vibi` opcional) → ingesta y guarda | 4.2 |
| `POST /api/projects/:id/scenes/:sceneId/voice` | Modo auto: `{ expectedRevision, voiceId?, provider? }` → Vibi TTS + STT → ingesta y guarda | 4.4 |

## Mapa de fases

| Fase | Resultado visible | Pasos |
|---|---|---|
| 0 | Documentos alineados, referencias visuales y dependencias instaladas | 0.1 – 0.4 |
| 1 | Primer MP4 **silencioso** desde un JSON de ejemplo, por línea de comandos | 1.1 – 1.5 (1.3 en a y b) |
| 2 | Vista previa y botón Exportar dentro del estudio | 2.1 – 2.3 |
| 3 | Idea → guion (auto o manual) → video silencioso | 3.1 – 3.5 |
| 4 | Voz (auto o manual) + subtítulos sincronizados → **primer video completo** 🎯 | 4.1 – 4.5 |
| 5 | Flujo guiado y pulido para uso diario | 5.1 – 5.4 |
| 6 | Después del primer video | [backlog](#fase-6--después-del-primer-video) |

---

## Fase 0 — Alinear y preparar

### 0.1 Registrar decisiones (solo documentación)

- **Hacer:** en `docs/plan/architecture.md`, reemplazar las filas «Chromium/Playwright + FFmpeg» y «Sin Remotion…» por ADR-01. Actualizar stack y límites de `PROJECT_CONTEXT.md`, estado y enlaces de `README.md`, y poner al inicio de `docs/plan/implementation-tasks.md`: «Congelado. Plan activo: ROADMAP.md». Crear `docs/dev/licenses.md` con tabla: componente, versión, licencia, condición (Remotion free license; fuente OFL; Vibi según plan contratado).
- **No hacer:** reescribir PRD ni API completa. No tocar `docs/reference/original-specification.md`.
- **Aceptación:**
  - [ ] Ningún documento índice contradice este ROADMAP.
  - [ ] Enlaces locales válidos.

### 0.2 Instalar dependencias

Ejecutar este paso es la autorización explícita de instalación.

- **Paquetes:** `remotion`, `@remotion/cli`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler`, `@remotion/three`, `@remotion/fonts`, `@remotion/captions`, `three`, `@react-three/fiber` (v9, compatible con React 19), `@types/three`.
- **Versión exacta idéntica** en todos los `@remotion/*` (sin `^`). Comprobar con `npx remotion versions`.
- **Navegador:** la primera vez Remotion descarga Chrome Headless Shell (`npx remotion browser ensure`). FFmpeg viene incluido; no hace falta `brew install ffmpeg`.
- **Skills para el agente:** `npx skills add remotion-dev/skills`. Confirmar que OpenCode las detecta; si no, enlazar la carpeta generada a la ruta de skills de OpenCode.
- **TypeScript:** incluir `src/video/` en `npm run typecheck` (tsconfig propio con `jsx: react-jsx`, o ajustar la raíz). `src/shared/` y `src/companion/` siguen siendo TS «strip-only» (sin JSX, sin `enum`), porque Node los ejecuta directo.
- **Aceptación:**
  - [x] `npm run typecheck` y `npm test` siguen en verde.
  - [x] Una sola versión de Remotion instalada.

### 0.3 Fuente

- Colocar el archivo OFL elegido en `src/video/assets/fonts/` con su `OFL.txt`. Registrar SHA-256 y licencia en `docs/dev/licenses.md`.
- **Aceptación:** [x] archivo, licencia y hash presentes.

### 0.4 Referencias visuales

- **Estado:** criterios iniciales ya escritos en [`docs/ux/references/README.md`](docs/ux/references/README.md) a partir de dos ejemplos. Ampliar con más ejemplos si hace falta.
- **Uso:** los pasos 1.3a, 1.3b, 1.4, 3.1 y 3.3 deben leer ese README antes de implementar.
- **ADR-09 decidido:** escenas declarativas sobre un kit (ver «Decisiones»).
- **Aceptación:** [x] criterios escritos · [x] ADR-09 registrado.

---

## Fase 1 — Primer MP4 silencioso (sin UI)

### 1.1 `projectToVideoProps` — TDD

- **Archivos:** `src/shared/video-props.ts`, `tests/unit/video-props.test.ts`.
- **Hacer:** `Project` + `assetUrls: Record<string, string>` → `{ fps, width, height, durationInFrames, captionStyle, voiceMode, entities, scenes: [{ sceneId, title, fromFrame, durationInFrames, text, visualIntent, visual, words, audioUrl | null, gainDb }] }`. Usar `totalFrames` de `timeline.ts`. Estilo desconocido o visual inerte → error explícito. `visual: null` → escena provisional con fondo y `visualIntent` (no es error). `text` permite estimar subtítulos y `entities` conserva las definiciones referenciadas por los visuales.
- **Aceptación:**
  - [x] Con `docs/plan/examples/storyboard-project.json`: frames y fronteras de escena correctos y contiguos.
  - [x] Función pura: misma entrada, misma salida.

### 1.2 Composición base y Remotion Studio

- **Archivos:** `src/video/index.ts` (`registerRoot`), `src/video/Root.tsx`, `src/video/VerticalVideo.tsx`; script `npm run video:studio` → `remotion studio src/video/index.ts`.
- **Hacer:** `<Composition id="Vertical">` 1080×1920, 30 fps, `calculateMetadata` desde las props, `defaultProps` desde el JSON de ejemplo. Un `<Sequence>` por escena con fondo y título provisional.
- **Aceptación:** [x] Remotion Studio muestra 12 s con 2 escenas y el scrub funciona.

### 1.3a Contrato `KitScene` y schema 2 — TDD

Cambio de contrato autorizado por ADR-09. Leer antes [referencias visuales](docs/ux/references/README.md).

- **Archivos:** `src/shared/kit/{types,schema,validate}.ts`, `src/shared/schema/` (versión 2 y migración), tests unitarios.
- **Contrato** (`visual.kind: 'kit'`, `kitVersion: 1`), todo en datos, sin código ni URLs:
  - `palette`, `sky` (degradado, sol, nubes), `environment` (terreno: `mountain`, `cliff`, `plain`; agua: `sea`, `river` por puntos, `waterfall`), con `seed` propia.
  - `objects[]`: `{ id, type, params, position, rotation, scale, color, animations[] }`. Tipos iniciales: primitivas low-poly (`box`, `sphere`, `cylinder`, `cone`, `lathe` por perfil para botellas o saleros), `rock`, `drop`, `character` (articulado, con poses), `arrow`.
  - `animations[]`: `{ type, startMs, endMs, easing, params }` con `move`, `fall`, `roll`, `pulse`, `appear`, `disappear`, `pose`.
  - `particles[]`: `sparkle`, `rain`, `bubbles` (con `seed`).
  - `labels[]`: píldora anclada a un `objectId`. `overlays[]`: `counter`, `chevrons`.
  - `camera`: `{ move: 'static' | 'dolly-in' | 'pan' | 'orbit' | 'follow', from, to, target | targetObjectId, easing }`.
  - Límites: ≤ 24 objetos, ≤ 8 animaciones por objeto, ≤ 4 sistemas de partículas, ≤ 6 rótulos por escena.
- **Schema 2:** `visual` pasa a `{ kind: 'kit', … } | { kind: 'code', … } | null`. `code` queda **reservado y rechazado** por el validador hasta su fase. Migración v1 → v2 pura: los `StylizedVisual` v1 se convierten a escenas `kit` equivalentes; abrir un v1 lo migra en memoria y se guarda como v2. Mantener todas las pruebas de M1 en verde.
- **Extensiones de compatibilidad aprobadas:** tipos `car`, `rockLayers` y `label`; `params` cerrados por tipo conservan proporciones y propiedades, y `seed` conserva la semilla de cada entidad. `legacy: { entityId, definitionVersion, motion, state }` retiene la referencia y el movimiento procedural v1; se comprueba contra la identidad registrada, sin permitir sobrescribirla. Las definiciones de `entities` permanecen intactas.
- **Cámara y paleta v1:** `camera.keyframes?` conserva todos los tiempos, posiciones, objetivos y FOV (hasta 8 keyframes). Cuando existe, esa pista es la fuente de la trayectoria; `from`, `to` y `target` resumen sus extremos y objetivo inicial. Se mantiene la proyección perspectiva. `palette: { background, preset? }` conserva el fondo y el preset `daylight`/`dark`, sin aproximar la cámara ni las identidades. La interpretación visual corresponde a 1.3b.
- **Fronteras:** validar v1 antes de migrar y validar el resultado como v2. Estilos desconocidos permanecen opacos y de solo lectura; `visual.kind: 'code'` se rechaza incluso allí. Abrir no escribe ni incrementa revisiones. El digest de concurrencia sigue describiendo los bytes originales del disco. Se preservan `approval` histórico y vínculos de medios; el digest de contenido cambia y no convierte esa aprobación en vigente. Importar/copiar conserva su política previa de limpiar la aprobación.
- **Límites adicionales del contrato:** hasta 12 nubes, 8 overlays, 64 puntos por curso de agua, 32 puntos por perfil y 1000 partículas por sistema; parámetros numéricos acotados y referencias verificadas. Contrato exacto en `src/shared/kit/types.ts` y límites en `src/shared/kit/schema.ts`. Serialización estable: orden declarado en raíz/escena y claves anidadas del kit ordenadas por nombre; los visuales desconocidos no se reinterpretan.
- **Aceptación:**
  - [x] Validador rechaza tipos desconocidos, campos extra, `kind: 'code'` y límites excedidos con mensajes claros.
  - [x] Los fixtures v1 migran y validan como v2; ida y vuelta guardar/reabrir estable.
- **Verificación 1.3a:** `npm run typecheck`, `npm test` (330 pruebas) y `npm run build:studio` en verde. Incluye fidelidad de cámara/identidades, corpus histórico de seguridad, aprobación histórica, límites exactos y guardar/reabrir con disco real y conflictos de digest. No implica aprobación visual ni renderer del kit.

### 1.3b Renderer del kit con Three.js

- **Archivos:** `src/video/styles/registry.ts`, `src/video/kit/{KitScene.tsx,camera.ts,animate.ts,environment/,objects/,particles/,overlays/}`, tests de `camera.ts` y `animate.ts`.
- **Hacer:**
  - Registry `styleId → renderer`; estilo no implementado muestra una pantalla de error visible, nunca negro.
  - `<ThreeCanvas>` 1080×1920, materiales con `flatShading`, luces y niebla según `palette`.
  - `camera.ts` y `animate.ts` (TDD): funciones puras de `(spec, ms) → estado`, con easing.
  - Una pieza por tipo del contrato; rótulos y overlays como DOM proyectado desde la posición 3D.
  - Crear `docs/plan/examples/kit/sal-del-mar.json` (escena tipo «río baja la montaña y arrastra una roca») como fixture de calidad.
- **Determinismo:** prohibido `Math.random`, `Date`, `useFrame` de R3F y animaciones CSS. Variación solo desde `seed`.
- **Render 3D:** usar `chromiumOptions: { gl: 'angle' }` (en CLI: `Config.setChromiumOpenGlRenderer('angle')`). Si aparecen frames negros o artefactos, revisar esto primero y bajar `concurrency`.
- **Aceptación:**
   - [x] La escena de ejemplo se ve en Remotion Studio con estética comparable a `ref-sal.jpg` (low-poly plano, cámara en movimiento, partículas, rótulos).
   - [x] Ir a un frame, avanzar y volver produce la misma imagen.
   - [x] Un mismo `objectId` reutilizado en dos escenas se ve idéntico (continuidad).
- **Verificación 1.3b:** `npm run typecheck`, `npm test` (347 pruebas) y `npm run build:studio` en verde. Remotion Studio y capturas PNG reales con Chrome Headless Shell/ANGLE: dos planos de `SalDelMar`, objetos compartidos, catálogo completo, rótulos y error visible de estilo desconocido; sin errores de consola tras corregir una clave React faltante. Captura de la región de vista previa idéntica en seek 60 → 90 → 60; el frame 90 difiere. Comparación visual con `ref-sal.jpg` local y criterios escritos, sin copiar su marca; la aprobación estética final queda a criterio del usuario. No se exportó MP4 ni se implementaron subtítulos.
- **Demo:** `npm run video:studio` → composición `SalDelMar` (10 s, dos planos de 5 s; comparte los mismos objetos y semillas). Revisar 2 s y 7 s y volver a 2 s. `Vertical` conserva el storyboard migrado con su pista de cámara/FOV. `sal-del-mar.json` es una escena `KitScene`, no un proyecto completo. En `follow`, `from`/`to` son offsets del sujeto; `orbit` interpola el arco horizontal más corto alrededor del objetivo. Las animaciones terminadas conservan su estado final; no acumulan deltas entre frames.

### 1.4 Subtítulos palabra por palabra

- **Archivos:** `src/shared/voice/estimate.ts` + test (TDD), `src/video/captions/Captions.tsx`, `src/video/fonts.ts`.
- **Hacer:**
  - `estimateWords(text, durationMs)`: reparte la duración según largo de palabra y pausa tras puntuación; cumple `LIMITS`.
  - Si la escena no tiene `words`, usar las estimadas.
  - Estilo «karaoke» de las referencias: frase corta de 2–5 palabras en el tercio superior; palabras inactivas en gris translúcido, palabra activa en blanco y negrita (`highlightColor`); `emphasis` con recuadro. Respetar `anchor` y `safeMarginPx`. Se puede apoyar en `createTikTokStyleCaptions` de `@remotion/captions`.
  - Fuente cargada con `@remotion/fonts` + `delayRender` (importar el archivo como módulo, no `staticFile`).
- **Aceptación:**
   - [x] Subtítulos legibles y dentro del margen seguro.
   - [x] Una palabra larga hace salto de línea; nunca se corta.
- **Verificación 1.4:** TDD rojo/verde de estimación y paginado; `npm run typecheck`, `npm test` (357 pruebas) y `npm run build:studio` en verde. Chrome Headless Shell/ANGLE real, no Lightpanda: fuente local cargada, tres anclajes, margen de 240 px, palabra larga en varias líneas, énfasis con recuadro y cinco palabras de 80 caracteres sin recorte. Captura idéntica al volver de frame 100 a 60; el frame 100 cambia la palabra activa. Subtítulos deshabilitados no aparecen; Remotion Studio y captura PNG de `SalDelMar` conservan el kit 3D. Sin errores de consola en la comprobación de navegador. No se exportó MP4.
- **Decisiones 1.4:** las palabras existentes tienen prioridad y conservan tiempos/énfasis; solo se estiman si `words` está vacío. Estimación pura con pausa proporcional tras puntuación; errores explícitos ante duración, texto o cantidad fuera de `LIMITS`, o palabras de más de 80 caracteres (límite vigente de `Word.text`), sin truncar narración. Frases de 2–5 palabras, salvo narración de una palabra; durante pausas no se destaca ninguna. Se respetan colores/tamaño del proyecto; `SalDelMar` usa 52 px y activo blanco como referencia. Frases excepcionalmente densas reducen tamaño para caber, sin ocultar contenido. `loadFont()` de `@remotion/fonts` gestiona internamente `delayRender`/`continueRender`; el TTF se importa como módulo. Sin cambios de schema ni dependencias.
- **Demo:** `npm run video:studio` → `SalDelMar`; revisar 0–5 s y 5–10 s. `Vertical` usa sus palabras guardadas y colores del storyboard. Son subtítulos estimados sin voz; sincronía con audio corresponde a Fase 4.

### 1.5 Render por línea de comandos

- **Archivos:** `src/companion/render/render-service.ts`, `scripts/render-project.ts`, `tests/integration/render.test.ts`.
- **Hacer:** `bundle()` una vez (cache en memoria), `selectComposition`, `renderMedia({ codec: 'h264', inputProps, chromiumOptions: { gl: 'angle' }, onProgress })`. Escribir en temporal y publicar atómicamente sin reemplazo en `<workspace>/.renders/<projectId>/<revision>-<yyyyMMdd-HHmmss>.mp4`. El store ignora carpetas con punto, así que `.renders/` no aparece como proyecto (cubrirlo con un test).
- **Script:** `npm run render -- <ruta/project.json> [salida.mp4]`.
- **Test real:** renderizar 2 s de un fixture mínimo y comprobar 1080×1920, 30 fps y duración ±1 frame (`npx remotion ffprobe` o `@remotion/media-parser`).
- **Hito 🎬:**
   - [x] Existe el primer MP4 del ejemplo storyboard.
   - [x] Se ve el 3D y los subtítulos.
- **Verificación 1.5:** exportación real del storyboard original (v1 migrado en memoria, sin modificarlo) a `workspace/.renders/project_rocks/3-20261105-180000.mp4`. `ffprobe` confirma H.264, yuv420p, 1080×1920, 30 fps, 12 s y 360 frames, sin pista de audio. Inspección visual de frames extraídos del MP4 a 1 s y 7 s: personajes/objetos 3D, capas, rótulo y subtítulos visibles. Chrome Headless Shell con ANGLE; no Lightpanda. El archivo generado y las capturas no se incluyen en Git. No implica aprobación estética humana.
- **Pruebas 1.5:** TDD rojo inicial por módulo ausente; pruebas de cache/props, revisión guardada sin modificar, publicación/limpieza, exclusión mutua, salidas existentes/enlaces/extensión, errores del CLI y `.renders` ignorado por el store. Test real del CLI con fixture mínimo de 2 s y metadatos H.264, 1080×1920, 30 fps, duración y frames ±1. `npm test`: 364/364 en verde, sin omitidas; conserva esa prueba real en la suite completa. `npm run typecheck` y `npm run build:studio` en verde.
- **Decisiones 1.5:** bundle cacheado en memoria del servicio único y una exportación a la vez; `concurrency: 1` por prudencia con WebGL. Se reutiliza el parser del store sin adquirir su bloqueo de escritura ni importar/modificar el documento. Solo modo `silent`; `withVoice` falla explícitamente hasta Fase 4. Nombre por defecto en UTC; si la salida ya existe, se rechaza. Temporal privado junto al destino y publicación mediante enlace físico atómico sin reemplazo, con limpieza del temporal al terminar. Directorios de salida con enlaces simbólicos se rechazan. Context7 sin cuota; APIs contrastadas con documentación oficial y tipos instalados. Sin dependencias ni cambios de schema.
- **Correcciones de revisión Fase 1:** TDD reproduce dos servicios independientes que sobrescribían el mismo destino mediante comprobación previa y rename. La publicación con enlace físico permite un solo ganador y conserva sus bytes al limpiar ambos temporales; el servicio perdedor puede reintentarlo con otro nombre. La estimación cuenta puntos de código como el schema, no unidades UTF-16: regresiones con narración válida de 50 emojis, palabras de 80/81 y escenas de 2000/2001 puntos de código. Cuatro pruebas nuevas fallan antes de las correcciones y pasan después. `npm test`: 368/368, sin omitidas, incluido el render real de 2 s; `npm run typecheck` y `npm run build:studio` en verde. Sin colas, bloqueos nuevos, dependencias ni cambios de schema.
- **Demo:** `npm run render -- workspace/<projectId>/project.json` produce `workspace/.renders/<projectId>/<revision>-<yyyyMMdd-HHmmss>.mp4`; el workspace se deduce como padre de la carpeta del documento. Para el storyboard externo, usar `npm run render -- docs/plan/examples/storyboard-project.json workspace/storyboard.mp4` (nombre nuevo). Abrir el MP4 y revisar ambos planos; no hay voz. Persiste un aviso no bloqueante de Three.js sobre `THREE.Clock`.

---

## Fase 2 — Vista previa y exportar en el estudio

### 2.1 Activos para la vista previa

- **Hacer:** ruta `GET /api/projects/:id/assets/:assetId` (misma autenticación; solo activos del manifest; nunca rutas de archivo). En `api.ts`: `fetchAssetBlobUrl()`. Revocar los blob URLs al desmontar.
- **Aceptación:**
   - [x] Test de integración: sin token → 401; activo inexistente → 404.
   - [x] Los bytes devueltos coinciden con el `sha256` del manifest.
- **Verificación 2.1:** dos pruebas nuevas de integración fallaron primero con 405 (GET aún no implementado). `npm test`: 373/373 en verde, sin omitidas, incluido el render real de 2 s; `npm run typecheck` y `npm run build:studio` en verde. Disco real: bytes/hash del manifest, autenticación, Origin/Host, archivo ausente, activo no declarado, traversal, enlaces de archivo/directorio/proyecto y respuestas sin rutas externas. GET no modifica el documento; bytes alterados (hash o longitud) producen 409, sin sustitución silenciosa.
- **Decisiones 2.1:** `ProjectStore.readAsset()` reutiliza el parser y las comprobaciones de rutas existentes; solo devuelve bytes de activos declarados. Respuesta con MIME del manifest, longitud, `no-store` y `nosniff`; token solo en cabecera. `fetchAssetBlobUrl()` devuelve `{ url, revoke }` y acepta `AbortSignal`: el consumidor debe abortar peticiones pendientes y llamar a `revoke()` al reemplazar/desmontar; la revocación es idempotente y una cancelación evita URLs tardías. Tres pruebas unitarias verifican esa estrategia. Todavía no hay consumidor montado: su limpieza React y los permisos CSP de reproducción se conectan en 2.2, no se afirma que exista una vista previa. Sin dependencias ni cambios de schema.
- **Demo:** `npm start`, abrir un proyecto con un activo restaurado mediante «Revincular» y consultar `GET /api/projects/<projectId>/assets/<assetId>` desde el mismo origen con el token de la etiqueta meta en la cabecera `Authorization: Bearer …`. Devuelve bytes del medio (no JSON ni ruta local); omitir la cabecera devuelve 401 y usar un ID de activo no declarado devuelve 404. La verificación automatizada compara SHA-256 con el manifest. No reproduce audio/video todavía.

### 2.2 `PreviewPlayer`

- **Hacer:** `<Player component={VerticalVideo} inputProps={projectToVideoProps(draft, blobUrls)} … controls />` en un panel 9:16 junto a la lista de escenas. Muestra el **borrador**, incluidos los cambios sin guardar. Clic en una escena → `seekTo` a su inicio.
- **Aceptación:**
   - [x] Editar el texto de una escena actualiza la vista previa sin guardar.
   - [x] Play, pausa y seek funcionan.
- **Verificación 2.2:** `npm run typecheck`, `npm test` (377/377, sin omitidas, incluido el render real de 2 s), `npm run build:studio` y suite E2E completa (27/27, sin omitidas) en verde. Chromium/ANGLE real: 3D no negro y karaoke editado visibles en capturas inspeccionadas de escritorio y móvil; relación 9:16, controles accionables, play/pausa, scrub por puntero y clic repetido en escena. Cambiar duración sin guardar mueve el inicio de la segunda escena de 6 s a 3 s; los bytes del documento permanecen intactos. Un texto intermedio fuera del límite de palabra muestra estado recuperable; corregirlo restaura la vista previa. Sin errores de consola, CSP ni recursos en las pruebas nuevas.
- **Decisiones 2.2:** panel junto al storyboard con `VerticalVideo` y props del borrador. Solo la vista previa estima palabras cuando el texto normalizado ya no coincide con la alineación guardada; no cambia palabras persistidas ni bindings. Cambios de texto no vuelven a descargar activos; cambio de revisión/manifest y desmontaje cancelan peticiones y revocan URLs. Pruebas unitarias y React/navegador cubren blobs resueltos, pendientes, tardíos y errores parciales. Solo medios referenciados y declarados; los faltantes no se solicitan. CSP conserva scripts/conexiones locales, añade `media-src 'self' blob:` y permite únicamente el hash exacto del CSS scoped de la versión fijada del Player, sin `unsafe-inline` ni `unsafe-eval`; se sirve TTF local con MIME explícito. Sin tags de audio compartido ni voz en la composición: audio corresponde a Fase 4. Context7 sin cuota; API contrastada con documentación oficial y tipos instalados.
- **Navegador 2.2:** la prueba histórica que importa el storyboard ahora monta WebGL y se ejecuta explícitamente en Chromium; Lightpanda fallaba al crear el contexto. Las pruebas DOM restantes conservan Lightpanda. Procesos/perfiles/puertos propios, interceptación de red externa conservada y sin tocar el Remotion Studio del usuario. Avisos no bloqueantes: tamaño del bundle del editor y deprecación `THREE.Clock`.
- **Demo:** `npm start` → importar `docs/plan/examples/storyboard-project.json` → editar «Texto» sin guardar y mirar el karaoke. Los botones numerados de escena buscan su inicio usando las duraciones actuales, incluso al pulsar otra vez la misma escena. Probar play, pausa y barra inferior; en móvil el panel se apila sin desborde horizontal. Vista previa silenciosa; todavía no hay botón Exportar ni UI de guion/voz.

### 2.3 Exportar desde la UI

- **Hacer:**
  - Rutas `renders` y `render-assets` (ver tabla). El render lee el `project.json` **guardado** (ADR-06).
  - `ExportPanel.tsx`: deshabilitado con cambios sin guardar («Guarda antes de exportar»); progreso por polling cada 1 s; al terminar muestra la ruta y «Descargar».
- **Aceptación:**
   - [x] Exportar desde la UI produce el mismo video que el CLI.
   - [x] Un segundo clic durante un render muestra «Ya hay una exportación en curso».
   - [x] Cerrar la pestaña no corta el render.
- **Verificación 2.3:** TDD inicial: la ruta nueva devuelve 404 antes de implementarla. `npm test`: 380/380, sin omitidas, incluido el render CLI real de 2 s; `npm run typecheck`, `npm run build:studio` y E2E completa (28/28, sin omitidas) en verde. Integración con disco real y renderer falso: revisión incorrecta, autenticación, Origin/Host, admisión simultánea, exclusión entre proyectos, progreso, archivo no disponible, descarga, salida sustituida por enlace, errores sin token y liberación del render. Los activos temporales cubren manifest, bytes alterados, enlace simbólico, token distinto por render y caducidad tanto al fallar como al completar. Una edición externa durante el bundle no cambia el documento guardado ya aceptado ni se sobrescribe.
- **Navegador 2.3:** Chromium real/ANGLE exporta un kit con 3D y karaoke de 2 s desde la UI. Descarga con bytes idénticos al archivo publicado; UI y CLI coinciden en H.264, 1080×1920, 30 fps, 60 frames y 2 s sin audio, y en el PNG decodificado a 1 s. Capturas del panel terminado y del frame inspeccionadas: ruta/descarga, terreno, agua, objetos, rótulos y subtítulos visibles. Otro render termina después de cerrar la pestaña; se verifica por la API y sus metadatos. Sin errores de consola, CSP ni recursos en esa prueba. Se conservan Lightpanda para DOM y Chromium para render/visual; no se modifica el Studio del usuario. No implica aprobación estética humana.
- **Decisiones 2.3:** `ProjectStore` lee y valida la revisión guardada una vez; ese objeto en memoria se pasa al servicio existente para evitar la carrera entre comprobar revisión y releer disco. No hay snapshots persistentes, journal ni cola. Admisión única por proceso, bundle cacheado y progreso por polling secuencial cada 1 s; cerrar el panel detiene consultas, no el trabajo. `approval` no bloquea. Token aleatorio de 256 bits por render, manifest fijado, `no-store`, solo GET, revocado al terminar; `render-assets` conserva Host estricto y usa esa capacidad en lugar del bearer/Origin de `/api`, porque el bundle de Remotion tiene otro origen loopback. CORS sin credenciales solo en esa ruta. Los errores del renderer se muestran sin diagnóstico crudo que pueda contener URLs secretas. Descarga autenticada mediante blob, nunca token del companion en URL. Sin cambios de schema ni dependencias. Context7 sin cuota; documentación oficial y tipos instalados consultados.
- **Límites y demo 2.3:** `npm start` → importar storyboard → guardar cambios → «Exportar MP4» → progreso → ruta y «Descargar». Sin guardar, «Guarda antes de exportar» está deshabilitado. Otro clic activo muestra «Ya hay una exportación en curso». Se exporta sin voz; audio sigue en 4.5. El archivo queda en `.renders`; cerrar la pestaña no lo cancela, pero reiniciar el companion pierde los estados/IDs y no se recupera automáticamente la UI al reabrir. Los avisos conocidos de tamaño del bundle y `THREE.Clock` no bloquean.
- **Corrección de revisión Fase 2:** guardar y reabrir una narración editada conservaba las palabras anteriores; solo la vista previa las estimaba de nuevo y el MP4 mostraba el texto viejo. La selección derivada ahora reside en `projectToVideoProps`, compartida por vista previa, UI y CLI: conserva tiempos/énfasis cuando el texto coincide tras normalizar espacios; estima cuando está vacío o desactualizado y los subtítulos están habilitados. No modifica palabras, audio ni bindings persistidos. Sustituye la política exclusiva de vista previa de 2.2 y acota la prioridad de palabras descrita en 1.4 a las que coinciden con la narración. TDD rojo/verde con guardado/reapertura real y regresiones de Unicode/puntuación; `npm test`: 383/383, typecheck, build y E2E: 28/28, sin omitidas. Chromium/ANGLE: editar → guardar → reabrir → exportar; PNG decodificado a 1 s idéntico entre UI, CLI y una referencia independiente con palabras vacías y texto nuevo. Se conserva la exportación silenciosa y el trabajo termina aquí.

---

## Fase 3 — Guion con modo dual

### 3.1 Contrato `ScriptProposal` y prompt — TDD

- **Archivos:** `src/shared/script/schema.ts`, `src/shared/script/prompt.ts` + tests.
La generación va en **dos etapas** con modo dual cada una: **Guion** (texto y descripción visual, aquí) y **Dibujo** (escena `kit` por escena, paso 3.3). Así cada respuesta es pequeña, se revisa por partes y una escena se puede redibujar sin rehacer el guion.

- **Contrato:** `{ title, sources: [{ title, url }], scenes: [{ title, narration, visualIntent, seconds }], cover: { headline }, postText }`.
  - Límites desde `LIMITS`: 1–12 escenas, 1–15 s por escena, total ≤ 60 s, narración ≤ 2000 caracteres.
  - JSON Schema **estricto** (todas las propiedades `required`, `additionalProperties: false`): lo exige `--output-schema`.
  - `sources`, `cover` y `postText` se guardan como metadatos del proyecto en schema 2 (sin consumir en el render todavía).
- **Prompt:** `buildScriptPrompt({ idea, styleId, locale, targetSeconds })` aplica la fórmula de las [referencias](docs/ux/references/README.md): pregunta reconocible en 3 s como gancho, explicación simple con fuentes, cierre para compartir; escenas de 2–5 s; ritmo aproximado de 2,5 palabras/s en español; `visualIntent` concreto y dibujable; «responder solo JSON válido según este schema» con el schema literal.
- **Aceptación:** [x] prompt determinista, con fórmula y schema incluidos.
- **Extensión aprobada 3.1:** autorización explícita del usuario para `sources`, `cover` y `postText`. Son campos raíz opcionales en schema 2: los documentos existentes no reciben valores por defecto ni cambian de versión o digest. Si están presentes se validan estrictamente: hasta 12 fuentes `{ title, url }`, título y portada de 1–120 caracteres, URL de hasta 2048 caracteres y post de hasta 4000. Solo URLs HTTP(S) absolutas sin espacios ni credenciales; nunca se descargan. La excepción es de referencias editoriales, no del kit: sus visuales siguen sin URLs. Schema 1 no admite estos campos nuevos.
- **Decisiones 3.1:** serialización explícita y estable de metadatos, preservados por guardar/reabrir/importar/copiar y por snapshots del editor. El digest de contenido ya incluye los campos raíz editoriales: editar cualquiera invalida la aprobación histórica sin cambiar los digests de medios. El contrato de salida exige todos los campos, aunque el proyecto los haga opcionales por compatibilidad. El JSON Schema describe la suma ≤ 60 s y el máximo de texto total; JSON Schema no expresa sumas entre elementos. La comprobación ejecutable de esas sumas queda en el parser de 3.2, no se afirma validación de propuestas todavía.
- **Verificación 3.1:** TDD rojo inicial por módulo ausente, rechazo de metadatos y pérdida al serializar; 9 pruebas nuevas cubren contrato cerrado, prompt determinista, límites, compatibilidad, Unicode, rechazo de URLs inseguras, digests y persistencia con disco real. `npm test`: 392/392, sin omitidas, incluido el render real de 2 s; `npm run typecheck`, `npm run build:studio` y E2E completas: 28/28, sin omitidas. La suite existente conserva Lightpanda para DOM y Chromium/ANGLE para vista previa/exportación; no hay UI nueva en este paso. Demo del prompt ejecutada localmente. Sin dependencias, procesos de proveedores ni consultas de fuentes. Se conservan los avisos conocidos de tamaño del bundle y `THREE.Clock`.
- **Demo 3.1:** `node --input-type=module -e "import {buildScriptPrompt} from './src/shared/script/prompt.ts'; console.log(buildScriptPrompt({idea:'¿De dónde sale la sal del mar?',styleId:'stylized-3d',locale:'es',targetSeconds:30}))"` muestra el prompt completo y su schema literal. No invoca proveedores ni consulta URLs. Todavía no hay parser, aplicación al borrador, dibujo ni UI de guion (3.2–3.5).

### 3.2 Parseo y validación — TDD

- **Archivos:** `src/shared/script/parse.ts` + test.
- **Hacer:** `parseScriptResponse(text)` tolerante: quita bloques de código, toma el primer objeto JSON, valida contra el contrato. Devuelve `{ ok: true, proposal }` o `{ ok: false, errors }` con mensajes en español para la UI. Nunca recorta valores en silencio.
- **Aceptación:** [x] casos: válido, con bloque de código, con texto antes y después, campo faltante, demasiadas escenas, total > 60 s.
- **Decisiones 3.2:** se extrae el primer objeto balanceado, respetando comillas y escapes; los delimitadores de bloque y la prosa exteriores se descartan sin alterar las cadenas. Si ese objeto es inválido, no se busca otro posterior. Se reutiliza el decodificador JSON estricto del proyecto, ahora expuesto como `parseBoundedJsonText`, sin cambiar la selección de versión ni migración. Se conserva el rechazo de claves duplicadas/peligrosas (incluso escapadas), profundidad > 16 y respuestas completas de más de 2 MiB en UTF-8. Validación dirigida por el contrato cerrado de 3.1, más sumas de duración/narración y URLs HTTP(S) absolutas sin credenciales ni espacios. Conteo por puntos de código Unicode y suma compensada para evitar falsos rechazos por acumulación decimal en 60 s; no se redondean ni recortan los valores de la propuesta. Errores en español sin repetir el contenido crudo de la respuesta.
- **Verificación 3.2:** TDD rojo inicial por módulo ausente; regresión adicional roja/verde de seis duraciones decimales que suman 60 s. Trece pruebas nuevas cubren aceptación, contrato anidado completo, límites de textos/metadatos, escapes, claves hostiles, bytes y profundidad. `npm test`: 405/405, sin omitidas, incluido el render CLI real de 2 s; `npm run typecheck` y `npm run build:studio` en verde. E2E no ejecutadas de nuevo: no hay UI ni rutas nuevas. Sin cambios de schema, dependencias, proveedores, aplicación al borrador ni dibujo. Se conserva el aviso conocido de tamaño del bundle.
- **Demo 3.2:** `node --test tests/unit/script-parse.test.ts` verifica localmente propuestas con y sin bloques/prosa y muestra los casos de rechazo. `parseScriptResponse(text)` devuelve `{ ok: true, proposal }` o `{ ok: false, errors }`; aún no existe un consumidor en la UI. Aplicación y dibujo corresponden a 3.3.

### 3.3 `applyScriptProposal` y Dibujo de escenas — TDD

- **Archivos:** `src/shared/script/apply.ts`, `src/shared/kit/{prompt,parse,apply}.ts` + tests.
- **`applyScriptProposal`:** reemplaza escenas (IDs nuevos), `text = narration`, `visualIntent`, duración redondeada a 100 ms, `startMs` contiguo, `output.durationMs` = suma, `visual: null`, `audio: null`, `words: []`, bindings vacíos.
- **Aplicación de guion 3.3:** operación pura sobre el borrador; recibe un tercer argumento `sceneIds: readonly string[]` con un ID nuevo y único por escena (la UI puede asignarlos con su `newSceneId()` existente). Las escenas nacen en revisión 0; revisión y fechas del proyecto quedan a cargo del guardado. Revalida la propuesta y el proyecto editable, reemplaza título/metadatos editoriales y conserva identidad, ajustes, activos, entidades y aprobación histórica. Redondea cada duración por separado a 100 ms; si la suma redondeada supera 60 s, rechaza sin cambiar entradas ni recortar tiempos. El proyecto resultante se valida completo.
- **Dibujo (`kit`):** `buildKitPrompt({ scene, previousScenes, references })` pide **una** `KitScene` por escena, con el catálogo del kit (tipos, parámetros, animaciones, movimientos de cámara) y el schema literal. `parseKitResponse` reutiliza la lógica tolerante de 3.2 y el validador de 1.3a. `applyKitScene(project, sceneId, kit)` asigna `visual`.
  - Continuidad: el prompt recibe los objetos ya usados; reutilizar `objectId` cuando el sujeto se repite.
  - Modo dual como el guion: «Copiar prompt de dibujo» / «Pegar escena» en manual, y `codex exec` con el schema de `KitScene` en automático (mismo adaptador de 3.5). «Dibujar todas» o «Redibujar esta escena».
- **Aceptación:**
   - [x] El proyecto resultante pasa `validateProject` en ambas etapas.
   - [x] Un JSON de escena inválido muestra errores y no toca el borrador.
   - [x] Redibujar una escena no cambia las demás.
- **Dibujo 3.3:** `buildKitPrompt` recibe la escena, las escenas previas y las fuentes editoriales; incluye el catálogo completo, los objetos previos con identidad/semilla y el schema literal compacto `KIT_SCENE_SCHEMA` de `src/shared/kit/output-schema.ts`. Pide una sola escena, estética low-poly, cámara suave, rótulos y continuidad por ID. El contrato de salida representa los campos históricos opcionales mediante variantes de presencia `anyOf` cerradas: cada objeto declara todas sus propiedades como obligatorias, sin añadir `null` ni cambiar el schema persistido. Comparte `$defs` para evitar repetir restricciones. Las relaciones entre campos (IDs, referencias, identidad histórica, tiempos, vectores unitarios) siguen verificándose con `validateKitScene`; no se atribuyen a JSON Schema comprobaciones que no expresa.
- **Fronteras 3.3:** guion y dibujo comparten `parseResponseObject` en `src/shared/response-json.ts`, extraído de 3.2 sin cambiar sus límites ni su selección del primer objeto. `parseKitResponse(text, { durationMs?, entities? })` devuelve `{ ok: true, scene }` o `{ ok: false, errors }` en español y reutiliza el validador existente. `applyKitScene` siempre comprueba duración y entidades del proyecto destino, valida el proyecto completo y cambia únicamente el visual y la revisión de la escena elegida (+1, igual que el editor). No cambia narración, audio, palabras, bindings, aprobación histórica, fechas ni revisión del proyecto. Ninguna operación guarda ni muta sus entradas.
- **Verificación 3.3:** TDD rojo inicial por módulos ausentes; 14 pruebas nuevas cubren aplicación, IDs explícitos, redondeo y límite agregado, aislamiento del redibujo, referencias históricas, tiempos, entradas inválidas y límites JSON. El contrato de salida se comprueba con un evaluador de pruebas independiente para su vocabulario, cobertura del catálogo y variantes históricas; todas las ramas están cerradas y dentro de los límites documentados de Structured Outputs. `npm test`: 419/419, sin omitidas, incluido el render CLI real de 2 s; `npm run typecheck` y `npm run build:studio` en verde. E2E no ejecutadas de nuevo: no cambian UI, rutas ni renderer. Context7 sin cuota; restricciones del schema contrastadas con la [documentación oficial de OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs). Sin dependencias, cambios del contrato persistido ni llamadas a proveedores; aceptación efectiva de Codex queda para 3.5. Se conserva el aviso conocido de tamaño del bundle.
- **Demo y alcance 3.3:** `node --test tests/unit/script-apply.test.ts tests/unit/kit-drawing.test.ts tests/unit/kit-output-schema.test.ts` recorre guion → borrador válido → dibujo → redibujo aislado. Para ver el resultado en el estudio, serializar el borrador aplicado e importarlo con la función existente; la vista previa ya estima sus subtítulos. Se entregan mecanismos puros comunes a manual/automático y a dibujar todas/redibujar una; los botones y confirmaciones corresponden a 3.4 y el adaptador Codex a 3.5, no se adelanta UI ni ejecución de proveedores. Dos unidades de commit: aplicación de guion y flujo completo de dibujo con contrato/pruebas; se mantiene este último unido por coherencia, no por tipo de archivo.

### 3.4 Modo manual en el estudio

- **Archivos:** `studio/src/components/ScriptStep.tsx`.
- **Hacer:** duración objetivo (15/30/45/60 s) → «Copiar prompt» → área «Pegar respuesta» → «Revisar» (lista de escenas o errores) → «Aplicar al borrador». Si ya hay escenas, confirmar «Reemplazar N escenas». Aplicar no guarda.
- **Aceptación:** [ ] pegar en ChatGPT web el prompt de guion y luego los de dibujo produce escenas 3D con subtítulos estimados en la vista previa.
- **Implementación 3.4:** `ScriptStep` ofrece duración objetivo 15/30/45/60 s, copia del prompt, pegado, revisión de escenas/metadatos/fuentes y aplicación explícita. Si hay escenas, pide «Reemplazar N escenas» e informa que se reemplazan dibujos y vínculos de voz. Cada tarjeta ofrece «Dibujar esta escena» / «Redibujar esta escena», prompt con los objetos de escenas anteriores, pegado de un kit, revisión y aplicación aislada. Ambas etapas reutilizan los parsers y funciones `apply` de 3.2–3.3; IDs nuevos mediante `newSceneId()`. Solo actualizan el borrador y la vista previa; Guardar sigue siendo explícito. No se adelantan Auto, Codex, voz ni servicios.
- **Verificación 3.4:** `npm test`: 419/419, sin omitidas, incluido el render CLI real de 2 s; typecheck, build y E2E completas: 31/31, sin omitidas. Tres E2E nuevas recorren la aplicación real: copiar prompt con frontera de portapapeles controlada, revisión sin cambios, JSON inválido sin mutación, cancelación/aceptación de reemplazo, IDs nuevos, dos dibujos, continuidad completa de objetos en el segundo prompt, invalidación de una revisión al editar la respuesta, redibujo aislado y guardar/reabrir. Cubren también error de aplicación por redondeo, copia alternativa cuando se deniega el portapapeles y controles deshabilitados en proyectos de solo lectura. Los bytes del documento permanecen intactos hasta Guardar. Chromium/ANGLE real y capturas inspeccionadas de escritorio/móvil: paisaje 3D, rótulos y subtítulos estimados visibles; controles accionables sin desborde horizontal, sin errores de consola/CSP/recursos. Lightpanda conserva el caso nuevo de solo lectura y las pruebas DOM anteriores.
- **Alcance de la aceptación:** [x] recorrido manual completo con respuestas externas **emuladas mediante fixtures locales**, sustituto autorizado para comprobar la UI sin autenticación ni gasto. **No se pegó en ChatGPT web ni se verificó una respuesta real de un proveedor**; la casilla de aceptación literal de arriba queda pendiente de esa comprobación humana. Esto no bloquea la entrega de la UI del paso. Sin dependencias ni cambios de schema. Context7 sin cuota; se reutilizan patrones React existentes. Avisos conocidos no bloqueantes: tamaño del bundle y deprecación `THREE.Clock`.
- **Demo 3.4:** `npm start` → crear/abrir proyecto → escribir Idea → «Guion manual» → duración → «Copiar prompt» → herramienta externa → «Pegar respuesta» → «Revisar» → «Aplicar al borrador» → confirmar reemplazo si corresponde. En cada tarjeta, abrir «Dibujar esta escena», copiar su prompt, pegar el JSON `KitScene`, revisar y aplicar; hacerlo en orden para ofrecer continuidad al siguiente prompt. La vista previa muestra el borrador con 3D y karaoke, sin voz; «Guardar» persiste. Demo automatizada sin proveedor: `node --test tests/e2e/manual-script.e2e.ts` después de `npm run build:studio`.

### 3.5 Modo automático con Codex CLI

- **Archivos:** `src/companion/providers/{capabilities,codex-cli}.ts`, rutas `capabilities` y `script/generate`, test con ejecutable falso.
- **Hacer:**
  - `capabilities`: `spawn('codex', ['--version'])` con timeout de 5 s, sin shell; presencia de `VIBI_API_KEY`.
  - `codex-cli`: escribir el schema en un directorio temporal y ejecutar `codex exec --skip-git-repo-check --sandbox read-only --output-schema <schema> -o <salida> -` con el prompt por stdin, `cwd` = directorio temporal, `shell: false`, timeout de 180 s. Leer `<salida>` → `parseScriptResponse`. **Confirmar los flags con `codex exec --help`** de la versión instalada.
  - Errores claros: Codex no instalado (indicar instalación y `codex login`), timeout, salida inválida (mostrar el texto y ofrecer modo manual).
  - `ScriptStep`: selector Auto/Manual; Auto deshabilitado con el motivo si no hay capacidad.
- **Test:** un `codex` falso en `PATH` (script en `tests/helpers/`) que escribe un JSON fijo. Sin llamadas reales en tests.
- **Hito:**
  - [ ] Idea → guion y dibujo automáticos → vista previa → MP4 silencioso.
- **Adaptador 3.5:** se verificaron `codex --version` (`codex-cli 0.166.0`) y `codex exec --help` antes de implementar: admite los flags requeridos y `--ephemeral`, usado para no conservar la sesión generada. `capabilities` prueba disponibilidad con `--version` (5 s), no autenticación ni créditos; Vibi solo informa un booleano de configuración. Guion y dibujo usan el mismo ejecutor sin shell, prompt por stdin, directorio temporal privado, sandbox `read-only` y límite de 180 s. Se reutilizan sin transformar `SCRIPT_PROPOSAL_SCHEMA`, `KIT_SCENE_SCHEMA` y los parsers compartidos. Lectura regular sin enlaces, UTF-8 estricto y máximo de 2 MiB; limpieza del temporal tanto en éxito como en error. Timeout, desconexión y cierre detienen el grupo de procesos. El cierre impide nuevas generaciones.
- **Frontera 3.5:** `POST /api/drawing/generate` recibe `{ project, sceneId }` para dibujar el borrador **no guardado**, validado completo y editable, con continuidad de las escenas anteriores. No acepta prompts, schemas, rutas ni opciones de proceso arbitrarias; devuelve una sola `KitScene`, sin guardar. Las tres rutas nuevas conservan token y Origin/Host. Errores accionables sin stderr crudo; texto inválido limitado a 16 000 caracteres y secretos conocidos ocultos. Las respuestas que contienen secretos detectados se rechazan, nunca se reparan silenciosamente. El proceso no hereda variables con nombres de claves/tokens/secretos ni `VIBI_*`, para no exponer credenciales ajenas ni seleccionar cobro API mediante claves heredadas. La autenticación sigue siendo la sesión local de Codex; su configuración y límites de uso son responsabilidad del usuario.
- **Contrato y documentación 3.5:** Context7 sin cuota; flags y forma de ejecución contrastados con ayuda instalada y [documentación oficial de Codex](https://developers.openai.com/codex/non-interactive-mode). El ejecutable falso en PATH verifica ramas estrictas/cerradas y que su salida cumpla el schema original; una prueba independiente confirma que rechaza un schema no estricto. Esto verifica la integración, **no la aceptación real de esos schemas por el servicio de Codex**. Sin instalaciones, dependencias nuevas, cambios de schema persistido, inicio de sesión ni generación con proveedor real.
- **UI 3.5:** guion y dibujo por escena ofrecen selector Manual/Auto, con Auto deshabilitado y motivo cuando falta capacidad. Se conserva Manual como valor inicial y la revisión/aplicación explícita de ambas etapas; guion reemplazado conserva la confirmación con cantidad de escenas. Auto muestra espera y errores accionables, permite revisar el texto inválido y volver a Manual. «Dibujar todas con Codex» procesa secuencialmente, aplica cada dibujo al borrador y lo incluye en la continuidad del siguiente; un fallo conserva los dibujos aceptados y muestra el error. No guarda. El redibujo sigue aislado y no cambia narración ni vínculos. Un borrador cambiado durante la espera no puede ser sobrescrito por un resultado anterior; desmontar/cambiar modo aborta la petición pendiente.
- **Verificación 3.5:** `npm test`: 425/425, sin omitidas, incluido el render CLI real de 2 s; `npm run typecheck`, `npm run build:studio` y E2E completas: 34/34, sin omitidas. Seis tests nuevos de integración cubren ejecutable falso en PATH, flags/cwd/stdin, schemas estrictos originales, continuidad, no guardado, capacidad ausente/fallida/timeout, errores de login/salida inválida/UTF-8/tamaño, ocultación de secretos, token/Origin/Host, cancelación y cierre con limpieza de temporales y descendientes. Tres E2E nuevas verifican capacidad deshabilitada, generación/revisión/aplicación, espera, errores y retorno a Manual, rechazo de resultados obsoletos y fallo parcial de «Dibujar todas». El resto de pruebas manuales sigue en verde. Los harnesses históricos declaran capacidad ausente mediante PATH privado, sin ejecutar el Codex instalado del usuario.
- **Hito emulado 3.5:** [x] idea → ejecutable Codex **falso** → guion y dos dibujos → vista previa Chromium/ANGLE real con roca 3D y subtítulos estimados → Guardar → MP4 **real** H.264, 1080×1920, 30 fps, 60 frames, 2 s, sin audio. Capturas de vista previa y exportación inspeccionadas; sin errores de consola/CSP/recursos en el recorrido feliz. **No se ejecutó generación real con Codex ni se consumieron créditos**; el hito literal de arriba queda pendiente de una ejecución real autorizada y no se afirma aceptación del proveedor ni aprobación estética humana. Avisos conocidos: tamaño del bundle y `THREE.Clock`.
- **Demo 3.5:** `npm start` → proyecto con Idea → «Modo de guion: Auto · Codex» → duración → «Generar con Codex» → revisar → «Aplicar al borrador» → confirmar reemplazo si corresponde → «Dibujar todas con Codex». Para un redibujo: tarjeta → «Modo de dibujo: Auto · Codex» → generar → revisar → aplicar. Guardar y «Exportar MP4». Requiere instalación e inicio de sesión previos; usa los límites de esa sesión, no garantiza disponibilidad ni gratuidad. Demo offline automatizada: `npm run build:studio` y `node --test tests/e2e/auto-script.e2e.ts`, sin proveedor real. No se adelanta Fase 4.

---

## Fase 4 — Voz con modo dual → primer video completo

### 4.1 Ingesta de audio en el store — TDD con disco real

- **Archivos:** `src/companion/store/project-store.ts` (método nuevo), `tests/integration/attach-audio.test.ts`.
- **Hacer:** `attachSceneAudio({ projectId, sceneId, bytes, mimeType, source, words, expectedRevision, expectedDigest })` en **una** transacción:
   1. Inspeccionar los bytes con el inspector existente antes de escribir. Publicar `assets/<assetId>.<ext>` desde un temporal, de forma atómica y sin reemplazar un archivo competidor (enlace físico + retirada del temporal).
  2. Añadir al manifest con `sha256` y `durationMs`.
  3. `scene.audio = { assetId, offsetMs: 0, gainDb: 0 }` y `scene.words`.
   4. **Política aprobada por el usuario:** `durationMs = max(1000, ceil((audioMs + 300) / 100) * 100)`; error si supera 15 000. Al cambiar la duración, reescalar proporcionalmente todos los tiempos visuales explícitos; conservar igualdad y orden estricto tras redondear a milisegundos enteros, y rangos válidos. Recalcular `startMs` y `output.durationMs`; rechazar una suma superior a 60 000 ms sin escribir.
  5. `output.voiceMode = 'withVoice'`.
  6. Calcular `mediaBindings` con `bindingDigests()` **después** de fijar `voiceMode` y duraciones (el digest de palabras depende de ambos).
  7. Guardar con el camino atómico existente. Si el activo anterior ya no lo usa ninguna escena, quitarlo del manifest y borrar su archivo después del commit.
- **Aceptación:**
   - [x] Revisión desactualizada → conflicto tipado (mapeo HTTP existente: 409) y nada escrito.
   - [x] Audio demasiado largo → error y nada escrito.
   - [x] Reabrir muestra bindings vigentes y pasa `validateProject`.
- **Decisiones 4.1:** una operación serializada por proyecto, con revisión y digest de disco obligatorios, comprobados antes de inspeccionar y de nuevo antes/después de publicar el activo. Se capturan bytes, palabras y procedencia al entrar para evitar mutaciones del llamador durante la espera. El documento usa el commit atómico existente; se incrementan revisión del proyecto y de la escena elegida, y se conservan metadatos editoriales y aprobación histórica. Se sustituyen los bindings de la escena elegida, incluidos `null` cuando las palabras están vacías. Al pasar de `silent` a `withVoice`, solo se ajusta el input de palabras de otra escena si sus vínculos previos de audio y palabras eran vigentes; nunca se certifica evidencia desactualizada. Ese ajuste incrementa su revisión de escena.
- **Tiempos y limpieza 4.1:** cámara/keyframes, animaciones y contadores comparten un mapa proporcional de tiempos únicos; los choques de redondeo se separan por 1 ms, reservando espacio para los tiempos posteriores. Partículas, rótulos y chevrons no tienen tiempos explícitos en `kitVersion: 1`: se conservan sus parámetros. Archivos compartidos por otras escenas permanecen en manifest y disco. El audio antiguo no compartido se retira del manifest; su archivo solo se elimina tras commit confirmado, documento aún idéntico y hash de archivo coincidente. Ante commit incierto o verificación fallida se conservan los medios potencialmente publicados; un fallo previo limpia únicamente el activo nuevo propio si el documento comprobable no lo declara. No hay journal ni promesa de atomicidad multarchivo frente a caída del proceso.
- **Verificación 4.1:** TDD rojo inicial por método ausente; regresiones adicionales rojo/verde para archivos competidores (destino y temporal) y sustitución de alineación por palabras vacías. `npm test`: 447/447, sin omitidas, incluidas 20 pruebas nuevas con disco real y el render CLI real de 2 s; typecheck y build en verde. Se cubren revisión/digest obsoletos y audio largo sin una sola escritura temporal, límites mínimo/máximo/agregado, WAV/MP3, MIME/procedencia/palabras inválidos, guardado/reapertura y bindings, reescalado al acortar/alargar, concurrencia, archivos compartidos, fallos antes/después del commit, modificaciones externas, symlinks y limpieza segura. E2E no ejecutadas de nuevo: no se modifican UI, rutas ni renderer. Sin cambios de schema, dependencias ni proveedores. Context7 sin cuota; API de archivos contrastada con documentación oficial de Node.js. Aviso conocido de tamaño del bundle no bloqueante. Se mantiene una unidad de commit coherente (store, seam de publicación, pruebas y política), sin dividir infraestructura y oráculos solo por cantidad de líneas.
- **Demo y alcance 4.1:** `node --test tests/integration/attach-audio.test.ts` recorre ingesta → guardado → reapertura sobre directorios temporales reales y comprueba manifest, bytes, tiempos y vínculos. Los medios sintéticos solo verifican el inspector de cabeceras, no reproducción. No se añade UI ni ruta de audio; escuchar desde el estudio corresponde a 4.2 y exportar con voz a 4.5. La demo sonora queda pendiente de esos pasos, no se afirma que esta entrega reproduzca voz.

### 4.2 Modo manual de voz

- **Hacer:** ruta `PUT /api/projects/:id/scenes/:sceneId/audio` (bytes WAV/MP3; cabeceras `x-expected-revision`, `x-expected-digest`, `x-asset-license`). Palabras: `estimateWords(text, audioMs)` por defecto (gratis), o alineación real con el STT de Vibi si se pide `?align=vibi` (disponible tras 4.3; muestra el costo por duración antes). `VoiceStep.tsx`: «Copiar guion de locución» (escenas numeradas), «Subir audio» por escena, estado por escena (sin voz / lista / desactualizada).
- **Regla UI:** requiere proyecto guardado; si hay cambios, pedir guardar primero.
- **Aceptación:** [x] audio externo por escena suena sincronizado en la vista previa (verificación automatizada con PCM sintético real; escucha humana pendiente).
- **Decisión de alcance aprobada 4.2:** el usuario autorizó adelantar desde 4.5 el audio por escena de la composición compartida `VerticalVideo`, sin transporte paralelo exclusivo de la vista previa. Cada `Sequence` delimita su audio; `voiceMode: 'silent'` lo excluye, `offsetMs` recorta el origen en frames y `gainDb` se convierte a amplitud sin limitar ganancias positivas. Se usa `Html5Audio` del paquete `remotion` instalado (4.0.541), con Web Audio, CORS anónimo y pausa durante buffering. La documentación actual prefiere `@remotion/media` para proyectos nuevos, pero no está instalado: se conserva la alternativa HTML5 oficialmente soportada sin añadir dependencias. Context7 sin cuota; documentación oficial y tipos instalados contrastados.
- **Frontera HTTP 4.2:** `PUT` conserva token/Origin/Host, handles de proyecto/escena, límite de 50 MiB y comprobaciones de revisión/digest. `x-asset-license` es texto del usuario codificado con `encodeURIComponent` (UTF-8), obligatorio, sin permiso predeterminado; procedencia `user` y atribución vacía. Inspección acotada antes de estimar sobre la duración real del archivo, sin incluir los 300 ms de margen. El store vuelve a inspeccionar dentro de su transacción y guarda con el mecanismo 4.1. La respuesta incluye recibo, revisión, digest y `opened` canónico refrescado; una modificación externa posterior produce conflicto, no sustitución silenciosa. `?align=vibi` devuelve 501 `alignment-unavailable`, sin red ni costo, hasta 4.3; no se simula alineación real.
- **Estimación y UI 4.2:** `estimateWords` admite ahora spans de audio desde 1 ms; el mínimo de escena del schema sigue siendo 1000 ms. Rechaza una cantidad de palabras que no permita al menos 1 ms por palabra. Narración numerada para copiar, alternativa seleccionable si falla el portapapeles, licencia explícita y carga WAV/MP3 por escena. Requiere borrador guardado, sin guardados inciertos pendientes; la ingesta bloquea edición, navegación y otras escrituras mediante el bloqueo existente. Un error o conflicto conserva el borrador. Estados `sin voz` / `lista` / `desactualizada` derivados de `bindingDigests` y recursos faltantes; editar texto no renueva vínculos históricos.
- **Vista previa y seguridad 4.2:** reutiliza descarga autenticada de activos, blob URLs y su limpieza al reemplazar/desmontar. Dos tags de audio compartido permiten reproducción y cambios de escena; la CSP permite `data:` **solo en `media-src`** para el MP3 silencioso de inicialización de Remotion. Scripts y conexiones conservan la política local anterior, sin `unsafe-inline` ni red externa. Los subtítulos manuales son estimados; no se afirma alineación fonética real.
- **Verificación 4.2:** `npm test`: 453/453, incluidas seis pruebas nuevas y el render CLI real silencioso de 2 s; typecheck y build en verde. E2E completas: 36/36, incluidas dos nuevas, sin omitidas. API con disco real: autenticación, Origin/Host, revisión/digest, concurrencia, formatos/procedencia inválidos, límite de bytes, audio largo y subsegundo, estimación no representable, ningún archivo publicado al rechazar. Política pura de audio/ganancia/offset/modo silencioso y estados de voz. Chromium/ANGLE: subida de dos WAV PCM no silenciosos generados localmente, duración decodificada de 2 s, muestras de audio no nulas en el grafo Web Audio durante reproducción, play/pausa, cambio de escena con blob identificado por SHA-256 y seek dentro del segundo audio; guardado/reapertura, detección aislada de voz desactualizada, protección del borrador sucio y conflicto con escritor externo. Un fallo real de sincronización posterior al rename produce recibo incierto: no confirma guardado ni reemplaza el borrador hasta recargar explícitamente desde disco. Capturas de escritorio/móvil/vista previa inspeccionadas; metadatos con SHA largo se envuelven sin desborde ni truncamiento. Sin errores de consola/CSP/recursos en las pruebas nuevas. No se escuchó voz humana ni se invocaron proveedores. Sin dependencias ni cambios de schema; avisos conocidos no bloqueantes de tamaño del bundle y `THREE.Clock`. Una unidad de commit coherente (ruta, UI, reproducción, oráculos y documentación), sin dividir infraestructura ni pruebas críticas por cantidad de líneas.
- **Demo 4.2:** `npm start` → crear/importar proyecto con escenas → guardar cambios → «Voz manual» → «Copiar guion de locución» → grabar/producir audio externamente → indicar licencia o permiso real → «Subir audio · escena N». La ingesta guarda y ajusta las duraciones; usar Play y los botones numerados de escena para revisar. Editar narración marca su voz desactualizada y exige guardar antes de reemplazarla. La exportación con voz sigue rechazada hasta 4.5; no hay STT/TTS de Vibi todavía.

### 4.3 Cliente Vibi y alineación por palabras — TDD

Referencia: <https://vibi.pro/docs> (página con JavaScript; abrir en navegador). Auth: cabecera `xi-api-key`. Base: `https://api.vibi.pro`. **Todo es asíncrono:** responde 202 con un ID y se consulta hasta `completed` o `failed`.

- **Archivos:** `src/companion/providers/vibi.ts`, `src/shared/voice/alignment.ts` + tests.
- **STT (alineación):** `POST /v1/speech-to-text` (multipart: `file`, `language_code` obligatorio — `es`, `timestamps_granularity=word`, `tag_audio_events=false`) → `{ task_id }`. Polling cada 2 s de `GET /v1/speech-to-text/{task_id}` hasta `status: completed`. Resultado: `result.words[]` con `{ text, start, end, type }` en **segundos**.
- **`alignment.ts`:** `sttWordsToWords(sttWords, sceneText, durationMs)` → `Word[]` en **ms** (convertir y redondear una sola vez). Usar solo `type === 'word'`; tiempos monótonos y dentro de la escena; `emphasis: false`. Usar el texto de la escena como verdad (el STT puede transcribir distinto): emparejar en orden y, si no cuadra, caer en `estimateWords` y avisar.
- **Cliente:** timeout total configurable (por defecto 120 s), sin reintentos automáticos, nunca registrar clave ni texto. `VIBI_BASE_URL` solo para tests.
- **Aceptación:**
   - [x] Test con respuesta de forma real: segundos → ms, palabras de tipo distinto descartadas.
   - [x] STT con una palabra de más o de menos cae en estimación sin romper.
   - [x] Test del cliente contra servidor HTTP falso local: 202 → pending → completed, y `failed` con `detail_error`.
- **Contrato verificado 4.3:** documentación oficial JavaScript consultada con Lightpanda, incluidos los paneles «Speech to text» y «Get transcription»; Context7 sin cuota. Se verificaron `xi-api-key`, multipart con `file`, `language_code=es`, `timestamps_granularity=word`, `tag_audio_events=false`, `202/task_id`, estados `pending`/`processing`/`completed`/`failed`, `result.words` en segundos y `detail_error`. La documentación describe consumo de créditos según duración al enviar, pero no una fórmula general de tarifa: no se infiere un precio a partir del ejemplo de respuesta. No se consultó una cuenta real.
- **Decisiones 4.3:** cliente con timeout total configurable de 120 s por defecto, polling secuencial cada 2 s y ningún reintento ni redirección. Respuestas limitadas a 2 MiB y 5000 entradas; ID de tarea acotado, sin rutas ni URLs externas. La base de producción es fija; no se lee `VIBI_BASE_URL` del entorno. La inyección explícita de pruebas solo permite HTTP en `127.0.0.1` con puerto. La cancelación corta la espera local, no garantiza cancelar una tarea ya enviada ni evitar su consumo. Errores estáticos en español, sin propagar `detail_error`, clave ni transcripción; ningún log del cliente. Se materializa el multipart acotado antes de enviarlo para evitar un rechazo asíncrono no manejado de streams al abortar `fetch(FormData)` inmediatamente en Node 26.3.0.
- **Alineación 4.3:** la narración de la escena es autoritativa; emparejamiento completo en orden, conservando su texto, puntuación y mayúsculas. Comparación NFC y sin distinguir mayúsculas, ignorando solo puntuación habitual de oración en los bordes; se conservan acentos, signos negativos, puntuación interna y prefijos como `.NET`. Solo entradas `type: 'word'`, segundos finitos, no negativos, sin solapamientos y dentro de la duración inspeccionada del audio (sin el margen de escena). Conversión y redondeo únicos a ms; `emphasis: false`. Cualquier discrepancia o intervalo no representable usa estimación completa y devuelve aviso visible. Fallos de red/proveedor no guardan ni se convierten silenciosamente en estimación.
- **Integración 4.3:** `?align=vibi` sustituye el 501 temporal de 4.2; exige además `x-vibi-consent: 1`. La capacidad es solo presencia de `VIBI_API_KEY`, nunca autenticación/saldo garantizados. En «Voz manual», la opción gratuita sigue predeterminada; Vibi requiere seleccionar archivo, ver duración decodificada aproximada, advertencia de tarifa desconocida y confirmar explícitamente envío/consumo. Elegir/cancelar archivo no llama al proveedor. Cambios de borrador invalidan la confirmación pendiente. Antes del STT se verifican permisos HTTP, revisión/digest, licencia, escena editable, duración y estimación representable; el store conserva su validación transaccional final. Una modificación externa posterior puede rechazar el guardado después de un envío ya cobrado. Respuesta con `alignment` y `warnings`, mostrados tras guardar; no se añade procedencia de alineación al schema. Sin clave, estimación gratuita disponible; fallos y desconexión conservan disco/borrador.
- **Verificación 4.3:** TDD rojo inicial por módulos ausentes y ruta 501; regresión roja/verde para no confundir `-5` con `5`. `npm test`: 460/460, sin omitidas, incluido render CLI real silencioso de 2 s; typecheck y build en verde. Siete pruebas nuevas cubren conversión, tipos descartados, palabras extra/faltantes, tiempos inválidos, multipart/autenticación real contra HTTP falso, estados, `detail_error` no expuesto, límites, respuestas/ID inválidos, 401/429, redirección rechazada, timeout total incluso con body detenido y cancelación antes/después de enviar. Integración de disco real: consentimiento, conflicto antes de gastar, capacidades sin tráfico, bindings, aviso/estimación, fallo sin escritura y desconexión durante polling sin guardar. E2E completas 37/37, sin omitidas; Chromium/ANGLE verifica decodificación local de WAV real de 2 s, confirmación/cancelación sin gasto, invalidación por edición, guardado alineado y fallback visible contra proveedor falso. Capturas de consentimiento en escritorio/móvil inspeccionadas, sin desborde horizontal ni errores de consola/CSP/recursos en la nueva prueba. Sin llamadas financieras, claves reales, dependencias ni cambios de schema. Avisos conocidos de bundle/Three.js no bloqueantes.
- **Demo y límites 4.3:** `npm start` → proyecto guardado → «Voz manual» → licencia propia → «Alineación de subtítulos: Vibi STT» → seleccionar WAV/MP3 → revisar duración y tarifa de su plan → confirmar consumo. Esta ruta real requiere configurar `VIBI_API_KEY` únicamente en el entorno del companion y autorización de gasto del usuario; **no se ejecutó contra Vibi real ni se verificó precisión fonética con voz humana**. Demo automatizada sin gasto: `node --test tests/e2e/vibi-alignment.e2e.ts` tras compilar el estudio. TTS sigue pendiente de 4.4; MP4 con voz continúa bloqueado hasta 4.5. Dos unidades revisables: cliente/alineación con sus pruebas, y conexión HTTP/UI con oráculos y documentación; no se separan pruebas críticas del comportamiento.

### 4.4 Modo automático con Vibi

- **Archivos:** `src/companion/providers/vibi.ts` (TTS), ruta `voice`, test con servidor falso.
- **Hacer:**
  - `POST /v1/text-to-speech/{voice_id}` con `{ text, language_code: 'es', provider, model_id, voice_settings }` → `{ id }`.
  - Polling de `GET /v1/history/{id}` hasta `completed`. Descargar `result.audio_url` (MP3) con la misma clave.
  - Pasar ese MP3 por el STT de 4.3 → `words`. Guardar vía `attachSceneAudio` con `source: { origin: 'provider', license: 'Vibi – según plan', attribution: '<provider>/<voice_id>' }`.
  - Configuración por env: `VIBI_API_KEY`, `VIBI_VOICE_ID`, `VIBI_PROVIDER` (por defecto `elevenlabs`), `VIBI_MODEL_ID` (por defecto `eleven_multilingual_v2`).
  - UI: confirmación con caracteres a enviar antes de gastar (TTS cobra por carácter y STT por duración; `GET` de la cuenta en «Auth» devuelve créditos disponibles); «Generar todas» secuencial con progreso; un fallo no deshace las escenas ya generadas.
- **Aceptación:** [ ] con el servidor falso: audio, palabras y bindings guardados; clave ausente en logs y en `project.json`.

### 4.5 Render con voz

- **Adelantado con autorización a 4.2:** audio por escena en `VerticalVideo`, volumen desde `gainDb`, offset y exclusión con `voiceMode: 'silent'`, verificados en la vista previa compartida.
- **Hacer pendiente:** habilitar y verificar exportación con voz por CLI y UI; conservar la frontera `render-assets` para servir los audios durante render. El guard actual del renderer todavía rechaza `withVoice`; la reproducción en vista previa no equivale a MP4 con audio.
- **Hito 🎯 primer video completo:**
  - [ ] Video de 30–45 s con 3D, voz y subtítulos sincronizados.
  - [ ] El MP4 tiene pista de audio y se escucha completo.
  - [ ] Idea sugerida que encaja con el kit inicial: «¿De dónde sale la sal del mar?».

---

## Fase 5 — Flujo guiado y pulido

| Paso | Qué | Aceptación |
|---|---|---|
| 5.1 `Stepper` | Barra superior: 1 Idea y estilo · 2 Guion · 3 Voz · 4 Vista previa y exportar. Estado por paso (pendiente / listo / desactualizado), calculado puro desde el proyecto. | Refleja el estado real tras guardar y reabrir. |
| 5.2 Voz desactualizada | Comparar `mediaBindings` guardados con `bindingDigests(project)`. Texto cambiado → «Voz desactualizada» + «Regenerar esta escena». Exportar con voz desactualizada pide confirmación. | Editar texto marca solo esa escena. |
| 5.3 Ajustes por escena | En el editor: paleta, movimiento de cámara y rótulos de la escena `kit`, más «Redibujar». Sin edición 3D libre. | El cambio se ve en la vista previa y se guarda. |
| 5.4 E2E del camino feliz | Un test: crear proyecto → aplicar guion manual fijo → subir audio de fixture → exportar → verificar metadatos del MP4. Con el harness E2E existente. | Pasa en limpio desde un workspace nuevo. |

## Fase 6 — Después del primer video

En orden sugerido; cada ítem se planifica cuando llegue su turno:

1. **Música de fondo** con ducking. Requiere `schemaVersion: 2` y migración (no hay pista global en schema 1).
2. **Segundo estilo** (tipografía cinética 2D). El registry ya lo admite; aparece deshabilitado hasta implementarse.
3. **Ampliar el kit** con los objetos que más se repitan, y luego **escenas `code`** (ADR-09) solo en local para lo que el kit no cubra.
4. **Alineación local gratuita** (Whisper local) como alternativa al STT de Vibi.
5. **Guard de revisión en `saveProject`** (hallazgo documentado en C01: `payload.revision` distinto de `expectedRevision + 1`).
6. **Endurecimiento selectivo** desde el plan anterior, solo si aparece el problema.

## Qué pasa con el plan anterior

| Plan anterior | En esta ruta |
|---|---|
| C01 contratos | Contratos pequeños por paso (`VideoProps`, `ScriptProposal`) |
| V02a–c registry/catálogo | 1.3a–1.3b (kit declarativo, schema 2) |
| V03a–c composición/overlays/transport | Remotion: 1.2–1.4 y 2.2 |
| V04a–b medios/aprobación | 4.1–4.2; snapshots y retención → backlog |
| V05a–d captura/encoder/publicación | Remotion renderer: 1.5 y 2.3 |
| V06a–d preflight/cola/watchdogs/recibos | 2.3 simplificado; resto → backlog |
| V07–V08 goldens/prueba G2 | Verificación humana + test de metadatos; goldens → backlog |
| E01a–c editor/inspector/ingesta | 5.1, 5.3, 4.1 |
| E02 invalidación | 5.2 |
| E03–E04 fakes/autorización | Fakes solo en tests; confirmación de gasto en 4.4 |
| E05 proveedor real | **Ya no es opcional:** 3.5 y 4.4 |
| E06, H01–H05 | Backlog |

## Camino a servidor (no ahora)

- Codex CLI con suscripción personal **no sirve para otros usuarios**: en servidor, usar API con clave propia y límites de costo.
- Remotion: gratis mientras sea uso individual o empresa de hasta 3 personas; con 4 o más, licencia de empresa.
- Sustituir token loopback por autenticación real; workspace por almacenamiento de objetos; render en workers (Remotion Lambda/Cloud Run o cola propia). Aquí sí vuelven a importar varias tarjetas V06/H01.

## Reglas para OpenCode

- **Leer:** el paso indicado de este ROADMAP, `PROJECT_CONTEXT.md` y solo los archivos que el paso menciona. No recorrer todo `docs/plan/`.
- **Alcance:** un paso por sesión. No adelantar pasos ni añadir robustez no pedida (colas recuperables, journals, cuotas, snapshots, fuzzing, goldens de píxeles).
- **Extender, no reescribir:** `ProjectStore`, schema y frontera HTTP se reutilizan.
- **Pruebas:** TDD en los pasos marcados; disco real en tests del store; sin llamadas reales a proveedores en tests. Lo visual se verifica en Remotion Studio o en la vista previa.
- **Determinismo en `src/video/`:** prohibido `Math.random`, `Date`, `useFrame` y animaciones CSS.
- **Seguridad mínima que se mantiene:** solo loopback, token, `spawn` sin shell, claves solo en variables de entorno y nunca en `project.json`, logs ni respuestas.
- **Bloqueos:** si el paso exige una dependencia nueva, un cambio de schema o contradice el código real, detenerse y preguntar.
- **Commits:** automáticos al terminar el paso con typecheck y tests en verde, en la rama del paso, conventional commits. Nunca en `main` ni push sin pedido.

## Prompt de ejecución

```text
Ejecuta el paso <ID> de ROADMAP.md en Molecula Studio.
1. Lee de ROADMAP.md: "Decisiones", "Arquitectura objetivo", "Reglas para OpenCode"
   y el paso <ID>. Lee PROJECT_CONTEXT.md y solo los archivos que el paso menciona.
2. Verifica `git status` y crea la rama feat/<id>-<slug> desde main.
3. Si el paso marca TDD, escribe primero el test que falla y muéstrame la salida.
4. Implementa lo mínimo para cumplir la aceptación del paso. No adelantes otros pasos.
5. Ejecuta `npm run typecheck` y los tests del paso; muestra conteos.
6. Explícame cómo verifico a mano el criterio visual o sonoro.
7. Si algo del paso no encaja con el código real, detente y explica la discrepancia.
8. Si typecheck y tests pasan: commit en la rama del paso y marca [x] el paso en "Progreso".
No hagas merge a main ni push hasta que lo apruebe.
```

## Prompt de revisión

```text
Sesión nueva, solo lectura. Revisa la fase <N> de ROADMAP.md contra `git diff <base>..HEAD`.
Verifica: criterios de aceptación de cada paso; reglas de determinismo y seguridad de
"Reglas para OpenCode"; que los tests ejerciten el comportamiento real; y código que
exceda el alcance de la fase. Devuelve hallazgos con severidad (bloqueante / mejora),
archivo:línea y cómo reproducirlo. No modifiques archivos.
```

## Progreso

- [x] 0.1 Registrar decisiones
- [x] 0.2 Instalar dependencias
- [x] 0.3 Fuente
- [x] 0.4 Referencias visuales (ADR-09 decidido)
- [x] 1.1 `projectToVideoProps`
- [x] 1.2 Composición base y Remotion Studio
- [x] 1.3a Contrato KitScene y schema 2
- [x] 1.3b Renderer del kit
- [x] 1.4 Subtítulos palabra por palabra
- [x] 1.5 Render por línea de comandos 🎬
- [x] 2.1 Activos para la vista previa
- [x] 2.2 `PreviewPlayer`
- [x] 2.3 Exportar desde la UI
- [x] 3.1 Contrato y prompt
- [x] 3.2 Parseo y validación
- [x] 3.3 Aplicar guion y dibujo de escenas
- [x] 3.4 Guion manual (UI verificada con respuestas externas emuladas; ChatGPT web pendiente)
- [x] 3.5 Guion automático con Codex (verificado con ejecutable falso y MP4 real; proveedor real pendiente)
- [x] 4.1 Ingesta de audio (store verificado con disco real; UI y reproducción pendientes)
- [x] 4.2 Voz manual (subida y reproducción sincronizada verificadas con PCM real; sin escucha humana ni proveedor)
- [x] 4.3 Cliente Vibi y alineación (HTTP falso y UI con consentimiento; sin proveedor real ni gasto)
- [ ] 4.4 Voz automática con Vibi
- [ ] 4.5 Render con voz 🎯
- [ ] 5.1 – 5.4 Flujo guiado y pulido
