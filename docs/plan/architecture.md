# Arquitectura local con persistencia primero

Baseline propuesto: **React + TypeScript + Vite**, companion Node.js local, composición Three.js + DOM/SVG y exportación por Chromium/Playwright + FFmpeg. No requiere base de datos ni servicios remotos. Es una selección técnica revisable, no una aprobación adicional del usuario ni una implementación existente.

## Decisiones y alternativas descartadas por ahora

| Decisión | Beneficio | Costo / condición |
|---|---|---|
| Companion local como ruta principal de archivos | Escritura confirmada y reemplazo atómico controlable | El usuario debe iniciar proceso local |
| React/TS/Vite para estudio | UI y contratos tipados, desarrollo local sencillo | Mantener runtime de render aislado de estado UI |
| Three.js para primer estilo | Cámara y escenas 3D reales | Calidad depende de dirección artística y fixtures, no solo librería |
| DOM/SVG para overlays | Tipografía y datos editables | Capturar composición completa, no canvas aislado |
| Chromium/Playwright + FFmpeg | Frames explícitos y mux de audio local | Pipeline propio, recursos y licencias de distribución por revisar |
| Sin Remotion, Motion Canvas ni Theatre en baseline | Evita solapar relojes y añadir una licencia comercial obligatoria de Remotion | Si un prototipo exige reemplazo, comparar un solo motor alternativo con evidencia |
| JSON + activos relativos | Portable, inspeccionable y suficiente para v0.1 | Manejo explícito de activos faltantes y conflicto de archivo |

Usar una línea **Node.js LTS soportada al iniciar M1**, verificar estado en la fuente oficial y fijar versión exacta después en entorno y CI. Este plan no inventa una versión vigente ni obliga a instalarla hoy. Elegir versiones compatibles y lockfile durante desarrollo, sin actualizaciones implícitas al abrir un proyecto.

## Topología y límites de confianza

```text
Navegador del usuario
  Studio: edición / validación / preview
       │ mismo origen + token efímero
       ▼
Companion Node (loopback, un workspace autorizado)
  ProjectStore ─ JSON + assets/ en disco
  JobManager ─ snapshot inmutable + directorio temporal por job
       ├─ RenderWorker ─ Chromium aislado ─ CompositionRuntime
       ├─ EncoderWorker ─ FFmpeg / ffprobe
       └─ ProviderAdapters (M3, red solo por aprobación explícita)
```

El companion sirve los artefactos del estudio; en desarrollo, el origen de Vite debe estar explícitamente autorizado y sin proxy de archivos arbitrarios. No escuchar en `0.0.0.0`. No habilitar CORS comodín.

El render usa una página interna mínima, no la UI del editor. Carga únicamente snapshot validado y activos identificados por el companion. No recibe permisos de archivos generales, rutas elegidas por JSON ni credenciales de proveedores.

## Módulos propuestos y responsabilidad

Estos son nombres de responsabilidad para implementación futura, no archivos creados por el plan.

| Módulo | Recibe | Entrega / no hace |
|---|---|---|
| `ProjectSchema` | Bytes JSON acotados | Modelo validado; no evalúa cadenas |
| `ProjectStore` | Modelo, revisión esperada, handle local | Commit de disco o error; no renderiza |
| `AssetStore` | Archivo elegido explícitamente | ID, ruta generada y metadatos; no descarga URLs |
| `EditorState` | Acciones de usuario | Snapshot editable y estado dirty; no es fuente de verdad de jobs |
| `StyleRegistry` | `styleId`, `styleVersion` | Validador y renderer de estilo instalado |
| `EntityRegistry` | Definiciones inmutables y referencias versionadas | Identidad compartida; estado/rig/material mutable aislado por instancia |
| `CompositionRuntime` | Snapshot, índice de frame | Estado visual y señal de frame listo |
| `JobManager` | Operación, snapshot y digest | Estados, cancelación y resultado asociado a revisión |
| `RenderWorker` | Snapshot listo | Frames con backpressure; no solicita IA |
| `EncoderWorker` | Frames y audio local | MP4 temporal verificado; no ejecuta shell de usuario |
| `ProviderAdapter` | Solicitud aprobada y secreto de sesión | Propuesta validable; nunca código ejecutable |

