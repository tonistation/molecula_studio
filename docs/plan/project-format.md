# Proyecto portable: JSON versionado y activos relativos

**Desde M1**, el proyecto es un archivo `project.json` UTF-8 con `schemaVersion: 1`; puede estar incompleto y guardar sin render, voz ni proveedores. No usa base de datos ni incluye secretos. Este es el contrato propuesto para implementar un schema ejecutable en M1, no un validador ya existente.

## Ruta normal y copia portable

```text
<workspace autorizado>/
  <projectId>/
    project.json
    assets/
      <assetId>.wav
      <assetId>.png
```

`projectId` es una carpeta generada por el companion, no el título del proyecto. JSON no almacena la ruta absoluta del workspace. El usuario guarda mediante el companion y recibe confirmación de disco; abrir lista proyectos del workspace y permite importar JSON externo de forma explícita.

**Guardar copia portable** produce una nueva carpeta con JSON y todos los activos referenciados disponibles. Se confirma solo después de completarse la copia. Para transportarla se mueve la carpeta entera; ZIP automático queda fuera de v0.1. Si faltan activos, la copia puede guardarse como borrador únicamente tras avisar qué falta; nunca se etiqueta «completa».

**Descargar copia JSON** es opcional: el navegador solicita una descarga, sin asegurar dónde terminó ni que el usuario la haya conservado. Mostrar «Descarga solicitada», no «Proyecto guardado»; no limpia dirty. No incluye binarios y advierte que requiere la carpeta `assets/` para ser portable.

**Abrir JSON externo** recibe bytes del archivo elegido, no acceso a su directorio. Se valida primero y se importa como copia en workspace; si faltan activos se ofrece seleccionar archivos locales para relink. No se exige permiso persistente del navegador ni se sobrescribe el archivo arbitrario original.

Importar conserva `projectId` si no existe en destino; si colisiona, ofrecer abrir el existente o crear copia con ID nuevo, nunca sobrescribir por coincidencia de ID. Guardar copia genera siempre `projectId` nuevo, revisión raíz 0 y fechas nuevas, manteniendo IDs/versiones de entidades y escenas. Es una clonación explícita, no el roundtrip de guardar/reabrir el mismo documento. Importar desde fuera o clonar limpia `approval` con aviso, pero conserva medios, referencias y `mediaBindings`; si se limpia una aprobación existente al importar, registrar esa edición incrementando revisión/fecha antes del commit. Reabrir normalmente no limpia aprobaciones válidas.

## Reglas generales del schema 1

- Objetos cerrados: solo campos descritos aquí. Todas las claves de los ejemplos son obligatorias; valores `null` y arrays vacíos representan trabajo pendiente.
- Números finitos; tiempos y revisiones enteros seguros. Sin `NaN`, `Infinity`, números negativos donde no corresponda ni coerciones de strings.
- IDs únicos y ASCII: `[a-z][a-z0-9_-]{0,63}`. No son nombres de ruta libre.
- Fechas ISO 8601 UTC con sufijo `Z`; `updatedAt` no anterior a `createdAt`.
- Texto plano Unicode, sin NUL ni controles salvo tab/nueva línea; tratar HTML aparente como texto, nunca ejecutar. Rechazar claves peligrosas incluso anidadas y duplicadas durante parse.
- Strings no se interpretan como código, CSS, URL ni expresiones. Títulos/etiquetas jamás forman rutas de archivos.
- `schemaVersion` es un entero de contrato, distinto de `revision` (edición), `styleVersion` (estilo) y `generatorVersion` (exportación).
- Los límites de [requirements](requirements.md) aplican tanto al archivo como al editor y a las respuestas de proveedores.

## Campos raíz

