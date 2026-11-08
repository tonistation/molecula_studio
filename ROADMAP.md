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
| Exportar MP4 | ✅ CLI y UI, silencioso o con voz guardada | Fases 1, 2 y 4.5 |
| Vista previa en el estudio | ✅ Borrador con audio manual por escena | Fases 2 y 4.2 |
| Guion automático / manual | Ambos implementados ✅ · proveedor real pendiente | Fase 3 |
| Voz automática / manual | Ambas implementadas ✅ · proveedor real pendiente | Fase 4 |

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
| `GET /api/capabilities` | `{ codex: boolean, vibi: boolean, vibiVoiceConfigured: boolean }`; configuración local, sin consultar cuentas | 3.5 + selector posterior |
| `POST /api/script/generate` | `{ idea, styleId, locale, targetSeconds }` → `ScriptProposal` (no guarda) | 3.5 |
| `POST /api/drawing/generate` | `{ project, sceneId }` → una `KitScene` del borrador validado, con continuidad (no guarda) | 3.5 |
| `PUT /api/projects/:id/scenes/:sceneId/audio` | Modo manual: bytes de audio (+ `?align=vibi` opcional) → ingesta y guarda | 4.2 |
| `POST /api/projects/:id/scenes/:sceneId/voice` | Modo auto: `{ expectedRevision, expectedDigest, consent: true, provider?, voiceId? }`; elección opcional del catálogo validado del proveedor configurado; sin elección usa entorno. Modelo solo del entorno → TTS + STT → ingesta y guarda | 4.4 + selector posterior |
| `GET /api/vibi/credits` | Consulta explícita del usuario → solo `{ credits }` desde `credit_balance`, sin perfil ni clave | 4.4 |
| `GET /api/vibi/voices` | Consulta explícita → `{ provider, voices: [{ voiceId, name, language?, accent?, gender?, style?, description?, previewAvailable? }], hasMore }`; primeros 30 del proveedor configurado, sin URLs de muestras ni claves | Selector posterior |
| `GET /api/vibi/voices/:provider/:voiceId/preview` | Muestra existente del último catálogo válido; bytes de audio autenticados, nunca una URL elegida por el navegador ni una tarea TTS/STT | Detalles y muestras |

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
  - **Excepción de idioma aprobada:** usar el formato documentado por proveedor: `es` en ElevenLabs/CapCut y nombre de idioma en MiniMax. Para MiniMax se confirma `Spanish` contra `GET /v1/languages?provider=minimax` antes del envío de pago; si no está disponible, se rechaza sin adivinar. MiniMax requiere modelo explícito; el modelo predeterminado anterior corresponde a ElevenLabs, y CapCut usa `capcut` según su documentación. No cambia el schema. El panel oficial «Languages» aclara además que el backend normaliza códigos y nombres; el bloqueo inicial por incompatibilidad absoluta fue demasiado estricto.
  - UI: confirmación con caracteres a enviar antes de gastar (TTS cobra por carácter y STT por duración; `GET` de la cuenta en «Auth» devuelve créditos disponibles); «Generar todas» secuencial con progreso; un fallo no deshace las escenas ya generadas.
- **Aceptación:** [x] con el servidor falso: audio, palabras y bindings guardados; clave ausente en logs y en `project.json`.
- **Implementación 4.4:** una tarea TTS por escena, `202/id`, polling secuencial de historia hasta `completed`, descarga MP3 y STT de 4.3, seguido del mismo `attachSceneAudio` transaccional del modo manual. Procedencia `provider`, licencia `Vibi – según plan` y atribución `<provider>/<voiceId>`. Solo español; otros idiomas se rechazan antes de gastar. Configuración ausente/incorrecta no envía TTS; capacidad Vibi sigue indicando solo presencia de clave, no voz válida, autenticación ni saldo. No se aceptan sobrescrituras de proveedor/voz desde HTTP.
- **Seguridad y concurrencia:** descarga con clave únicamente del origen fijo `https://api.vibi.pro` y ruta `/audio/<id>.mp3`; se rechazan CDN externos, HTTP remoto, credenciales, query/fragment y todas las redirecciones, incluso desde la descarga. Base local solo por inyección explícita de pruebas. Límites de 2 MiB JSON, 50 MiB audio y 120 s por etapa; sin reintentos automáticos. Solo una generación automática activa por proceso; revisión/digest se comprueban antes de TTS, de nuevo antes de STT y transaccionalmente al guardar. Se inspeccionan duración, límites y subtítulos representables antes de STT. Cambios externos posteriores al envío pueden rechazar la publicación sin evitar el costo ya causado. Ningún diagnóstico crudo, perfil, URL de descarga ni clave se devuelve o registra.
- **UI y consumo:** «Voz automática · Vibi» permite generar una escena o todas secuencialmente, con progreso y conservación de cada escena ya guardada ante fallo. Requiere borrador guardado y confirmación explícita de cantidad de caracteres, envío de texto/audio, reemplazo y consumo TTS por caracteres + STT por duración desconocida; duración actual es solo referencia, no precio. Ediciones invalidan la confirmación pendiente. «Consultar créditos Vibi» llama a `/v1/auth/me` únicamente al pulsarlo y muestra el saldo consultado sin prometer que alcance. Cancelar corta la espera local, no tareas ni consumo garantizados; control fuera del fieldset bloqueado, sin debilitar los locks de edición. Resultados tardíos no reemplazan la UI; cancelación/persistencia incierta ofrecen recarga canónica.
- **Verificación 4.4:** `npm test`: 465/465 y typecheck en verde; build en verde. Suite E2E completa: 39/39, sin omitidas, ejecutada con `node --test --test-concurrency=2 "tests/e2e/**/*.e2e.ts"`. Cinco pruebas nuevas de integración cubren payload por proveedor, idioma MiniMax verificado, autenticación en cada etapa, saldo saneado, cuerpos/plazos acotados, URLs/redirecciones hostiles sin fuga, fallos sin diagnóstico, consentimiento, revisión/digest, exclusión de duplicados, bytes MP3/STT/procedencia/bindings con disco real, límites antes de STT, cambios externos durante ambas etapas y desconexión sin publicación. Dos E2E nuevas Chromium/ANGLE verifican consentimiento/cancelación sin gasto, invalidación por edición, saldo solo a demanda, orden TTS→STT→guardado→siguiente escena, conservación tras fallo y cancelación real sin éxito tardío. MP3 reproducible generado localmente con el FFmpeg ya instalado de Remotion; no es voz humana. Capturas de consentimiento de escritorio/móvil inspeccionadas, legibles y sin desborde. Solo se tolera el 502 deliberado del proveedor falso en la prueba de fallo; ningún error de runtime inesperado.
- **Límites de verificación:** hubo fallos históricos sensibles a carga al ejecutar suites pesadas en paralelo (deadline STT de 80 ms, cierre de proceso antes de liberar lock y carga de archivo en Lightpanda). `npm test` pasó sin E2E simultáneas; `test:e2e` limita ahora la concurrencia a 2, antes del glob de archivos, para ejecutar completa la suite que incluye Chromium/WebGL/render. No se relajaron oráculos, omitieron pruebas ni modificaron esos comportamientos ajenos al paso. Añadir la opción después del glob mediante argumentos npm no limita la ejecución de este comando Node. Context7 sin cuota; contratos contrastados en documentación oficial Vibi con Lightpanda y `createPortal` en react.dev. Sin dependencias ni cambios de schema, sin acceso a claves reales, consultas de cuenta real ni gasto. Se mantienen los avisos conocidos de bundle/Three.js.
- **Demo 4.4:** `npm start` → proyecto guardado en español → «Voz automática · Vibi» → opcional «Consultar créditos Vibi» → «Generar voz · escena N» o «Generar todas las voces» → revisar caracteres y plan → confirmar consumo → escuchar en la vista previa. Requiere configurar las variables anteriores en el entorno del companion y autorización de gasto del usuario. **No se ejecutó contra Vibi real ni se verificó calidad de voz/alineación fonética humana.** Demo sin gasto: `node --test tests/e2e/auto-voice.e2e.ts` tras compilar. MP4 con voz sigue bloqueado hasta 4.5. Dos commits por comportamiento: cliente/protecciones con pruebas, y conexión HTTP/UI con pruebas/documentación; la segunda unidad se conserva completa aunque supere la guía de líneas de revisión.