Usar un único paquete compartido de schema/timeline entre estudio y companion. La estructura física de paquetes se decide en M1 según la menor configuración que soporte esas fronteras; no hace falta monorepo complejo.

## Flujo de persistencia desde M1

1. El usuario elige un workspace mediante el arranque local; no se entrega al navegador acceso al home completo.
2. Nuevo proyecto crea modelo en memoria con `schemaVersion: 1`. Aún no existe un archivo.
3. Guardar envía snapshot y revisión esperada al companion autenticado.
4. Companion valida otra vez, incorpora activos ya importados y escribe `project.json.tmp-<operationId>` en la misma carpeta.
5. Fuerza vaciado del archivo, cierra y reemplaza `project.json` mediante rename atómico del mismo volumen; sincroniza directorio donde sea soportado.
6. Solo después de éxito devuelve revisión y digest confirmados. La UI muestra «Guardado» únicamente para ese snapshot.
7. Si hubo edición durante el guardado, la revisión confirmada queda guardada pero el documento actual sigue «Modificado».

Para Guardar copia, preparar carpeta temporal hermana y publicarla mediante rename al completar; no dejar una copia aparentemente completa tras fallo. Nunca sustituir una carpeta existente sin resolución explícita de conflicto.

Un solo escritor por proyecto y comparación de digest/revisión de disco evitan sobrescritura silenciosa entre pestañas o edición externa. Un conflicto ofrece recargar o guardar como copia; no «último gana».

El lock cubre comprobar digest, escribir y reemplazar; no basta comprobar antes de entrar al lock. Una edición externa no cooperativa se detecta antes del commit en lo posible, sin prometer exclusión universal de herramientas ajenas. El contrato soportado es un companion escritor por workspace; segundo companion se rechaza.

Atomicidad visible significa que un lector observa el archivo anterior o el nuevo completo, no durabilidad absoluta ante corte de energía/caída del sistema operativo. `sync` de archivo y directorio depende de plataforma/filesystem; probarlo donde sea soportado y documentar la limitación. No afirmar que `writeFile + rename` garantiza persistencia física en todos los dispositivos. Si falla una sincronización tras rename, reportar resultado incierto y verificar digest al reabrir, sin repetir o afirmar rollback inexistente.

Al abrir se valida en una zona temporal antes de reemplazar el estado activo. Cancelar, fallar o detectar versión futura no descarta el documento anterior. Los fallos de cuota, permisos, desconexión y proceso interrumpido mantienen dirty y datos en memoria; reintentar es seguro por `operationId` y revisión esperada.

El guardado es explícito en v0.1; no prometer autosave o recuperación de cambios no confirmados. Un cierre inesperado conserva el último guardado, no necesariamente los últimos cambios. Al arrancar, temporales incompletos se reportan y no se promocionan automáticamente.

## Captura: un reloj, dos consumidores

La unidad de almacenamiento es **milisegundos enteros**. Los cálculos por frame no redondean el reloj a un entero en cada paso:

```text
fps = 30
totalFrames = ceil(durationMs × fps / 1000)
frameIndex ∈ [0, totalFrames)
timeMs = frameIndex × 1000 / fps
sceneTimeMs = timeMs − scene.startMs
intervalo activo = [startMs, endMs)
```

La duración total se restringe a múltiplos de 100 ms en v0.1; así tiene número entero de frames a 30 fps. Edición de fronteras de escenas usa el mismo paso de 100 ms. Tiempos de palabras/cámara continúan en ms enteros sin ese snap.

El preview puede dibujar a su frecuencia disponible, pero al pausar/seek muestra el frame más cercano de la misma función de evaluación. Su reloj sigue audio durante reproducción y se cuantiza para render visual; exportación nunca depende de tiempo de pared.