| Campo | Tipo / regla | Uso |
|---|---|---|
| `schemaVersion` | Entero, exactamente `1` | Selección de lector |
| `projectId` | ID | Identidad estable del documento |
| `revision` | Entero ≥0 | Incrementa por cada edición persistente |
| `title` | String 1–120 caracteres | Nombre visible, sin efecto de ruta |
| `createdAt`, `updatedAt` | Fecha UTC | Auditoría de documento, no reloj de animación |
| `idea` | String 0–4 000 caracteres | Brief incluso sin escenas |
| `locale` | `es` o `en` | Narración/editor, no traduce contenido solo |
| `styleId` | ID | Estilo global; solo `stylized-3d` instalado |
| `styleVersion` | Entero ≥1 | Para el estilo inicial: `1` |
| `seed` | Entero 0–4 294 967 295 | Variación reproducible |
| `output` | Objeto cerrado | Resolución/reloj/salida |
| `captionStyle` | Objeto cerrado | Presentación compartida de palabras |
| `entities` | Array 0–32 | Registro de identidades visuales versionadas e inmutables |
| `scenes` | Array 0–12 | Orden narrativo y temporal |
| `assets` | Array 0–100 | Manifest de referencias, no bytes |
| `approval` | `null` o `{contentDigest, approvedRevision, approvedAt}` | Aprobación editorial del contenido, nunca autorización de gasto |

No se guardan jobs, rutas absolutas, `lastOpened`, tokens, claves, prompt de sistema, estado de UI, historial de undo ni MP4 dentro del proyecto. Sí se guardan vínculos editoriales acotados de medios y aprobación: no son recibos de ejecución. Exportaciones y diagnóstico son artefactos separados.

## Output y subtítulos

| Campo | Valores schema 1 |
|---|---|
| `output.width`, `output.height` | `1080`, `1920` |
| `output.fps` | `30` |
| `output.durationMs` | `0` si no hay escenas; suma hasta `60000`, múltiplo de 100 |
| `output.container` | `mp4` |
| `output.voiceMode` | `silent` o `withVoice`; default `silent`, elección explícita antes de exportar |
| `captionStyle.enabled` | Booleano |
| `captionStyle.fontId` | `builtin-sans-heavy-v1`, fuente local empaquetada con licencia registrada |
| `captionStyle.fontSizePx` | Entero 24–120; default 72 |
| `captionStyle.color`, `highlightColor` | Color hexadecimal `#RRGGBB` |
| `captionStyle.anchor` | `upper`, `lower` o `center`; default inicial `upper` |
| `captionStyle.safeMarginPx` | Entero 48–240; default 120 |

Los IDs `builtin-*` identifican recursos versionados del runtime, no archivos que deban existir junto al ejemplo. M1 conserva configuración aunque todavía no tenga renderer ni fuente instalada.

## Escena

| Campo | Tipo / regla |
|---|---|
| `sceneId` | ID único en proyecto |
| `revision` | Entero ≥0, cambia con contenido de esa escena |
| `title` | Texto 1–120 |
| `startMs` | Entero ≥0, múltiplo de 100, derivado del orden |
| `durationMs` | Entero 1 000–15 000, múltiplo de 100 |
| `text` | Texto 0–2 000; total de escenas ≤12 000 |
| `visualIntent` | Texto 0–1 000; nota no ejecutable |
| `visual` | `null` o escena visual allowlisted |
| `audio` | `null` o `{assetId, offsetMs, gainDb}` |
| `words` | Array de `{text, startMs, endMs, emphasis}` |
| `mediaBindings` | `{audio, words}`; cada valor `null` o `{inputDigest, outputDigest}` |

Escenas contiguas, sin solapamiento ni huecos: primera `startMs = 0`; siguiente empieza en fin de anterior. Reordenar recalcula start, mantiene IDs y marca cambio de proyecto. No se permiten duraciones contradictorias con `output.durationMs`.

`audio.assetId` referencia manifest de tipo `audio`; `offsetMs` entero ≥0 dentro del archivo; `gainDb` finito entre −24 y 6. Audio seleccionado desde ese offset no debe superar la escena. Activo faltante o duración aún no verificada deja la escena incompleta, pero guardable.

`words` máximo 300 por escena y 1 500 por proyecto. Cada `text` tiene 1–80 caracteres; `emphasis` es booleano. Tiempos **locales a escena**: `0 ≤ startMs < endMs ≤ durationMs`, ordenados y sin solapamiento. No se exige alinear automáticamente palabras con `text`; si edición los separa, vínculo pendiente/obsoleto y bloqueo de exportación con esos subtítulos, no mera advertencia.