- **Correcciones de revisión Fase 4:** la subida manual con `align=vibi` registra su cancelación antes de leer el proyecto/cuerpo e inspeccionar el audio, comprueba una conexión ya abortada y libera el listener en `finally`. Justo antes del STT pago vuelve a comprobar revisión/digest y cancelación, sin bloqueos largos ni colas de transacciones pagas. Dos regresiones con barrera de callbacks del worker, sin esperas temporizadas, reproducen desconexión y guardado concurrente durante la inspección: cero POST al proveedor falso y bytes de todos los archivos del proyecto intactos, salvo el guardado ganador. La revalidación no impide una modificación externa posterior; la ingesta conserva su guard final. `npm test`: 469/469; typecheck y build en verde; E2E completas con concurrencia 2: 40/40 en la repetición. La primera ejecución dio 39/40 por un lock obsoleto en el reinicio histórico de rotación de token, sin cambios en ese código. Sin Vibi real, cambios de schema ni dependencias.

### 4.5 Render con voz

- **Adelantado con autorización a 4.2:** audio por escena en `VerticalVideo`, volumen desde `gainDb`, offset y exclusión con `voiceMode: 'silent'`, verificados en la vista previa compartida.
- **Implementado:** exportación con voz por CLI y UI desde la revisión guardada. Se retiran únicamente los guards temporales de modo silencioso; `VerticalVideo` sigue siendo la composición compartida. La UI informa que usa el modo de voz y los audios guardados. No se adelanta la confirmación de voz desactualizada de 5.2.
- **Hito 🎯 primer video completo:**
  - [x] Video de 31,2 s con 3D, locución española sintetizada localmente y subtítulos con tiempos estimados sobre cada audio; no implica alineación fonética verificada.
  - [x] El MP4 tiene pista AAC completa, decodificada y con señal en las tres escenas.
  - [ ] Escucha humana completa, aprobación de calidad de voz y sincronía fonética fina.
  - [x] Idea sugerida: «¿De dónde sale la sal del mar?».