- `evaluate(snapshot, frameIndex)` calcula poses, cámara, subtítulos y rótulos desde cero.
- Seed persistida y PRNG indexado por escena/objeto; prohibidos `Math.random()`, fecha del sistema, física libre o acumulación de deltas en composición.
- Cámara interpola keyframes; animaciones allowlisted evalúan fase normalizada. Misma entrada no depende del historial de seek.
- Fuentes y activos deben estar listos antes de `frameReady`; error explícito si falla su carga.
- Layout de salida fijo, viewport 1080×1920, escala de dispositivo 1; preview escala contenedor sin cambiar coordenadas de composición.
- No CSS animations de tiempo libre: transformaciones y opacidad se asignan por tiempo. Deshabilitar animaciones en screenshot no sustituye el reloj.
- Captura de raíz de composición mediante screenshot de elemento, incluyendo WebGL + DOM/SVG; sin barra de herramientas ni cursor.
- Frames PNG sin pérdida hacia FFmpeg con backpressure y sin carpetas de miles de imágenes por defecto.

La determinación garantizada se verifica dentro de la misma versión fijada de runtime/navegador y máquina. Entre GPU, fuentes o versiones distintas puede haber diferencias de rasterización: comparar estado exacto y píxeles con tolerancia documentada, no prometer igualdad binaria universal.

## Registro de estilos y lenguaje visual

Cada entrada instalada declara `id`, `version`, esquema de props, capacidades, renderer y fixtures. Solo `stylized-3d@1` está en alcance inicial. Otros estilos se registran como concepto futuro fuera del conjunto renderizable, no como alias del primer estilo.

Los generadores de identidad del primer estilo son una gramática pequeña: `character`, `car`, `rockLayers`, `arrow`, `label`, con animaciones `idle`, `pulse`, `reveal`, `none`. Props de identidad cerradas viven en `entities`, no se duplican en escenas. Instancias solo referencian definición/version y transformaciones permitidas. No hay importación de JSX, scripts, shaders o HTML libre producidos por IA.

El registro guarda seed y versión del generador por identidad; no usa seed nueva por escena. Definiciones son inmutables en runtime; animación/pose y materiales mutables se aíslan por instancia, aunque compartan geometría inmutable. Escalas heredadas no uniformes están prohibidas. [Continuidad](visual-continuity.md) define alcance, variantes e invalidación sin exigir editor 3D/rig complejo.

El primer estilo admite paletas diurna y oscura, perspectiva y movimiento de cámara. Eso no lo convierte en múltiples estilos completos. SVG/DOM complementa la escena; futuros estilos vectoriales necesitarán su propio contrato y pruebas.

## Voz, subtítulos y edición

La narración es un activo de audio por escena y se concatena sobre la timeline global. Timestamps de palabras son locales a la escena. Importar alineación de un proveedor exige conversión explícita de su unidad a ms enteros y validación de orden/duración.