Una escena con `visual: null`, `audio: null`, `words: []` es un borrador válido. No persistir `ready: true`: readiness se deriva del contrato y los activos realmente disponibles.

## Vínculos portables y aprobación editorial

**Decisión MVP:** persistir solo dos bindings por escena y una aprobación por proyecto, sin historial de jobs. Así guardar texto editado junto con audio/timings anteriores no vuelve actuales esos medios al importar en otro workspace. La alternativa de revisar todo en cada reapertura sería segura, pero castigaría también proyectos intactos. Todas estas claves son obligatorias desde schema 1; `null` significa pendiente, no error. Un archivo sin ellas no obtiene defaults que inventen vigencia: falla validación de contrato sin alterar el activo.

`inputDigest`, `outputDigest` y `contentDigest` son SHA-256 hex minúscula de 64 caracteres. Algoritmo fijo `binding-v1`: JSON canónico [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), codificado UTF-8, sin normalizar Unicode ni recortar texto. No permitir algoritmo, expresión de hashing ni listas de dependencias definidos por archivo. Proyecciones exactas:

| Digest | Datos canónicos a hashear |
|---|---|
| Audio input | `{text: scene.text, locale: project.locale}` |
| Audio output | `{assetId, sha256, offsetMs, gainDb}` del audio seleccionado y su manifest |
| `audioTimingDigest` | `null` si `output.voiceMode: silent` o no hay audio; si se consume audio, hash de `{sha256, offsetMs, durationMs}` del activo/selección; hash de activo debe estar verificado |
| Words input | `{text: scene.text, locale: project.locale, audioTimingDigest}` |
| Words output | Array `scene.words` completo |
| Content | Objeto raíz completo salvo `projectId`, `revision`, `createdAt`, `updatedAt`, `approval` |

Solo crear binding al aceptar explícitamente audio/alineación manual revisados o una propuesta completada para las entradas exactas del snapshot. No recalcularlo para «reparar» vigencia al guardar, abrir, importar o editar. Se recalculan digests esperados para comparar, preservando los bindings históricos cuando no coinciden. Con `audio: null`, su binding debe ser `null`; con palabras vacías, binding de palabras `null`. Un audio seleccionado sin hash conocido puede guardarse con binding `null`, pero no declararse actual.

| Resultado derivado | Comportamiento |
|---|---|
| Binding nulo con medio presente | «Sin verificar»: guardar sí; revisar/aceptar antes de usarlo en exportación |
| Input u output no coincide | «Obsoleto»: conservar audio/words y referencias, bloquear exportación que los consume |
| Binding coincide pero archivo falta/cambió o no pasa validación | No disponible/conflicto: bloquear uso; relink nunca borra evidencia ni acepta contenido distinto solo por ID |
| Binding coincide y archivo/formato están verificados | Medio actual; no implica aprobación editorial del proyecto |

Editar texto/locale invalida audio ligado al texto y palabras; mover cámara, cambiar orden, escala uniforme o colores no invalida voz ni alineación local. Cambiar duración solo revalida ajuste de audio/words, no obliga a regenerar voz si cabe. Seleccionar otro audio/offset invalida alineación; cambiar gain no invalida tiempos. Editar palabras requiere aceptar su nueva revisión. Tras revisión humana puede reaceptarse audio existente si realmente corresponde, o regenerarse mediante solicitud aparte: nunca se dispara proveedor automáticamente.

`approval.approvedRevision` entero entre 0 y revisión raíz, `approvedAt` fecha UTC no posterior a `updatedAt`. Aprobar incrementa revisión raíz, fija esa revisión/fecha y digest actual, solo si no hay pendientes para la salida elegida. Modificar contenido conserva aprobación histórica pero la muestra obsoleta si el digest difiere. Abrir/guardar no la renueva. Importación externa/copia exige nueva revisión editorial con aviso; no reutiliza un sello importado como confianza local. Estos hashes son integridad/comparación, no firma de autoría ni garantía de que la voz diga el texto correcto.