- **Seguridad y ciclo de vida 4.5:** HTTP conserva su capacidad `render-assets` por render, Host estricto, manifest admitido y comprobación de metadatos/bytes mediante el store; token revocado al terminar o fallar. El CLI no abre un store escritor: servidor privado `127.0.0.1` en puerto efímero, token aleatorio de 256 bits, solo GET de audios referenciados y declarados, sin rutas arbitrarias. Comprueba directorios reales, rechaza symlinks, abre con `O_NOFOLLOW` y acota lectura a 50 MiB/longitud declarada más un byte; verifica longitud y hash disponible. Cierra el servidor y limpia temporales en `finally`, incluso ante error del decoder. Ninguna capacidad se persiste; diagnósticos de selección/render se sustituyen por un error seguro y se reduce el logging de Remotion. Pruebas reales de audio corrupto y ausente comprueban stdout/stderr sin URLs de capacidad y salida no publicada. Se conserva publicación atómica sin reemplazo.
- **Verificación 4.5:** TDD rojo inicial por guard silencioso. `npm test`: 467/467, typecheck y build en verde; E2E completas: 40/40, sin omitidas, con `--test-concurrency=2`. Dos pruebas nuevas de integración y una E2E Chromium/ANGLE: WAV real de 2 s con cuatro frecuencias distingue trims de 500/1500 ms, fronteras de escena y ganancia de −6 dB mediante PCM decodificado; AAC, H.264, 1080×1920, 30 fps, 60 frames y duración ±1 frame. Con los mismos audios adjuntos, `silent` no produce pista de audio. UI descarga bytes idénticos al MP4; UI y CLI tienen WAV decodificado y frame PNG idénticos. Se mantienen todas las pruebas previas, incluido export silencioso y cierre de pestaña. Frontera CLI: token incorrecto, Host, método, activo no declarado, hash alterado, symlinks de archivo/directorio, caducidad en éxito/fallo y token nuevo al reintentar; HTTP ahora ejercita `withVoice` con sus protecciones existentes. Capturas del panel y frames reales inspeccionadas: kit 3D, rótulos y karaoke visibles; sin errores de consola/CSP/recursos en la E2E nueva.
- **Demo real y límites 4.5:** `workspace/voiced-demo-4.5-local/.renders/project_sea_salt/6-20261106-005425.mp4` (ignorado por Git): 936 frames/31,2 s de video y AAC estéreo de 48 kHz/31,211 s. Tres escenas con narración española producida mediante `/usr/bin/say`, voz Paulina ya instalada, sin descargas ni proveedor; se ingirió mediante `attachSceneAudio` y estimación gratuita. PCM decodificado con señal hasta el final de cada locución, capturas a 2/13/25 s muestran el 3D y los subtítulos. No es una grabación humana ni Vibi; no hubo escucha humana ni validación fonética. Uso personal local; no se afirma permiso de redistribución de la voz macOS. El kit existente se reutiliza en las tres escenas, no se afirma una pieza editorial final. Audio, MP4, scripts de demo y capturas permanecen en directorios ignorados, fuera del commit.
- **Decisiones y demo de uso:** Context7 sin cuota; APIs contrastadas con documentación oficial de `renderMedia`/`Html5Audio` y tipos instalados. Sin dependencias ni cambios de schema, claves reales ni gasto. `npm start` → proyecto guardado con voz manual/automática → «Exportar MP4» → «Descargar»; o `npm run render -- workspace/<projectId>/project.json`. Para regenerar este ejemplo local, usar el proyecto guardado en `workspace/voiced-demo-4.5-local/project_sea_salt/project.json` con una salida nueva. Avisos conocidos de tamaño de bundle y `THREE.Clock` no bloqueantes. Una unidad coherente de commit para capability CLI, habilitación HTTP/UI, pruebas y documentación; no se separan oráculos del comportamiento por cantidad de líneas.

---

## Fase 5 — Flujo guiado y pulido

| Paso | Qué | Aceptación |
|---|---|---|
| 5.1 `Stepper` | Barra superior: 1 Idea y estilo · 2 Guion · 3 Voz · 4 Vista previa y exportar. Estado por paso (pendiente / listo / desactualizado), calculado puro desde el proyecto. | Refleja el estado real tras guardar y reabrir. |
| 5.2 Voz desactualizada | Comparar `mediaBindings` guardados con `bindingDigests(project)`. Texto cambiado → «Voz desactualizada» + «Regenerar esta escena». Exportar con voz desactualizada pide confirmación. | Editar texto marca solo esa escena. |
| 5.3 Ajustes por escena | En el editor: paleta, movimiento de cámara y rótulos de la escena `kit`, más «Redibujar». Sin edición 3D libre. | El cambio se ve en la vista previa y se guarda. |
| 5.4 E2E del camino feliz | Un test: crear proyecto → aplicar guion manual fijo → subir audio de fixture → exportar → verificar metadatos del MP4. Con el harness E2E existente. | Pasa en limpio desde un workspace nuevo. |

- **Decisiones 5.1:** `workflowStates` deriva los cuatro estados sin campos persistidos: Idea requiere texto y estilo implementado; Guion, narración e intención visual por escena; Voz reutiliza los vínculos y medios disponibles de `voiceStatuses`. En modo silencioso Voz queda «Listo · Opcional en modo silencioso», aunque no haya audios o sus vínculos sean históricos. Vista previa requiere escenas dibujadas y conversión válida con `projectToVideoProps`; en modo con voz hereda su estado pendiente/desactualizado. Un dibujo provisional sigue disponible en la vista previa existente, aunque el paso se marque pendiente. No se inventa un digest histórico de guion/dibujo que el proyecto no conserva.
- **Navegación 5.1:** barra superior con botones nativos, orden de tabulación y foco visible al llegar a cada sección existente; Guion enlaza además al storyboard. No oculta ni remonta el reproductor, los controles de generación, la exportación o su polling. Todos los pasos se pueden abrir sin completar los anteriores; se conservan únicamente los bloqueos operativos anteriores. Se distingue borrador sin guardar de proyecto guardado. «Listo» indica contenido preparado, no revisión editorial ni MP4 completado: el progreso, la revisión exportada y la descarga siguen en `ExportPanel`, sin simular persistencia/recuperación del render al reabrir. No se adelanta la confirmación ni «Regenerar» de 5.2.
- **Verificación 5.1:** TDD rojo inicial por módulo ausente; seis pruebas puras cubren estados parciales/completos, estilo no implementado, visual inerte, subtítulos intermedios no representables, voz faltante/desactualizada, aislamiento de metadatos/dibujo y persistencia de vínculos al serializar/reabrir. Dos E2E nuevas en Chromium verifican proyecto vacío sin bloqueos, clic/Tab/Enter, foco y controles existentes, modo silencioso opcional, WAV reales, edición de una narración, guardar/reabrir y exportación sin nuevas restricciones. Capturas de la barra inspeccionadas en escritorio (1280×1000) y móvil (390×844): cuatro/dos columnas, texto legible y sin desborde horizontal; sin errores de consola, runtime, CSP ni recursos en las pruebas nuevas. `npm test`: 475/475; E2E completas: 42/42, sin omitidas; typecheck y build en verde. Se corrigió una colisión de etiqueta accesible de la sección con el campo «Idea» sin modificar los tests anteriores. Un intento posterior reprodujo el fallo intermitente ya conocido de lock obsoleto en F08/rotación de token (41/42); la repetición completa pasó 42/42 sin omitir pruebas ni cambiar el harness. Sin schema, dependencias ni llamadas reales a proveedores. Avisos conocidos de bundle/Three.js no bloqueantes.
- **Demo 5.1:** `npm start` → importar el storyboard → usar la barra superior con clic o Tab/Enter; revisar los cuatro destinos y el enlace al editor de escenas. El modo silencioso no requiere voz. Subir WAV propios para ambas escenas, editar el texto de una y comprobar «Desactualizado» solo en Voz/Vista previa; Guardar → Proyectos → Abrir conserva el diagnóstico. No se necesita proveedor ni gasto.