La vigencia sobrevive al guardado mediante `scene.mediaBindings` y `project.approval`, definidos en [formato](project-format.md#vínculos-portables-y-aprobación-editorial). Cambiar texto/locale hace obsoletos voz y palabras vinculadas al anterior; no elimina archivos ni referencias. Cámara/estilo/entidad invalidan frames y aprobación, no voz. Reordenar cambia ensamblaje, no alineación local. Cambiar duración revalida ajuste sin exigir regeneración si cabe. Seleccionar audio/offset distinto exige revisar alineación; gain no altera timings. Los bindings viejos se conservan, nunca se actualizan automáticamente para simular vigencia.

Una pista seleccionada debe caber en su escena: nunca estirar, cortar ni ajustar voz automáticamente. Resolver con cambio de duración, reemplazo o recorte explícito validado en una iteración futura. En v0.1 se bloquea exportación con voz excedida. Audio más corto se completa con silencio.

## Jobs, revisiones y reintentos

Los jobs no forman parte del JSON de proyecto. El companion conserva un journal local sanitizado fuera del bundle portable; al reiniciar marca `queued/running` como `interrupted`. No reanuda gastos ni procesos automáticamente. A diferencia de ese journal, bindings de medios y aprobación son metadatos editoriales portables, no estados de ejecución; reabrir/importar recalcula su vigencia sin depender de un job existente ni llamar red. Importar externamente limpia aprobación con aviso, conserva medios/bindings y exige revisión editorial nueva.

| Campo de job | Contrato |
|---|---|
| `jobId` / `attemptId` | Nuevos por intento; nunca reutilizar temporales fallidos |
| `operationKey` | Digest de tipo + entrada normalizada + versiones; permite detectar duplicados |
| `projectId`, `projectRevision` | Snapshot de origen |
| `sceneIds`, `sceneRevisions` | Dependencias por escena |
| `inputDigest` | Hash de dependencias efectivas, no de secretos |
| `status`, `progress`, `errorCode` | Progreso real por frames/etapas; mensaje sanitizado |
| `resultState` | `current` o `stale`, calculado al finalizar y al editar |

Cada edición persistente incrementa `revision` del proyecto; cualquier cambio de contenido de una escena incrementa su `revision`. El planificador usa además digests de texto, voz, subtítulos y visuales para no invalidar trabajo independiente por una revisión de escena más amplia.

Un job aplica resultados solo si siguen coincidiendo sus dependencias. Si no, archiva propuesta como obsoleta y ofrece revisar; jamás sobrescribe. Una exportación puede terminar de su snapshot anterior, pero queda identificada como versión anterior.

El recibo local de exportación incluye digest de contenido, revisión, versión de renderer, modo explícito `withVoice`/`silent`, subtítulos habilitados, hash de MP4 y selección de activos verificados. El MP4 no se llama «actual» solo porque exista: comparar recibo con contenido, opciones y activos vigentes. Fuera del workspace, sin recibo verificable, es archivo externo sin vigencia acreditada. La aprobación editorial nunca sustituye autorización nueva de proveedor ni reanuda trabajos. El preflight de exportación exige aprobación coincidente y bindings actuales de los medios consumidos, sin impedir guardar borradores obsoletos.

Cancelar vacía cola correspondiente, señala abort a adaptador, cierra pipes y termina solo hijos propios; tras 3 segundos de gracia se fuerza terminación. Se borra únicamente el temporal del job por ruta interna verificada. Resultado parcial nunca aparece como MP4 terminado.

Reintentar crea intento nuevo y requiere una nueva acción. El servidor devuelve el mismo recibo ante repetición de un `operationId` de guardado confirmado. Para proveedores, una clave de idempotencia solo se usa si el proveedor la soporta documentalmente. Un timeout después de envío se muestra «resultado remoto incierto»; no se repite automáticamente una solicitud posiblemente cobrada.

## Presupuestos y contención

Defaults propuestos para implementar y medir, **no mediciones realizadas**:

| Control | Valor / acción |
|---|---|
| Proceso de render | 1 Chromium worker y 1 encoder por job; sin procesos por escena |
| Tiempo de preparación | 30 s para fuentes/activos; fallo si no están listos |
| Frame | 10 s máximo; error y aborto del job |
| Tiempo total | 10 min por exportación v0.1; cancelar con diagnóstico, no bucle de reintento |
| Temporales | Máximo 2 GiB/job y espacio libre previo de 3 GiB |
| Buffers | Hasta 2 frames crudos/PNG pendientes; pausar productor por backpressure |
| Memoria | Objetivo de worker combinado ≤2 GiB RSS; watchdog a 2 GiB con aborto; límite duro OS si disponible |
| Encoder | Máximo 2 threads configurados; validar salida antes de publicar |
| Red de renderer | Denegar todo salvo origen interno y rutas de activos del snapshot |

El watchdog RSS es un mecanismo de aborto, no una garantía de sandbox de memoria; documentar capacidad real del sistema operativo. Si no se puede medir árbol completo y detener hijos, gate de render no se considera cumplido. El disco se mide durante trabajo y al recibir chunks, no solo al comenzar.

Objetivos de experiencia a medir en máquina de referencia declarada: abrir JSON sin activos ≤1 s, guardar proyecto pequeño ≤1 s y seek de fixture ≤200 ms tras carga. Si no se cumplen, registrar números y ajustar diseño/límites antes de anunciar rendimiento. No se promete exportación en tiempo real.

## Seguridad local

- Token de sesión efímero, comprobación estricta de `Origin` y `Host`, protección CSRF y rechazo de DNS rebinding. Token no se persiste ni va en URLs/logs.
- Handles opacos de proyectos/activos; endpoints no aceptan rutas del sistema. Workspace autorizado se resuelve canónicamente; rechazar symlinks y escapes.
- Parse JSON sin eval, validación cerrada, límites previos a procesamiento pesado; rechazar claves `__proto__`, `constructor`, `prototype` en cualquier nivel.
- Texto como texto, no `innerHTML`; URLs, CSS libre, expresiones y comandos no son campos del schema.
- Tipos MIME verificados por contenido, extensión allowlisted y decodificación con límites. SVG/HTML externos y GLTF con recursos externos no se admiten en v0.1.
- Ejecutables confiables fijados por instalación; spawn con argumentos separados, `shell: false`, sin interpolar títulos ni rutas importadas en comandos.
- Renderer sin downloads, popups, navegación libre ni acceso a red de proveedores; CSP estricta y sin código aportado por usuario.
- Sin credenciales en proyecto, exportación, journal ni diagnóstico. Logs estructurados por IDs y códigos, no cuerpos de API, headers ni texto completo del guion.
- M3: credenciales en memoria de sesión por defecto. Un almacén del sistema operativo sería una capacidad futura opt-in a evaluar, no requisito inicial ni lectura de secretos existentes. No inspeccionar `.env` personales.

## Límites hacia un SaaS futuro

Un servidor local con token no es una plataforma multiusuario. Publicarlo exige diseño nuevo de identidad, tenancy, permisos de activos, colas distribuidas, aislamiento de ejecución, cuotas, almacenamiento y facturación. No exponer el companion a Internet ni trasladar su confianza de workspace al navegador remoto.

Los adaptadores y snapshots permiten evolución sin prometer cloud. Un JSON nunca autoriza red, instalación o pago; abrirlo no dispara jobs.

## Documentación y verificaciones pendientes

- Context7 consultado durante planificación: `/microsoft/playwright`, screenshot de elemento y viewport/deviceScaleFactor. Confirma API de captura de elemento; no prueba nuestra composición ni determinismo.
- [Playwright screenshots](https://playwright.dev/docs/screenshots): base documental para capturar un contenedor.
- Verificación documental independiente compartida: [page.screenshot](https://playwright.dev/docs/api/class-page#page-screenshot), [Three.js WebGLRenderer](https://threejs.org/docs/#WebGLRenderer), [AnimationMixer](https://threejs.org/docs/#AnimationMixer), [Node rename](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath) y [filehandle.sync](https://nodejs.org/api/fs.html#filehandlesync). Captura visible no implica determinismo de JS/WebGL; evaluar mixer por tiempo no controla simulaciones arbitrarias. Rename y sync no son promesa de durabilidad absoluta.
- [Node.js releases](https://nodejs.org/en/about/previous-releases): verificar LTS al comenzar M1; no se consultó una tabla de versiones en vivo aquí.
- [Three.js](https://github.com/mrdoob/three.js), [Vite](https://github.com/vitejs/vite), [React](https://github.com/facebook/react): referencias oficiales de candidatos, no verificación de APIs concretas en este plan.
- [FFmpeg](https://ffmpeg.org/legal.html): revisar build, codecs y obligaciones antes de redistribuir binarios. Herramientas elegidas no implican contratar servicios ni activar fees.

La revisión de licencias de activos, fuentes y binarios queda como gate. Ninguna afirmación documental sustituye las pruebas reales previstas en delivery.