Para exportar: verificar bindings/activos usados, elegir explícitamente `output.voiceMode` y `captionStyle.enabled`, aprobar contenido resultante y guardar. Estas opciones forman parte del digest de aprobación y del recibo de exportación. `silent` conserva audio/refs, pero excluye su consumo; `withVoice` exige audio actual disponible en cada escena. Si se usan palabras, su binding debe corresponder al audio consumido o a alineación manual sin audio. Cambiar de voz a silencio cambia el input de palabras a `audioTimingDigest: null`: exige revisar/aceptar tiempos para esa salida si antes dependían de audio, no los elimina ni declara actuales automáticamente. Una decisión de salida no cambia silenciosamente `audio` ni elimina palabras.

Límites: máximo 24 bindings y una aprobación (sin arrays históricos, notas libres, provider receipts ni secretos). Validar forma/rangos de digests sin confiar en sus valores. Discrepancia de hashes editoriales hace el borrador guardable pero obsoleto, no corrupción estructural. Un archivo malicioso no autoriza red, jobs, lectura de rutas ni pagos por tener `approval` no nulo.

## Registro `entities`: identidad antes de instancias

Cada definición contiene `{entityId, definitionVersion, generatorId, generatorVersion, seed, variantOf, identity}`. Los IDs son únicos; versión entera ≥1 y seed uint32. En v0.1 `generatorId: procedural-v1`, `generatorVersion: 1`; el generador, parámetros y seed fijan diseño reproducible, no una nueva interpretación por escena.

`variantOf` es `null` o `{entityId, definitionVersion}`: señala origen registrado y versión de origen al crear una variante; no puede formar ciclos ni apuntarse a sí misma. La versión histórica puede ser menor que la definición actual del origen: es lineage informativo, no referencia de render. Referencias de instancia sí exigen versión exacta actual; no hay fallback.

`identity` contiene exactamente `{type, proportions, props, rigId, voiceId}`:

- `type` en `character`, `car`, `rockLayers`, `arrow`, `label`.
- `proportions` objeto `{width, height, depth}`, números finitos 0.1–10 en unidades del modelo; el generador los aplica como dimensiones de diseño, no como deformación animada.
- `props` por tipo en tabla inferior; fija colores/materiales del preset. No hay overrides por escena.
- `rigId`: `character-basic-v1` para personaje; `rigid-v1` para otros. Son rigs de catálogo bloqueados, sin editor.
- `voiceId`: `null` en v0.1. Reserva explícita de vínculo de voz futura, no credencial ni API voice libre.

| `identity.type` | `identity.props` exactas | Restricciones |
|---|---|---|
| `character` | `{bodyColor, accentColor}` | Colores hex; material/rig fijos por catálogo |
| `car` | `{bodyColor, wheelColor}` | Colores hex; proporciones del auto fijadas por definición |
| `rockLayers` | `{colors}` | 2–6 colores hex |
| `arrow` | `{color, direction}` | Hex y vector unitario no nulo |
| `label` | `{text, color}` | Texto plano 1–120 y color hex |

Assets externos de identidad no se admiten todavía. Si se habilitan, deben referenciar manifest con hash verificado, versión y licencia; no cambiar archivos bajo un ID ya fijado. Los recursos builtin están fijados por versión de generador y runtime.

Cambiar diseño globalmente incrementa `definitionVersion`, actualiza referencias de todas sus instancias atómicamente e invalida visuales/exportaciones afectadas. Crear variante genera nuevo `entityId` con `variantOf` y deja la base intacta. No exige habilitar estas operaciones en la UI M1/M2: primeros assets bloqueados, solo catálogo.

## Visual `stylized-3d@1`

| Campo | Tipo / regla |
|---|---|
| `templateId` | `explainer-v1` |
| `palette` | `daylight` o `dark` |
| `background` | Color `#RRGGBB` |
| `camera` | `{projection, keyframes}`; `projection: perspective` |
| `components` | Array 1–16 de instancias referenciadas definidas abajo |

Camera keyframes: 1–8 objetos `{atMs, position, target, fovDeg}`; `atMs` entero local, ordenado estrictamente, de 0 a duración incluida; primero en 0. `position` y `target` son vectores de tres números de −100 a 100; distintos entre sí. `fovDeg` de 20 a 80. Interpolación lineal; después del último keyframe mantener pose. Se permite último keyframe exactamente en fin de escena aunque ese instante no se capture.