- **Implementación 5.2:** se reutiliza `voiceStatuses`, que compara los `mediaBindings` históricos con `bindingDigests(project)`, sin modificar audio, palabras ni vínculos para aparentar vigencia. Cambiar texto marca únicamente esa escena con «Voz desactualizada»; idioma global, tiempos consumidos, selección/hash/ganancia de audio y palabras siguen las proyecciones existentes. Título, idea y dibujo no invalidan voz. «Regenerar esta escena · escena N» reutiliza la generación individual y su confirmación TTS + STT; conserva los bloqueos de borrador sin guardar, capacidad, idioma y tareas activas. Sin Vibi, sigue disponible subir audio manual propio; se corrige el aviso antiguo que aún presentaba el render con voz como pendiente.
- **Confirmación 5.2:** «Exportar MP4» sigue disponible para una voz desactualizada guardada. Abre un diálogo nativo con las escenas afectadas, advertencia de audios históricos y botones de cancelar o exportar esos audios. Confirmar no regenera, no consume TTS/STT y no convierte los vínculos en actuales; se pide de nuevo en cada exportación. Cancelar/Escape no inicia trabajos, restaura el foco y conserva el documento. Cambios de proyecto/revisión, permisos o medios invalidan la confirmación pendiente. Modo silencioso no advierte por audios que no usa. Se conserva la API de render y el CLI sin una nueva barrera de admisión: el alcance es la confirmación de la UI, no un requisito nuevo de aprobación persistida ni consentimiento de proveedor.
- **Verificación 5.2:** la comparación pura y el aislamiento de texto ya tenían prueba desde 4.2/5.1; se añade una regresión de idioma, medios, tiempos, metadatos y preservar/serializar/reabrir vínculos. E2E nueva roja contra la UI compilada de 5.1, verde con 5.2: dos audios reales, editar solo el primero, guardar/reabrir, regeneración abre consentimiento de 12 caracteres/una escena sin enviar al proveedor falso, cancelación/Escape sin POST ni salida de render, confirmación produce H.264/AAC 1080×1920/30 fps/2 s y conserva bytes/vínculos desactualizados. Segundo caso exporta silencioso sin advertencia ni pista de audio pese a audios adjuntos históricos. Se actualiza la E2E de exportación con voz para aceptar explícitamente sus bindings nulos de fixture, sin eludir el nuevo diálogo. `npm test`: 476/476; typecheck y build en verde; E2E completas: 44/44, sin omitidas, con concurrencia 2. El primer intento dio 43/44 por el lock obsoleto histórico F08/rotación de token; repetición completa verde, sin cambios del harness ni relajación de pruebas.
- **Navegador y demo 5.2:** Chromium real verifica diálogo modal, Tab/Shift+Tab entre controles, foco inicial en cancelar, restauración de foco y Escape; capturas de escritorio 1280×1000 y móvil 390×844 inspeccionadas, legibles y sin desborde. Sin errores inesperados de consola, runtime, CSP ni recursos en las pruebas nuevas. `npm start` → proyecto con dos audios manuales → editar el texto de una escena → «Guardar» → comprobar «Voz desactualizada» solo allí → «Exportar MP4» → cancelar o confirmar audios guardados. «Regenerar esta escena» requiere Vibi configurado y consentimiento de gasto separado; **no se usó proveedor real, clave real ni gasto**. Context7 sin cuota; patrón de diálogo contrastado con documentación oficial de React. Sin schema ni dependencias; avisos conocidos de bundle/Three.js no bloqueantes. No se adelanta 5.3.

- **Implementación 5.3:** cada escena `kit` ofrece «Ajustes de escena»: fondo/niebla, cielo superior/inferior y colores de terreno/agua si ya existen; cámara fija, acercamiento, desplazamiento, órbita o seguimiento de un objeto existente; y hasta seis rótulos de 1–120 caracteres anclados a objetos existentes. No crea geometría, identidades ni parámetros nuevos. Los rótulos conservan sus referencias al editar; se añaden con texto y objeto elegidos explícitamente. Su color es el fondo de la píldora, no el texto: los nuevos usan el fondo oscuro ya utilizado por el renderer para evitar blanco sobre blanco. «Redibujar esta escena» reutiliza el panel manual/automático anterior, sin duplicar proveedores.
- **Frontera y cámara 5.3:** `adjustKitScene` es pura y reutiliza `validateKitScene` con duración/entidades y `applyKitScene`, incluida la validación completa del proyecto. Un ajuste inválido conserva el borrador y muestra un error; el texto intermedio sigue corregible en el control. Paleta y rótulos válidos actualizan la vista previa sin guardar. La cámara se prepara en su formulario y entra al borrador con «Aplicar cámara»; conserva extremos/easing y exige un objeto para seguimiento, cuyas posiciones son offsets. Si los extremos coinciden se avisa que no habrá desplazamiento. Las pistas históricas mantienen todos sus keyframes/FOV y bloquean los movimientos simples hasta elegir explícitamente sustituir la pista y aplicar (perspectiva de 45°). Editar colores/rótulos nunca elimina esa pista. Solo cambian el visual y la revisión de la escena elegida; narración, audio, palabras, vínculos y otras escenas permanecen intactos. Guardar sigue siendo explícito.
- **Verificación 5.3:** TDD rojo inicial por módulo ausente y por falta de controles en la UI anterior; tres pruebas puras y dos E2E nuevas cubren validación real, colores inválidos, rótulos vacíos/excesivos y límites Unicode, superficies ausentes, referencias y vectores de cámara inválidos, preservación/conversión explícita de keyframes, seguimiento con objeto obligatorio y guardado/reapertura aislados. Chromium/ANGLE real verifica cambios de imagen antes de guardar, rótulos proyectados, teclado (Enter/Tab), controles móviles a 390×844 y ausencia de desborde horizontal. Capturas de escritorio/móvil inspeccionadas; se corrigió el fondo blanco inicial de los rótulos nuevos al detectar texto blanco ilegible. Sin errores de consola, runtime, CSP ni recursos en las pruebas nuevas. `npm test`: 479/479; typecheck y build en verde; E2E completas: 46/46, sin omitidas, con concurrencia 2. Un intento final anterior dio 45/46 por el lock obsoleto histórico F08/rotación de token; repetición completa verde, sin cambiar el harness ni relajar pruebas. Se conservan los renders reales silencioso/con voz de las suites anteriores. Context7 sin cuota; controles React contrastados con documentación oficial. Sin cambios de schema, dependencias ni llamadas reales a proveedores. Avisos conocidos de bundle/Three.js no bloqueantes; sin adelantar 5.4.
- **Demo 5.3:** `npm start` → importar el storyboard o abrir un proyecto dibujado → «Ajustes de escena» en una tarjeta. Cambiar cielo/terreno/agua y editar un rótulo; observar la vista previa antes de guardar. En un storyboard migrado, elegir «Sustituir pista histórica…», seleccionar movimiento, preparar extremos y pulsar «Aplicar cámara»; para seguimiento, elegir también un objeto. Probar un color inválido: aparece el error sin reemplazar el dibujo. «Guardar» → «Proyectos» → «Abrir» conserva los ajustes y la otra escena. «Redibujar esta escena» sigue disponible debajo. No se necesita proveedor para estos ajustes.

- **Implementación 5.4:** una sola prueba en `tests/e2e/full-workflow.e2e.ts` recorre la UI real con el harness existente y un workspace temporal nuevo: crear proyecto vacío → escribir idea → pegar/revisar/aplicar guion fijo de dos escenas → pegar/revisar/aplicar el kit local por escena → Guardar → subir WAV sintético propio por escena → reabrir → exportar → descargar. No importa un proyecto preparado ni usa el store para saltar etapas. Comprueba los bloqueos de audio/exportación antes de guardar, ausencia de guardados implícitos, narraciones/dibujos persistidos, vínculos vigentes y cuatro pasos «Listo» al reabrir. Reutiliza el kit `sal-del-mar.json` con animaciones acotadas a 900 ms; la ingesta existente añade 300 ms por escena y las retima proporcionalmente a 1170 ms. No se añaden dependencias, schema, herramientas duplicadas ni cambios de producto.
- **Verificación 5.4:** Chromium/ANGLE y renderer final reales, sin sustituir el render: descarga por el endpoint del proyecto/render admitido, bytes idénticos al archivo publicado bajo `.renders/<projectId>/`, documento guardado intacto. FFprobe del archivo descargado confirma H.264/AAC, 1080×1920, 30 fps, 78 frames y 2,6 s (duración y frames con tolerancia de un frame); audio decodificado cubre la línea de tiempo y tiene señal en ambas escenas. `npm test`: 479/479; typecheck y build en verde; E2E completas con concurrencia 2: 47/47, sin omitidas, incluidos todos los renders reales anteriores y las pruebas de procesos lentas. Capturas de vista previa/panel y un frame decodificado del MP4 inspeccionados en Chromium: kit 3D, rótulos, karaoke y descarga visibles; sin errores de consola, runtime, CSP ni recursos en la prueba nueva. Se conservan los avisos conocidos de tamaño de bundle y `THREE.Clock`.
- **Demo y límites 5.4:** `npm run test:e2e` ejecuta el recorrido completo; para repetir solo esta demo, `npm run build:studio` y `node --test tests/e2e/full-workflow.e2e.ts`. El harness limpia su workspace al terminar; opcionalmente `FULL_WORKFLOW_SCREENSHOT_DIR=<directorio existente>` conserva capturas y `full-workflow.mp4` fuera del repositorio. Los audios son tonos PCM locales, no locución humana ni Vibi. El guion/dibujo son respuestas fijas, no resultados de ChatGPT/Codex reales. No hay cuenta real, clave ni gasto; aceptación de proveedores, escucha humana, sincronía fonética y aprobación estética humana siguen pendientes. Fase 5 (5.1–5.4) implementada y verificada técnicamente en conjunto; no equivale a cerrar esas validaciones humanas ni a iniciar Fase 6/backlog.

## Ampliación autorizada — Selector de voces