Instancias contienen exactamente `{componentId, entityId, definitionVersion, position, rotation, scale, motion, state}`. `componentId` único en escena; referencia de identidad existente y versión exacta actual; posición vector acotado; rotación Euler XYZ en radianes, vector de −6.284 a 6.284; `scale` número **uniforme** 0.1–10; `motion` en `none`, `idle`, `pulse`, `reveal`; `state: default` en v0.1. Sin `props`, colores, geometría ni escalas por eje en instancia.

Pose proviene del rig y movimiento allowlisted; estados/deformaciones futuros necesitarán definición explícita versionada, no un override accidental. Una perspectiva/cámara distinta puede cambiar tamaño aparente, no las proporciones del modelo en su espacio propio.

Defaults de movimiento definidos y versionados por runtime: `idle` balanceo sinusoidal de 2 s y amplitud 0.05 unidades; `pulse` escala 1±0.05 en 1 s; `reveal` escala/opacidad lineal durante primeros 500 ms; `none` constante. Seed afecta variaciones de composición predefinidas, no cambia el reloj. Nada de funciones serializadas o bibliotecas importadas por nombre libre.

Si se agrega un componente, no se lo acepta silenciosamente en schema 1 existente: se necesita evolución versionada del estilo y su política de compatibilidad.

## Manifest de activos

Cada entrada tiene exactamente los siguientes campos. Un archivo puede faltar físicamente sin que el JSON sea inválido.

| Campo | Tipo / regla |
|---|---|
| `assetId` | ID único |
| `kind` | `audio` o `image`; no promete imágenes usadas por componentes iniciales |
| `path` | Exactamente `assets/<assetId>.<extension>` |
| `mimeType` | Audio: `audio/wav`, `audio/mpeg`; imagen: `image/png`, `image/jpeg` |
| `byteLength` | Entero 1–52 428 800, tamaño esperado |
| `sha256` | 64 caracteres hex minúscula o `null` |
| `durationMs` | Entero 1–60 000 para audio, `null` para imagen |
| `source` | `{origin, license, attribution}` |

Extensiones permitidas: `wav`, `mp3`, `png`, `jpg`, coherentes con MIME. `origin` es `user`, `fixture` o `provider`; `license` texto 1–200 y `attribution` 0–500, sin URL navegable ni descarga automática. La procedencia no prueba derechos: se revisa al incorporar activos reales.

Antes de decodificar, inspeccionar cabeceras: imagen máximo 4096 px por eje y 16 megapíxeles; audio máximo 2 canales, 48 kHz y 60 000 ms. Aplicar máximo 100 MiB de datos decodificados por activo y timeout de inspección 10 s. Son defaults propuestos, no medidas; bloquear contenido que exceda aunque su archivo comprimido sea pequeño.

Hashes opcionales en archivo importado, pero el companion calcula SHA-256 de cada activo ingerido y lo registra en siguiente guardado. Un hash conocido distinto no se corrige silenciosamente: marcar conflicto y exigir elegir reemplazo. El tamaño tampoco se confía sin inspeccionar archivo.

Antes de preview/export, los activos consumidos deben tener hash calculado y verificado contra el snapshot; si el manifest tenía `null`, incorporar el hash como edición y pedir guardar antes de lanzar exportación. Cambios externos posteriores invalidan disponibilidad y no sustituyen contenido bajo el mismo ID durante un job.

No admitir rutas absolutas, `..`, segmentos vacíos, backslashes, `%`, query, fragmento, esquemas `http:`, `file:`, `data:` ni enlaces simbólicos. No hay GLTF, SVG externos o HTML de activos en v0.1; ampliar requiere revisión de recursos embebidos y decodificadores.

## Importar, reubicar y resolver faltantes

1. Leer hasta límite de bytes; rechazar JSON truncado, duplicados, profundidad excesiva o claves peligrosas.
2. Validar versión, estructura, rangos, referencias y límites agregados sin tocar estado activo.
3. Resolver únicamente archivos del workspace o los seleccionados por el usuario; jamás seguir una URL/ruta sugerida por contenido.
4. Inspeccionar contenido y límites de decodificación; copiar archivos aceptados a staging con nombres generados por ID.
5. Calcular hashes, preparar JSON y presentar informe de activos faltantes/incompatibles.
6. Publicar carpeta importada de forma atómica. Si usuario cancela o falla, proyecto previo sigue activo y staging no queda como proyecto válido.