- **Alcance:** selector accesible en «Voz automática», separado del backlog de Fase 6. «Cargar voces Vibi» consulta únicamente a demanda el catálogo del proveedor configurado; no consulta saldo, envía narración ni genera audio. No hay claves en el navegador. No permite cambiar proveedor/modelo desde el cliente. Sin `VIBI_VOICE_ID`, basta elegir una voz del catálogo si clave/proveedor/modelo son válidos; MiniMax sigue requiriendo modelo explícito. Sin catálogo o ante fallo, la voz predeterminada configurada conserva el flujo anterior.
- **Contrato y consentimiento:** `provider` y `voiceId` deben aparecer juntos y pertenecer al catálogo obtenido por el companion; campos adicionales, proveedor distinto e IDs desconocidos se rechazan antes de llamadas pagadas. El servidor solo conserva hasta 30 IDs de la última consulta válida en memoria. La elección es de sesión, no un campo nuevo de `project.json`; el activo generado conserva `provider/voiceId` en su atribución existente. Confirmar muestra la voz elegida y el consumo TTS + STT; cambiar selección o cargar de nuevo invalida el consentimiento. Generar todas captura la misma voz y conserva generación secuencial/avances ante fallo; cambiar la elección no modifica audios ya guardados. Salir cancela la carga pendiente, sin actualizaciones tardías.
- **Catálogo documentado:** documentación pública oficial de [Vibi](https://vibi.pro/docs), YAML publicado en sus módulos de documentación: ElevenLabs `GET /v1/default-voices?page_size=30` (`voices`, `voice_id`, `name`); CapCut `GET /v1/capcut/system-voices?page=1&page_size=30&language=es`; MiniMax `GET /v1/minimax/system-voices?page=1&page_size=30&language=Spanish` (`voice_list`, `voice_name`). Los IDs numéricos MiniMax son válidos para TTS según esa documentación. Context7 sin cuota y extracción Lightpanda vacía: se contrastaron los módulos públicos oficiales, no se inventaron voces. Se informa que solo se consultan los primeros 30 resultados, sin búsqueda ni paginación adicional; no se garantiza acento español ni disponibilidad de una voz. Sin previews remotos, dependencias ni cambio de schema.
- **Verificación:** TDD rojo inicial con 404 en catálogo; regresiones HTTP de consentimiento, autenticación, IDs desconocidos/inválidos, proveedor cruzado, campos extra, compatibilidad predeterminada y atribución del ID elegido antes/después de guardar. Catálogos de los tres proveedores comprobados con HTTP falso, incluidos nombres/IDs inválidos, duplicados, límites, claves ausentes y cancelación sin solicitudes. `npm test`: 480/480; typecheck y build en verde; E2E completas: 48/48, sin omitidas, concurrencia 2. Chromium real verifica escritorio/móvil sin desborde, consentimiento invalidado al cambiar voz, lote secuencial con elección capturada/inmutable, atribución guardada, selección sin voz predeterminada y cancelación de carga al salir. Capturas inspeccionadas; sin errores inesperados de consola/runtime/recursos. Un intento previo reprodujo el lock obsoleto histórico F08/rotación de token (47/48); repetición completa verde, sin tocar el harness ni relajar pruebas. Avisos de bundle/Three.js conocidos no bloqueantes.
- **Demo:** abrir proyecto guardado → «Voz automática» → «Cargar voces Vibi» → «Voz para generar» → «Generar voz · escena N» o «Generar todas las voces» → revisar nombre/proveedor/ID y consumo → confirmar o cancelar. Se guarda únicamente el audio/atribución al generar, no la preferencia. Reabrir restaura la voz predeterminada como selección inicial. No se probó ninguna cuenta/proveedor real ni hubo gasto; audios de pruebas son MP3/tonos locales y HTTP falso. Validación humana de voces/acento sigue pendiente.

## Ampliación autorizada — Detalles y muestras de voces

- **Entrega:** opciones concisas «nombre · idioma · acento» solo cuando existen esos datos; ficha de idioma/acento, género, estilo y descripción informados. Sin datos: «Idioma/acento no informado». Sin país documentado ni filtro geográfico; nunca se infiere un acento del nombre, de `Spanish` ni de un locale. La elección y el consentimiento de generación conservan su comportamiento anterior; no cambia `project.json`.
- **Fuentes:** [documentación pública Vibi](https://vibi.pro/docs), módulos oficiales `list-default-voices-GY6tuGzb.js`, `list-system-voices-Bg7qwgk6.js` y `list-system-voices-Cew3fF7X.js` bajo `https://vibi.pro/assets/`. Context7 sin cuota; Lightpanda no extrajo texto, se leyeron los módulos públicos. Limpieza React contrastada con su [documentación oficial](https://react.dev/reference/react/useEffect). No hubo nuevas consultas de catálogo/saldo de una cuenta ni TTS/STT reales.

| Proveedor | Datos documentados utilizados | Muestra existente admitida |
|---|---|---|
| ElevenLabs | `language`, `accent`, `gender`, `descriptive`, `description`; se prioriza una entrada española explícita de `verified_languages`, sin heredar su acento inglés | `preview_url`: HTTPS `storage.googleapis.com/eleven-public-prod/audio/<archivo>.mp3` o `premade/voices/<voz>/<archivo>.mp3` del mismo bucket |
| MiniMax | Idioma/género/acento reconocido en `tag_list`, `description`; etiquetas desconocidas no se adivinan por posición | `sample_audio`: HTTPS `cdn.hailuoai.video/moss/voice_sample/<archivo>.mp3` |
| CapCut | `language`, `gender`, tonos reconocidos de `tags` como estilo; su filtro «accent» describe tono, no geografía | `preview_url`: origen Vibi y ruta exacta `/v1/capcut/voices/<voz elegida>/preview` |

- **Seguridad y límites:** DTO cerrado con texto plano acotado (120 caracteres por etiqueta, 500 de descripción); metadatos inválidos y muestras no autorizadas se omiten sin inutilizar voces válidas. URLs solo en memoria del servidor, hasta 30 voces del último catálogo válido. Endpoint con token/Origin/Host existentes, proveedor configurado e ID catalogado; no acepta una URL del cliente. Orígenes/rutas exactos, sin credenciales en URL, query, fragmento ni redirecciones. La clave Vibi nunca se envía a CDN; solo puede enviarse a la ruta Vibi CapCut validada. Descarga limitada a 5 MiB y 15 s por defecto, MIME de audio y firma de contenedor comprobados; el navegador valida la reproducción. URLs fuera de estos límites quedan sin muestra, aunque sean legítimas. CSP permanece local con `media-src 'self' blob:`, sin permisos externos nuevos.
- **UX y demo:** proyecto abierto → cargar voces → elegir → «Escuchar muestra» / «Detener», con controles nativos de audio, espera y error recuperable. Solo descarga una muestra existente; no genera otra ni promete una tarifa universal del proveedor. Idioma de la muestra y narración pueden diferir. Cambio de voz, recarga de catálogo, generación o salida detienen audio, cancelan peticiones y revocan blobs; no hay reproducción por seleccionar una voz ni resultados tardíos de otra selección. Para demostrar sin cuenta: `npm run build:studio` y `node --test tests/e2e/voice-details.e2e.ts` (tonos/servidor locales).
- **Verificación:** TDD inicial rojo por módulo de mapeo ausente; pruebas de metadatos opcionales de los tres proveedores, prototipos/controles/HTML/longitudes, URLs hostiles, autenticación, proveedor/ID ajenos, cero POST pagos, CDN sin clave, redirects, tipo/firma inválidos, exceso de bytes, timeout, cancelación y blobs tardíos. Chromium real: reproducción tras clic/Enter, controles, escritorio/móvil sin desborde, detener/cambiar/salir, revocación y cancelación, ausencia de muestra y reintento explícito de fallo. Capturas de ficha inspeccionadas; recorrido normal sin errores de consola/runtime/CSP/recursos; el caso de error solo registra el 502 provocado. Sin dependencias ni cambios de schema.
- **Suites completas:** `npm run typecheck`, `npm test` (490/490), `npm run build:studio` y E2E con concurrencia 2 (50/50), sin omitidas. El primer intento ejecutó ambas suites pesadas simultáneamente: la prueba histórica STT con plazo de 80 ms falló antes de enviar su POST y el comando E2E alcanzó el límite externo de 120 s; se repitieron completas por separado, con plazo de ejecución suficiente, sin cambiar pruebas históricas ni el harness. Se mantienen los avisos conocidos de bundle/Three.js. Una unidad de comportamiento conserva proxy, UI, pruebas y documentación juntos para poder revisar y revertir la capacidad completa.

## Ampliación autorizada — Demo con planos distintos

- **Entrega:** [proyecto fuente portátil](docs/plan/examples/kit/sal-del-mar-storyboard.json), silencioso, 36 s y sin activos externos. Se importa directamente en el estudio o se renderiza con `npm run render -- docs/plan/examples/kit/sal-del-mar-storyboard.json workspace/sal-del-mar-planos.mp4` (salida nueva). No añade composición registrada, renderer, schema, dependencias ni funcionalidades de producto; reutiliza el kit, sus objetos tipados y el CLI existentes. La muestra anterior permanece intacta.
- **Autoría y ciencia:** cuatro composiciones físicas distintas, no copias recoloreadas. La roca `source-rock` conserva tipo, parámetros, color y semilla en los dos primeros planos; la gota `river-drop` conserva identidad entre detalle y río. Los puntos dorados y gotas son símbolos ampliados, indicado en pantalla en detalle/mar y explicado en `postText`, no cristales visibles ni escala molecular. El guion explica una ruta de aporte de sales y dice expresamente que evaporar agua no fabrica sal; metadatos aclaran otros aportes y pérdidas, con [fuente USGS](https://www.usgs.gov/special-topics/water-science-school/science/why-ocean-salty) consultada. Se eligieron planos de 7–10 s para esta explicación pausada autorizada, con movimiento interno continuo, en lugar del ritmo general de 2–5 s de las referencias.

| Tiempo de la versión hablada | Composición y cámara | Acción |
|---|---|---|
| 0–7,2 s | General de montaña, acercamiento | Lluvia y gota hacia la roca; pregunta inicial |
| 7,2–17,1 s | Detalle de roca/agua, órbita corta | Símbolos de sales se desplazan de la roca al agua |
| 17,1–26,8 s | Río sinuoso visto desde arriba, seguimiento | La misma gota viaja corriente abajo entre dos orillas |
| 26,8–35,8 s | Mar sin terreno, paneo lateral | Flechas de vapor ascendentes, sol y sales que permanecen |

- **Voz local:** Paulina `es_MX` verificada instalada con `/usr/bin/say -v '?'`; síntesis local a 155 palabras/minuto, WAV PCM de 24 kHz ingresados mediante `ProjectStore.attachSceneAudio`, manifest con hashes y atribución honesta. El store ajusta duraciones, animaciones y subtítulos estimados, añade sus 300 ms de cola y conserva vínculos vigentes. Sin descarga de voces, proveedores, claves ni gasto; ganancia 0 dB. Uso técnico personal local: no se afirma permiso de redistribución de la voz macOS ni escucha humana o sincronía fonética exacta.
- **MP4 real:** `/Users/jose/personal_dev/molecula/molecula_studio/workspace/distinct-shot-demo-local/.renders/project_salt_journey/6-20261106-073703.mp4`. Producido con `npm run render -- workspace/distinct-shot-demo-local/project_salt_journey/project.json`: H.264/yuv420p, 1080×1920, 30 fps, 1074 frames/35,800 s; AAC estéreo de 48 kHz/35,819 s. Audio completo decodificado a PCM: RMS por escena 0,0955 / 0,0990 / 0,1056 / 0,0977; pico máximo 0,4225, sin saturación. Frames del MP4 inspeccionados a 0,4/2/6,5/8/11/16/22/26/28/31/34,5 s, generados con Chrome Headless Shell/ANGLE real, no Lightpanda: 3D, lluvia, río, flechas ascendentes, rótulos/notas sin recorte y karaoke visibles. Se corrigieron proporciones de las flechas y encuadre de la nota solo en los datos del ejemplo. No implica aprobación estética humana. Audio, videos, capturas y scripts locales permanecen ignorados por Git.
- **Abrir o repetir localmente:** desde la raíz del repo, `open workspace/distinct-shot-demo-local/.renders/project_salt_journey/6-20261106-073703.mp4`. Para una nueva exportación con voz, repetir el comando del CLI anterior; para abrir el proyecto en el editor, `MOLECULA_WORKSPACE=workspace/distinct-shot-demo-local npm start` y «Abrir». El JSON fuente versionado siempre sigue siendo silencioso y autocontenido; no depende de que exista este workspace local.
- **Pruebas:** tres pruebas nuevas con parser/validador real y `projectToVideoProps`: proyecto autocontenido, conversión pura, narración/subtítulos, timeline contiguo, diferencias físicas de composición, identidades recurrentes, cámaras móviles y proyección de rótulos/notas/flechas dentro del cuadro seguro. Rojo inicial por fixture ausente; regresiones de autoría rojas/verdes al detectar punta de vapor próxima al karaoke y nota ampliada recortada. `npm test`: 483/483; typecheck y build en verde; E2E completas: 48/48, sin omitidas, concurrencia 2. Dos intentos previos reprodujeron el lock obsoleto histórico F08/rotación de token (47/48); repetición completa verde sin tocar harness ni relajar pruebas. Context7 sin cuota; se consultaron documentación oficial Remotion y renderer/tipos instalados. Se mantienen avisos conocidos de bundle y `THREE.Clock`.

## Ampliación autorizada — Diagnóstico de alineación

- **Entrega:** se mantiene el emparejamiento estricto de 4.3 y la estimación completa ante discrepancias. Voz manual/automática muestran el motivo específico y su código, junto a «Se guardaron subtítulos estimados, no alineación real». No se corrigen, recortan ni ordenan silenciosamente tiempos inválidos. La narración sigue siendo autoritativa y los vínculos de medios conservan su contrato.
- **API efímera:** `sttWordsToWords` conserva su resultado `Word[]` y callback de aviso; añade un quinto callback opcional para `AlignmentDiagnostic`. Las respuestas exitosas de `audio?align=vibi` y `voice` añaden `alignmentDiagnostic` solo al caer en estimación: `{ reason, expectedWordCount, durationMs, receivedEntryCount?, spokenWordCount?, wordIndex? }`. `wordIndex` empieza en cero dentro de las palabras filtradas, no de todas las entradas del proveedor. Los conteos recibidos/filtrados solo aparecen si se aceptó la lista de hasta 5000 entradas; duración de audio validada entre 1 y 15000 ms. Se informa únicamente el primer rechazo, con prioridad de estructura/conteo, luego texto y tiempos por palabra.

| Código | Motivo |
|---|---|
| `invalid-response` / `entry-limit` | Entrada del alineador no es lista / supera 5000 entradas; no se recorre una lista excesiva |
| `word-count-mismatch` | Cantidad distinta tras filtrar solo `type: 'word'` |
| `text-mismatch` | Texto de una palabra inválido o distinto, conservando normalización estricta anterior |
| `invalid-time` / `negative-time` | Tiempo ausente, no numérico, no finito / negativo |
| `invalid-interval` | Final anterior o igual al inicio |
| `overlap` | Solapamiento o desorden respecto de la palabra anterior |
| `out-of-range` | Final posterior a la duración inspeccionada del audio |
| `rounding-collapse` | Intervalo no representable tras convertir y redondear a ms |

- **Privacidad y límites:** diagnóstico de tamaño constante, sin palabras, transcripciones, narración, timestamps crudos, URL, ID de tarea, cabeceras, clave ni datos de cuenta. No se persiste en `project.json`, archivos de depuración ni logs; desaparece al cerrar/reabrir. El proyecto conserva narración y palabras de subtítulo habituales, sin nuevos campos ni procedencia persistida de alineación. El cliente Vibi conserva su rechazo previo de respuestas malformadas/excesivas como `vibi-response` sin publicación: los códigos de estructura del alineador puro no convierten errores del proveedor en éxito. Sin dependencias ni cambio de schema.
- **Prueba real anterior, no repetida:** autorización limitada consumida en una TTS + una STT con Alice, 76 caracteres, audio MP3 de 4963 ms; ambas tareas terminaron y el usuario valoró positivamente la voz. Hubo fallback a 14 palabras estimadas. No se retuvo la respuesta STT cruda, por lo que la causa exacta es desconocida y no se afirma corregir aquel caso. La evidencia anterior con HTTP falso se mantiene como histórica. Esta ampliación solo usa pruebas deterministas locales, sin nuevas consultas reales a cuentas, claves ni gasto.
- **Pruebas:** TDD rojo inicial: 14 casos de diagnóstico fallaron por callback ausente y las dos rutas HTTP fallaron por campo inexistente. Verde con códigos de todos los motivos, contadores/índices, números no finitos, entrada sin mutar, filtrado de eventos, límite exacto/excesivo sin recorrerlo y ausencia de texto/URL/logs. HTTP falso verifica alineación válida sin diagnóstico, fallback manual/automático con bindings vigentes y ningún diagnóstico persistido; proveedor malformado/excesivo sigue fallando de forma segura. E2E existentes comprueban avisos concretos de cantidad de palabras y colapso de redondeo en las dos superficies reales, sin modificar el layout ni el flujo de consentimiento. Demo sin red externa: `node --test tests/unit/voice-alignment.test.ts`.
- **Suites completas:** `npm test`: 507/507, `npm run typecheck` y build del estudio en verde. E2E completas con concurrencia 2: 50/50, sin omitidas. Primer intento: 49/50 por el lock obsoleto histórico de F08/rotación de token; repetición completa verde, sin cambiar harness ni relajar assertions. Se mantienen los renders reales y los avisos conocidos de tamaño del bundle/Three.js. Una unidad de commit reúne comportamiento, pruebas y documentación.
- **Pendientes:** Codex real y aceptación efectiva de sus schemas, recorrido completo idea → MP4 con proveedores reales, metadatos/muestras del catálogo con cuenta real y sincronía fonética fina. La escucha positiva de una muestra corta no cierra la revisión humana completa del video ni autoriza otro consumo.

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
- [x] 4.4 Voz automática con Vibi (HTTP falso, MP3 local y UI con consentimiento; proveedor real pendiente)
- [x] 4.5 Render con voz (CLI/UI y demo hablada local de 31,2 s; escucha humana y precisión fonética pendientes)
- [x] 5.1 Stepper (estados derivados, navegación sin bloqueos y guardar/reabrir verificados)
- [x] 5.2 Voz desactualizada (diagnóstico aislado, regeneración con consentimiento y confirmación de exportación sin alterar vínculos)
- [x] 5.3 Ajustes por escena (paleta, cámara explícita y rótulos validados, vista previa y guardar/reabrir aislados)
- [x] 5.4 E2E del camino feliz (workspace nuevo, guion/dibujo manual, audio local y descarga de MP4 real con metadatos/PCM)
- [x] Ampliación autorizada: selector de voces Vibi por catálogo a demanda, sin cambios de schema ni llamadas reales al proveedor
- [x] Ampliación autorizada: detalles documentados y reproducción de muestras existentes, sin generación ni consultas reales durante la implementación
- [x] Ampliación autorizada: muestra de sal del mar con cuatro planos distintos, fuente portátil y locución local sin gasto
- [x] Ampliación autorizada: diagnóstico efímero de alineación con códigos seguros, estimación explícita y pruebas locales sin nuevo consumo