Relink pide archivo concreto o carpeta elegida explícitamente; compara hash si existe, tipo y tamaño. Si es contenido distinto, confirmar sustitución, generar nuevo assetId y actualizar referencias; incrementar revisión. No buscar recursivamente todo el home ni subir activos a terceros.

Las referencias a `assetId` inexistente en manifest son errores estructurales y se rechazan. Las referencias presentes en manifest cuyo archivo falta son estado reparable. Se conserva el manifest incluso si aún no tiene consumidores.

## Versiones desconocidas y migraciones

| Situación | Resultado |
|---|---|
| `schemaVersion: 1`, estilo instalado | Abrir editable aunque incompleto |
| Schema 1, `styleId/styleVersion` desconocido | Validar envoltorio y límites; conservar visual como JSON inerte acotado, solo lectura; no preview/export/jobs |
| `schemaVersion > 1` | Rechazar activación; explicar incompatibilidad y conservar archivo original fuera del estado activo |
| Versión ausente, `0` o PRD antiguo | No asumir compatibilidad; ofrecer explicación de formato no admitido |
| Archivo corrupto | No reparación silenciosa ni sobrescritura |

En estilo desconocido solo se permite copia sin modificar del original, sin normalizar contenido ni promover claves a código. Las defensas de tamaño, profundidad, claves peligrosas y red también aplican al payload inerte. No se habilitan componentes desconocidos por parecer estructuralmente similares.

Schema 1 es la primera versión; no hay migración implementada que prometer. Una migración futura será función pura, versionada, probada con fixtures y ejecutada sobre copia, con informe y confirmación de nuevo destino. Nunca sobrescribir el único original ni hacer downgrade con pérdida de campos.

## Guardado, errores y salida

El snapshot validado se escribe a temporal hermano y se reemplaza atómicamente en el mismo volumen. La confirmación incluye `projectId`, `revision`, digest y `operationId`. No confundir recepción HTTP con commit completo.

| Caso | Resultado esperado |
|---|---|
| Permisos/disco lleno antes del reemplazo | Error visible; archivo anterior válido; dirty se conserva |
| Fallo de sync después del reemplazo | Resultado incierto visible; releer/verificar digest antes de afirmar versión guardada; sin prometer rollback |
| Edición mientras se guarda | Confirmar snapshot viejo; versión nueva continúa dirty |
| Dos escritores | Revisión/digest esperado no coincide: conflicto, sin overwrite |
| Cierre durante temporal | Reabrir último commit; temporal no se promociona solo |
| Cambio/abrir con dirty | Guardar y continuar solo tras éxito, descartar explícito, o cancelar |
| Cierre de pestaña | Advertencia nativa best-effort más navegación interna protegida; no garantía de recuperar memoria perdida |

## Ejemplos y prueba de roundtrip

- [empty-project.json](examples/empty-project.json): proyecto válido sin escenas, activos ni duración; prueba obligatoria de M1.
- [storyboard-project.json](examples/storyboard-project.json): 12 segundos, dos escenas, cámara y palabras manuales, sin voz; incluye mismo auto y capas reutilizados para regresión de continuidad. Visuales son datos para M2, no prueba de renderer existente.

Ambos son completos como documentos schema 1, no fragmentos. No requieren binarios externos ni claves. El segundo contiene bindings de palabras manuales sin audio y `approval: null`; antes de exportar en silencio en M2 exige revisar/aprobar/guardar, no afirma voz ni aprobación disponibles.

Roundtrip requerido: parse → validate → guardar → cerrar todo → abrir → validate → comparar todos los campos de contenido, IDs, seed, revisiones, nulls y arrays. El serializer no cambia revisiones ni timestamps por abrir/guardar sin edición. Comparar semántica JSON, no orden de claves o whitespace.

Añadir fixture de borrador con una escena `visual: null`, palabras vacías y audio faltante en manifest durante M1; conservarlo y relinkear en prueba real. Los dos ejemplos entregados no sustituyen ese test ni un schema ejecutable.
