# Trabajo restante listo para delegación controlada

**No ejecutar ahora.** Base auditada `cbfc125`: M1/G1 técnico cerrado + V01 revisado; 9/27 unidades completas, **18 pendientes**, E05 condicional. Estas tarjetas preparan ejecución posterior y revisión fresca, no declaran terminado el plan ni autorizan instalaciones, media nativa, proveedores, gastos, commits o push. [Delivery](delivery.md) conserva hitos/evidencia; este archivo contiene instrucciones ejecutables, no un segundo PRD.

## Contrato común de cada tarjeta

Cada tarjeta hereda este checklist, además de su aceptación específica:

- [ ] Leer solo entradas indicadas y AGENTS aplicables; verificar base/estado y preservar trabajo ajeno.
- [ ] Registrar test rojo real (nombre, comando, salida y causa esperada); no fallo de sintaxis/dependencia como prueba de comportamiento.
- [ ] Implementar únicamente comportamiento/paths asignados, con errores y límites; actualizar contrato si un hallazgo lo exige antes de consumidores.
- [ ] Ejecutar comando enfocado, regresión pertinente y typecheck cuando esté autorizado. Reportar conteos, skips, recursos, versiones, archivo de evidencia y limitaciones; nunca reutilizar evidencia histórica como rerun.
- [ ] Demostrar oráculo real cuando corresponde: bytes/disco/reinicio, PID/pipes, PNG decodificado, MP4/PTS/escucha; un mock/call-count no lo sustituye.
- [ ] Guardar descubrimientos/decisiones/bugs importantes en Engram, proyecto `molecula_studio`; entregar diff revisable y riesgos, sin commit salvo autorización separada.
- [ ] Revisión independiente fresca, sin autoaprobación; resolver bloqueantes y repetir prueba antes de cerrar. Checklists no se marcan por haber escrito código.

### Comandos y recursos referenciados

Se indican para **futuras** ejecuciones, no se ejecutaron en esta tarea. `U(path)` = `node --test <path>` para test `.test.ts`; `I(path)` igual, con carpetas temporales de prueba propias y procesos reales si se indica. `T` = `npm run typecheck`. `D` = `git diff --check`. `B(path)` = `node --test <path>` E2E después de build autorizado (`npm run build:studio`); usar Lightpanda DOM-only y Chromium cuando layout/visibilidad/WebGL importe. No instalar ni construir automáticamente para «resolver» falta de entorno. `M` = harness multimedia propuesto por V05: comando Node de test enfocado más ejecutables locales confiables Chromium/FFmpeg/ffprobe **solo tras D03**, sin descargas automáticas. Cada tarjeta define su test concreto; no se inventa un npm script inexistente. Evidencia de tests permanece en temporal aprobado o ubicación local acordada, sin binarios generados en git por defecto.

U/I puros no requieren red, GPU ni ffmpeg. Tests nuevos propuestos se crean al ejecutar la tarjeta, no existen hoy. La ausencia de D03 bloquea el oráculo nativo correspondiente, no autoriza reemplazarlo por mocks ni impide completar y revisar una subtarjeta pura independiente.

## Registro de decisiones y autorizaciones

| ID / responsable | Decisión genuina o gate | Antes de | Estado y salida necesaria |
|---|---|---|---|
| D01 · titular de derechos + responsable producto, con verificación técnica | Archivo local de fuente heavy para builtin-sans-heavy-v1 y voz fixture con licencia/procedencia | V03a fuente real; V04a audio; V05/G2/H04 | Pendiente. Candidato técnico: fuente sans pesada con licencia redistribuible, p. ej. Noto Sans, **sin afirmar adquisición/aprobación**. Elegir archivo exacto, hash, licencia/atribución y permiso de uso. Audio narrado 2 escenas/12 s en español con permiso verificable; no usar TTS remoto ni generar media en esta intervención. Tests puros usan datos sintéticos, no certifican derechos/escucha. |
| D02 · responsable producto | Dirección visual/auditiva de fixture y aceptación estética | V07 baseline visual final y V08/G2 | Pendiente. Geometría/cámara/paletas técnicas acotadas de componentes son defaults de prototipo; revisión humana puede pedir ajustes dentro del catálogo. Registrar frames/voz revisados y decisión, sin prometer copia de referencias. No bloquea evaluación/registry puros. |
| D03 · usuario/coordinador según permisos de herramientas | Autorizar instalación/adición de Three.js, acceso a binarios/versiones y ejecución nativa de Chromium/FFmpeg/ffprobe | V02c engine si requiere dependencia nueva, V03 captura y V05–V08/H03 | No otorgado por este plan. Registrar alcance concreto, ejecutables confiables/versiones, recursos y licencias, sin gasto/red implícitos. Playwright-core instalado no prueba navegador ni codec disponible. No eludir aprobación formal del harness. |
| D04 · usuario + responsable integración | Proveedor/capacidad/modelo/credencial de sesión/presupuesto y permiso por operación | E05 solamente | Opcional y pendiente. Sin proveedor elegido, términos/costo/idempotencia verificados ni autorización no ejecutar. E03/E04 fake y G3/v0.1 offline no dependen de E05. No elegir modelo por precio por cuenta propia. |
| D05 · coordinador + revisor | Habilitar ejecución funcional después de revisión documental fresca | C01 y cualquier tarjeta de código | Pendiente en esta intervención solo documental. Conservar no-push/no-deploy/no-spend; decidir una tarjeta concreta y propiedad. No pedir aprobación humana por decisiones rutinarias ya acotadas ni por conteo de líneas. |

Retención, DTO, PRNG, layout, queue y cache son defaults técnicos **seleccionados como diseño** en [API](api-contracts.md), no preguntas abiertas que se delegan al usuario. Si una prueba refuta un default, proponer cambio pequeño con evidencia y actualizar contrato antes de continuar. Recursos/estética/derechos sí conservan sus gates. No todo el backlog está desbloqueado hoy.

## DAG y unidades de cierre

Los nodos de la tabla son aliases de cierre: una unidad se cierra solo cuando todas sus subtarjetas y revisión están completas. C01 es preparación contract-first dentro del trabajo restante, no una unidad 28 ni producto ya implementado. G1 y V01 son entradas completas; F05 existe. G2 = V08; G3 = E01/E02/E03/E04/E06 completos (E05 solo si se autoriza); G4 = H05. No hay ciclos ni dependencia del proveedor opcional para offline.

| Unidad | Dependencia de unidad preservada | Tarjetas en orden |
|---|---|---|
| V02 | V01 | C01 → V02a → V02b → V02c |
| V03 | V01, V02 | V03a → V03b → V03c |
| V04 | F05, V01 | V04a → V04b (en paralelo a V02/V03 si propiedad independiente) |
| V05 | V02, V03, V04 | V05a → V05b → V05c → V05d |
| V06 | V05 | V06a → V06b → V06c → V06d |
| V07 | V03, V04, V05, V06 | V07a |
| V08 | V07 | V08a; cierra G2 |
| E01 | G2 | E01a → E01b → E01c |
| E02 | E01, V06 | E02a |
| E03 | E02 | E03a → E03b |
| E04 | E03 | E04a → E04b |
| E05 | E04, D04 | E05a opcional |
| E06 | E02, E03, E04 | E06a → E06b |
| H01 | G3 | H01a → H01b |
| H02 | E01, F06 | H02a |
| H03 | V08, E01 | H03a |
| H04 | H01, H02, H03 | H04a → H04b |
| H05 | H01, H02, H03, H04 | H05a |

Las dependencias **exactas de tarjeta**, incluyendo C01 y gates externos, se especifican a continuación. Un alias de unidad en una tarjeta significa todas sus tarjetas; no tomar «en paralelo» como autorización para ignorarlo.

## C01 — Contratos antes de consumidores

**Depende:** V01, D05. **Entradas:** [API: Diseño compartido](api-contracts.md#diseño-compartido-previo-a-consumidores--c01), «Revisiones, digests y recibos existentes», schema/types, digests y timeline; arquitectura «Presupuestos y contención». **Dueño:** nuevos `src/shared/contracts/{runtime,jobs,providers}.ts` y validadores/tests asociados. Única integración compartida: guard de revisión en `src/companion/store/project-store.ts` por coordinador, después de test rojo y revisión; no editar HTTP, schema 1 ni Editor.

**Comportamiento:** materializar DTO/métodos/error unions documentados, límites de strings/arrays/bytes y validadores cerrados de frontera; separar type-only/funciones puras de Node/React. Definir fixtures de mensajes para runtime, job, receipt, request/proposal y transiciones permitidas. Añadir builders de test sin red/secreto. Verificar riesgo estático de revisión de save: rechazar antes de commit payload.revision distinto de expectedRevision+1 con invalid-argument, preservando replay idéntico y anterior intacto; no normalizar payload silenciosamente. Esta corrección futura es requisito de consistencia, no fix ya realizado. Contrato no instala engine ni arranca workers.

**Primer rojo/oráculo:** `tests/unit/contracts.test.ts`: rechazar campo path/URL/token, índices/rangos imposibles, receipt incompleto y proposal con escena fuera del snapshot; roundtrip válido, sin cast que acepte unknown. `tests/integration/save-revision-contract.test.ts`: enviar revisión válida estructuralmente pero distinta de siguiente debe rechazar, bytes/revisión anterior intactos; caso correcto y replay mantienen archivo/recibo coincidentes. Si no se reproduce, revisar hallazgo antes de cambiar código. **Comandos:** U contracts, I save-revision-contract, T/D. **Cierre específico:** [ ] contrato compartido y casos negativos por DTO; [ ] guard/replay verificados en disco; [ ] revisor contrasta formato/API y ninguna ruta prometida como disponible. Tier técnico: alto por fronteras compartidas; puede revisarse en dos slices secuenciales, no dos dueños simultáneos del store.

## M2 — Siete unidades restantes

### V02a — Evaluación visual pura y PRNG indexado

**Depende:** C01. **Entradas:** API «Evaluación y catálogo», formato «Visual stylized-3d@1», V01/timeline y ejemplos storyboard. **Dueño:** nuevos `src/composition/evaluate.ts`, `random.ts`; `tests/unit/composition-evaluate.test.ts`. No tocar reloj V01/schema/HTTP/React ni instalar Three.js.

**Comportamiento:** `evaluateVisual` desde frame, interpolación cámara/hold, movimientos versionados idle/pulse/reveal, palabra por intervalo y datos de overlay, PRNG especificado por canal/índice. Valores nuevos, sin referencias mutables al snapshot. Cámara degenerada y rango inválido fallan explícitamente; borrador visual null devuelve error recuperable de preparación, no «listo» negro.

**Primer rojo/oráculo:** mismo frame tras secuencia 0→final→mitad→0 da igualdad profunda; puntos calculados a mano para cámara 0/mitad/final, sine/pulse y caption borde; vectores dorados PRNG con bytes UTF-8/FNV-1a/avalanche de cálculo independiente, no comparar función consigo misma. Snapshot congelado, Math.random/Date prohibidos por test. **Comandos:** U archivo, T/D. **Cierre:** [ ] estado exacto con tolerancia numérica solo donde trigonometría lo requiere, [ ] seeds de entidad no reseedeadas por escena, [ ] sin prueba visual declarada. Tier estándar con revisión alta del oráculo.

### V02b — Registry e identidades aisladas

**Depende:** V02a. **Entradas:** API «Evaluación y catálogo», [continuidad](visual-continuity.md) «Garantías», schema Entity/Component. **Dueño:** nuevos `src/composition/registry.ts`, `entities.ts`, `tests/unit/entity-registry.test.ts`. Sin Editor ni geometría Three.js.

**Comportamiento:** resolución exacta stylized-3d@1/procedural-v1@1, definición congelada/cache por identidad y versión; factory de instancia con estado mutable propio, validación de referencias y dispose idempotente. Versiones desconocidas/override de identidad no hacen fallback. Interfaces permiten backend de primitivas sin WebGL en tests.

**Primer rojo/oráculo:** dos instancias comparten solo descriptor inmutable, mutar color/pose de primera deja segunda/base idénticas; versión/seed distintos generan cache keys distintas; desconocido falla antes de construir. Variante mantiene lineage/base. **Comandos:** U archivo, T/D. **Cierre:** [ ] ownership de memoria explícito, [ ] ciclos/referencias ya rechazados no se relajan, [ ] aislamiento probado por valores, no solo dos IDs. Tier estándar.

### V02c — Catálogo geométrico procedural acotado

**Depende:** V02b, D03 para engine/dependencia. **Entradas:** componentes UX «Defaults técnicos visuales», formato entities/Visual; arquitectura registry. **Dueño:** nuevos `src/composition/catalog/` (character/car/rockLayers/arrow/label), backend `three-runtime.ts`, `tests/unit/catalog-geometry.test.ts`. Cambio de package/lock únicamente coordinador bajo autorización separada; nunca un worker lateral.

**Comportamiento:** cinco generadores de primitivas, ratios fijos versionados, modelo ajustado una vez a proportions; runtime instancia solo escala uniforme. Cabeza/tronco y ruedas/piezas dentro de dimensiones de diseño; luz/paleta no muta identidad. Etiqueta es ancla de overlay, no HTML libre. Guardar valores de ratios del diseño en test: car cuerpo 1×0.45×1, cabina 0.5×0.35×0.7 y ruedas con radio 0.12 del alto base; character cabeza 0.25 de alto, tronco 0.4, piernas 0.35; ajuste final al bounding box solicitado. Cambio futuro requiere versión/goldens, no retoque invisible.

**Primer rojo/oráculo:** bounding boxes en espacio de modelo iguales a proportions, ratios de piezas y matriz heredada uniforme bajo dos cámaras/poses; mutar material/rig no contamina otra instancia, dispose libera recursos contados. Tests geométricos sin render prueban datos del engine real, no sustituyen V07. **Comandos:** U archivo, T/D; sin navegador obligatorio para cierre geométrico. **Cierre:** [ ] cinco tipos y ambas paletas, [ ] versión fija y aislamiento, [ ] gate D03 registrado si se añadió lib, [ ] estética sigue pendiente D02. Tier alto de geometría/ownership.

### V03a — Composición y ciclo prepare/frameReady

**Depende:** V02, C01; D01 fuente y D03 para verificación render real. **Entradas:** API «Runtime y readiness», arquitectura «Captura», componentes Preview. **Dueño:** nuevos `src/composition/runtime.ts`, `studio/src/components/Preview.tsx`, `tests/unit/runtime-lifecycle.test.ts`, `tests/e2e/composition.e2e.ts`. No HTTP ni Editor: mount de fixture de prueba bajo harness, integración compartida coordinada después.

**Comportamiento:** preparar snapshot inmutable, resolvedor de recursos por ID, fuente versionada, canvas+DOM/SVG en raíz 1080×1920; renderFrame serializado/readiness correlacionada y dispose. Error carga/timeouts no publica ready ni anterior; sin red remota.

**Primer rojo/oráculo:** unidad prueba concurrencia/dispose/correlación; Chromium real retrasa fuente/asset y captura solo después de carga, compara estado/frame y píxeles para detectar frame previo. Fuente faltante falla, nunca fallback silencioso. **Comandos:** U lifecycle, B composition con Chromium, T/D bajo gates. **Cierre:** [ ] captura contiene canvas y texto DOM, [ ] fuentes/assets cargados antes de ready, [ ] consola/runtime explícitos sin errores no esperados. Sin D01/D03: trabajo parcial, no PASS V03. Tier alto.

### V03b — Cámara, overlays y zonas seguras

**Depende:** V03a. **Entradas:** formato cámara/captionStyle, componentes defaults, API EvaluatedFrame. **Dueño:** nuevos `src/composition/overlays.ts`, `camera.ts`, CSS de composición propio; `tests/unit/overlay-timing.test.ts`, `tests/e2e/overlays.e2e.ts`. No modificar CSS global del editor en paralelo.

**Comportamiento:** aplicar cámara evaluada, label proyectado, caption/ancla/margen/emphasis; texto plano y wrap dentro de zona útil. Fuera de volumen/overflow de texto genera diagnóstico; no truncar ni recolocar cámara persistida. Misma función en preview/capture, sin CSS animation libre.

**Primer rojo/oráculo:** en borde endMs desaparece palabra anterior, label incluye texto hostil literal; Chromium mide rectángulos contra safeMargin en 1080×1920 y verifica canvas/texto visibles sin oclusión del caso fixture; capturas de upper/center/lower y texto largo. **Comandos:** U timing, B overlays Chromium, T/D. **Cierre:** [ ] extremos de cámara y palabras probados, [ ] geometría visible y legibilidad verificadas con evidencia, [ ] no afirmar D02 aprobada por pasar bounds. Tier estándar; revisión visual especializada.

### V03c — Transport y reloj de preview

**Depende:** V03b, V04a (audio fixture para prueba con voz). **Entradas:** arquitectura «Captura»/«Voz», componentes Transport, V01. **Dueño:** nuevos `studio/src/components/Transport.tsx`, `studio/src/preview-clock.ts`, `tests/unit/preview-clock.test.ts`, `tests/e2e/transport.e2e.ts`. Sin Editor compartido ni pipeline de exportación.

**Comportamiento:** play/pause/seek por frame más cercano, audio maestro durante reproducción con voz vigente; silent reloj monotónico solo para elegir índice, no integrar poses por deltas. Seek inverso pausa/cancela petición vieja, no publicar frame tarde; audio solo tras gesto y vigente.

**Primer rojo/oráculo:** reloj inyectado prueba cuantización y endpoint sin drift; Chromium con audio real verifica tiempo/seek/pausa y estado visual coincidente al pedir frame directo; captura frontera tras seek, no call count. Stale/sin audio permite silent y no reproduce medio viejo. **Comandos:** U clock, B transport Chromium bajo D03, T/D. **Cierre:** [ ] teclas/slider por frame, [ ] no autoplay, [ ] pausa/seek usan mismo estado exportable. Tier estándar.

### V04a — Fixture, derechos y vínculos de medios

**Depende:** F05, V01, C01; D01 para incorporar audio real. **Entradas:** formato «Vínculos portables»/manifest, API aprobación única, ejemplos storyboard. **Dueño:** nuevos `tests/fixtures/audiovisual/` (metadatos y archivo solo autorizado), `tests/integration/fixture-bindings.test.ts`; no ejemplos originales ni schema/Editor. Binario se añade a git solo con autorización explícita del coordinador.

**Comportamiento:** fixture local de 12 s/dos escenas de 6 s: personaje/auto y explicación geológica/auto reutilizado, con cámara/captions y voz local por escena con procedencia/hash/licencia, alineación ms local revisada. Definición del auto idéntica entre escenas y cámaras distintas dentro del contrato. Preparar silent/withVoice como elecciones explícitas del mismo contenido; conservar medios aunque no se consuman. No sustituir ejemplos originales ni declarar esta puesta en escena estéticamente aprobada. Reusar store/digests, sin inventar approval ni TTS.

**Primer rojo/oráculo:** disco real importa/revincula archivo autorizado y hash exacto; texto editado conserva audio/words/bindings históricos y comparación obsoleta tras serializar/reabrir. Boundary de palabras y audio que excede escena bloquean uso. Archivo real decodificable/escucha se acredita en V05/H03, no con cabecera sola. **Comandos:** I archivo, T/D; recursos solo archivo local elegido. **Cierre:** [ ] licencia/hash exactos, [ ] inputs/outputs de bindings trazables, [ ] sin reaceptación al abrir. Si D01 pendiente, casos sintéticos no cierran fixture. Tier estándar.

### V04b — Revisión de medios y aprobación mínima íntegra

**Depende:** V04a. **Entradas:** formato «Vínculos portables y aprobación editorial», componentes MediaReview, API «Aprobación editorial única» y «Retención local acotada» (interfaz SnapshotRepository). **Dueño:** nuevos `src/shared/editorial-review.ts`, `src/companion/store/snapshot-repository.ts` (interfaz e implementación companion de disco), `studio/src/components/MediaReview.tsx`, `tests/unit/editorial-review.test.ts`, `tests/integration/editorial-save.test.ts`. El repositorio es propiedad de V04b hasta cierre/revisión; no crear todavía `jobs/snapshots.ts`. Integración en ProjectStore/Editor solo coordinador, sin otros dueños concurrentes; no ampliar editor completo.

**Comportamiento:** aceptación manual de audio/words para digest exacto, una aprobación completa tras checks de salida, revisión/fecha consistentes y guardar con store existente. Antes de reemplazar aprobación local o editar su contenido/medios persistentemente, preservar snapshot anterior: implementar aquí SnapshotRepository retain/read/pin/release de API, con archivos atómicos, medios verificados, reserva/cuota, errores e idempotencia por owner; no confiar en un callback en memoria ni trasladar filesystem a shared/UI. V06b reutiliza esta interfaz/implementación ya revisada, no otro historial portable. Integración de store por coordinador: relink actual borra archivo viejo tras confirmed; retirar esa eliminación automática y pinnear snapshot/manifest aprobados antes del commit, contando bytes históricos contra cuota. Sin espacio, rechazar antes de sustituir datos. No sellos parciales ni proveedor. Cambiar opciones exige revisión nueva, copia rev0/import incrementado se mantienen.

**Primer rojo/oráculo:** aceptar words no aprueba proyecto; aprobar con medio obsoleto falla; guardar/reabrir conserva approval coincidente y edición posterior la vuelve stale sin eliminarla. Disco conserva snapshot previo y medios al aprobar nuevo; reemplazar audio por relink confirmed mantiene bytes/hash antiguos recuperables desde snapshot, caso que fuente actual no garantiza. Capacidad llena rechaza sin modificar canónico. **Comandos:** U editorial-review, I editorial-save, T/D. **Cierre:** [ ] snapshot y binding exactos, [ ] aprobación única/anterior y bytes históricos preservados, [ ] conflictos/uncertain no dan éxito falso. Tier alto de integridad.

### V05a — Sesión privada y servicio de recursos

**Depende:** V02, V03, V04, C01, D03. **Entradas:** API «Runtime y readiness», arquitectura «Seguridad local». **Dueño:** nuevos `src/companion/render/sessions.ts`, `resources.ts`, página interna de runtime bajo `src/composition/`; `tests/integration/render-boundary.test.ts`. HTTP existente lo edita solo coordinador usando módulo con handler estrecho; no ampliar endpoint genérico de archivos.

**Comportamiento:** sesión ligada a propósito preview/capture, snapshot/job, recursos copiados/verificados por hash y servidos por ID, rutas privadas GET y bridge page.evaluate empaquetado, expiración/dispose; token por header y Origin/Host sin debilitación. Añadir preview-sessions para draft validado/base coincidente sin aprobar ni guardar; V03 usó resolvedor de fixture, esta tarjeta conecta medios autorizados reales. Network deny salvo artefactos runtime y recursos de sesión, sin file://, URLs del JSON, popups/downloads/proveedores.

**Primer rojo/oráculo:** HTTP real rechaza token ausente/OriginHost ajeno/sesión cruzada/traversal/symlink/hash cambiado; renderer intenta navegar/red externa y se registra bloqueo efectivo. Snapshot pinneado no cambia si se reemplaza archivo original después de preparar; preview dirty no modifica canónico ni requiere approval y sesión expirada no sirve bytes. **Comandos:** I boundary y prueba navegador de sesión Chromium autorizada en mismo harness, T/D. **Cierre:** [ ] mapa cerrado de recursos, [ ] raw paths nunca viajan, [ ] worker/page correlacionados y token no registrado. Tier alto seguridad.

### V05b — Captura completa con backpressure

**Depende:** V05a. **Entradas:** arquitectura «Captura»/presupuestos, API FrameReady. **Dueño:** nuevos `src/companion/render/capture.ts`, `tests/integration/capture.test.ts`. Sin queue/journal ni shell encoder todavía.

**Comportamiento:** Chromium propio, viewport/deviceScaleFactor fijos, pedir frame→esperar readiness coincidente→screenshot raíz completa a PNG; productor pausado con máximo 2 buffers pendientes. Abort/error cierra navegador propio y pipes; no acumular todos los PNG en disco.

**Primer rojo/oráculo:** consumidor lento detiene producción y peak de buffers≤2; PNG decodificado muestra WebGL+DOM/SVG en frames identificados y orden exacto; frame timeout no emite imagen del anterior. Contar bytes reales y recursos del proceso, no callbacks screenshot mock. **Comandos:** M `tests/integration/capture.test.ts`, T/D; máquina/versiones/gates registrados. **Cierre:** [ ] número/dimensiones de frames exactos, [ ] cancelación deja PIDs propios terminados, [ ] no carpetas ilimitadas de PNG. Tier alto.

### V05c — Encoder y ensamblaje de audio

**Depende:** V05b. **Entradas:** arquitectura voz/presupuestos, API publicación. **Dueño:** nuevos `src/companion/render/encoder.ts`, `tests/integration/encoder.test.ts`. No jobs UI ni publicación final.

**Comportamiento:** spawn ejecutable confiable con argv separados/shell:false, H.264 1080×1920 30fps, AAC withVoice; ensamblar offset/gain y silencio al final de escena sin stretch/corte; silent sin pista. Máximo 2 threads; salida temporal por intento, stderr sanitizado y acotado; pipe/backpressure y fallos manejados.

**Primer rojo/oráculo:** FFmpeg real recibe frames fixture, ffprobe y decodificación validan duración/frame count/PTS/audio; marcador audible conocido en escenas verifica offsets y silent carece de stream audio. Nombre/título hostil no ejecuta comandos. Encoder con fallo/pipa rota no publica video. **Comandos:** M `tests/integration/encoder.test.ts`, T/D; no red. **Cierre:** [ ] audio cabe o falla antes de encode, [ ] stderr no contiene guion/token/rutas sensibles, [ ] cierre espera hijo/pipe. Tier alto AV.

### V05d — Verificación y publicación atómica de salida

**Depende:** V05c. **Entradas:** API ExportReceipt, delivery «Matriz de oráculos críticos». **Dueño:** nuevos `src/companion/render/verify.ts`, `publish.ts`, `tests/integration/render-publication.test.ts`. No declarar G2 aún; V06 añadirá preflight/recibo de producto.

**Comportamiento:** ffprobe+decode verifican dimensiones, fps racional, frames, duración exacta objetivo y audio esperado antes de publicar; hash final, rename atómico, preservar salida anterior. Evidencia de verificación devuelta a V06, no MP4 llamado current sin recibo.

**Primer rojo/oráculo:** truncar MP4/fps erróneo/frame omitido/audio ausente impiden publicación; fault injection write/rename conserva resultado anterior, temporal no aparece final; éxito lee hash desde disco publicado. **Comandos:** M `tests/integration/render-publication.test.ts`, T/D. **Cierre:** [ ] happy/fail/cancel con filesystem real, [ ] ninguna salida parcial pública, [ ] informe técnico completo sin aprobación estética. Tier alto.

### V06a — Preflight real según salida

**Depende:** V05, C01. **Entradas:** API «Preflight, trabajos y publicación», formato aprobación/bindings; arquitectura presupuestos. **Dueño:** nuevos `src/companion/jobs/preflight.ts`, `studio/src/components/PreflightPanel.tsx`, `tests/integration/preflight.test.ts`. HTTP/Editor se integran serializadamente por coordinador.

**Comportamiento:** checks por salida guardada, aprobación exacta, visuales/fuente/activos/bindings/audio-fit/espacio/motor; snapshotId temporal no ejecuta trabajo. No confundir guardar borrador con listo para exportar; cambios de salida se aprueban/guardan antes. Fuente/archivo cambiados entre check y enqueue se revalidan después.

**Primer rojo/oráculo:** disco real conserva audio faltante: silent pasa lo no consumido, withVoice bloquea; palabras dependientes de audio en silent bloquean hasta revisión. Approval stale, dirty/fileDigest distinto, hash externo alterado, font ausente y espacio insuficiente generan checks accionables, no true genérico. **Comandos:** I preflight, T/D; probe de motor solo bajo D03. **Cierre:** [ ] tabla de checks/error/actions completa, [ ] sin job ni aprobación como efecto lateral. Tier alto.

### V06b — Queue, snapshots y journal recuperable

**Depende:** V06a, V04b. **Entradas:** API Job/retención e interfaz SnapshotRepository, arquitectura «Jobs». **Dueño:** nuevos `src/companion/jobs/{manager,journal,snapshots}.ts`, `tests/integration/job-recovery.test.ts`. `jobs/snapshots.ts` es adaptador de jobs que importa `src/companion/store/snapshot-repository.ts` entregado por V04b; no segundo repositorio, copia de implementación ni traslado de sus archivos. Tras cierre/revisión de V04b, cualquier extensión compatible del repositorio compartido la integra solo coordinador de forma serializada, conservando pruebas editorial-save. HTTP solo coordinador.

**Comportamiento:** 1 activo/2 cola; enqueue CAS con snapshot immutable/pins usando retain/read/pin/release del mismo SnapshotRepository, operación idempotente journalizada, transiciones monotónicas y reserva de espacio para salida por el adaptador de jobs. Journal sin guion/secreto; snapshots locales separados. Reinicio marca queued/running interrupted; sin reanudación. Cache/retención con rechazo previo, no evicción de protegidos. Cambiar pins de job no libera owner approval ni elimina bytes del repositorio.

**Primer rojo/oráculo:** procesos reales mueren/reinician: journal registra interrupted y cero nuevos hijos; doble enqueue idéntico no duplica, payload distinto conflicto; cuarta solicitud rechazada; capacidad llena preserva aprobación anterior/propuesta/MP4. Archivo canónico cambia después y snapshot activo sigue igual. **Comandos:** I recovery, T/D; subtests de render bajo D03. **Cierre:** [ ] journal atómico/reconciliable, [ ] locks y reservas comprobados en disco, [ ] cancel/finish concurrente sin doble terminal. Tier alto concurrencia.

### V06c — Cancelación, watchdogs y limpieza propia

**Depende:** V06b. **Entradas:** arquitectura «Jobs»/«Presupuestos», API estados/error codes. **Dueño:** nuevos `src/companion/jobs/{cancel,watchdog}.ts`, `tests/integration/job-limits.test.ts`. Cambios manager compartido solo después de V06b, sin otra tarea tocándolo.

**Comportamiento:** abort etapa y cola indicada, 3 s gracia/forzar solo hijos propios; preparar 30 s/frame 10 s/total 10 min; disco/buffers/RSS árbol≤2 GiB y temporales≤2 GiB; espacio previo 3 GiB. Límites inyectables de test para no gastar recursos extremos, medición real por proceso. Borrar solo temporales propios con ruta interna comprobada.

**Primer rojo/oráculo:** hijo propio atascado y proceso señuelo ajeno: cancel mata/espera solo propio; pipes cerrados/temp removido/salida anterior intacta. Worker excede umbral pequeño real de disco/RSS/tiempo y aborta; probar árbol completo/no huérfanos. Estado UI solo cancelled cuando terminó. **Comandos:** I limits con procesos locales permitidos; M para trayectoria Chromium/FFmpeg autorizada, T/D. **Cierre:** [ ] cada umbral disparado por oráculo, [ ] límite RSS documentado como watchdog, no sandbox OS, [ ] imposibilidad de medir árbol bloquea gate, no omitir. Tier alto seguridad recursos.

### V06d — Recibos, vigencia y UI de trabajos/resultados

**Depende:** V06c. **Entradas:** API ExportReceipt/rutas, componentes JobPanel/ResultList, PRD R11/R18. **Dueño:** nuevos `src/companion/jobs/results.ts`, `studio/src/components/{JobPanel,ResultList}.tsx`, `tests/integration/result-receipts.test.ts`, `tests/e2e/jobs.e2e.ts`. Coordinador integra HTTP/api.ts/Editor después de módulos revisados.

**Comportamiento:** recibo con hashes/opciones/versiones; current derivado del contenido actual/activos/archivo, stale después de edición sin sobrescribir borrador. Descarga por resultId autenticado, polling limitado y cancelPending; reintento explícito nuevo attemptId. No progreso ficticio ni URL file://.

**Primer rojo/oráculo:** cambiar gain/caption/archivo o eliminar recibo vuelve no-current; MP4 viejo sigue legible como anterior. GET real no entrega parcial ni recurso ajeno; navegador muestra etapa/cancelación/error/revisión y no duplica enqueue en doble click. **Comandos:** I receipts; B jobs (Chromium si captura/layout); T/D. **Cierre:** [ ] hash del disco coincide recibo, [ ] estados tras reinicio/edición correctos, [ ] silent y withVoice no comparten vigencia falsa. Tier alto integridad.

### V07a — Goldens, tolerancias y continuidad verificable

**Depende:** V03, V04, V05, V06; D02 para aprobar baseline estético, D03 para capturas. **Entradas:** delivery oráculos, continuidad, arquitectura determinismo, DTO stateDigest. **Dueño:** nuevos `tests/visual/composition-goldens.test.ts`, manifiesto de referencias bajo `tests/fixtures/visual/`; no retocar implementación/tolerancias para hacer pasar sin incidente documentado.

**Comportamiento:** misma evaluación exacta preview/export, capturas en frontera de palabra/escena y seek inverso; dos cámaras mismo auto/ratios y aislamiento materiales/rig. Fijar entorno fuente/GPU/browser/runtime. Default de comparación en mismo entorno: estado exacto; PNG máximo 0.1% de píxeles con diferencia >8/255 por canal y ninguna diferencia fuera de máscara de antialias documentada de bordes de texto. No usar tolerancia para ocultar posición/palabra ausente; bounds/IDs/ratios oráculos separados. Umbral se valida con control negativo (cambiar palabra/cámara/escala), no se amplía automáticamente; entre entornos reportar diferencias, no prometer hash universal.

**Primer rojo/oráculo:** introducir deformación heredada/no aislamiento, omitir caption DOM y retrasar frame un índice deben fallar tests distintos; baseline no se genera y acepta a sí mismo. PNG comparados contra capturas revisadas de fuente, no contra mismo output recién generado. **Comandos:** M `tests/visual/composition-goldens.test.ts`, T/D. **Cierre:** [ ] prueba negativa sensible a regresiones, [ ] baseline/versión/decisión D02 trazados, [ ] preview y MP4 decodificado comparados. Tier alto visual/estadístico.

### V08a — Prueba reproducible G2

**Depende:** V07, D01/D02/D03 resueltos. **Entradas:** delivery Gate G2, setup y fixture autorizado. **Dueño:** nuevos `tests/e2e/vertical-proof.e2e.ts`, actualización acotada `docs/dev/setup.md` y evidencia G2 en delivery por coordinador. No nuevas capacidades.

**Comportamiento:** proceso nuevo abre fixture guardado, seek adelante/atrás, exporta 12 s con voz y silent por revisiones aprobadas distintas, verifica archivos/recibos; medir máquina, duración, fps, frame count, PTS, peak RSS/disco/buffer, latencia seek/tiempo total. Humano escucha y observa personaje/geología/cámara/rótulos/palabras; no basta MP4 negro válido.

**Primer rojo/oráculo:** recorrido falla antes de completar exportaciones verificadas; retirar activo/caption hace fallar criterio correspondiente. **Comandos:** B vertical-proof + ffprobe/decode M, regresión M2 enfocada, T/D. **Cierre:** [ ] acta técnica y estética separadas con revisor, [ ] límites medidos vs objetivo sin promesa de tiempo real, [ ] instrucciones reproducibles offline y G2 explícito. Si humano no acepta estética, registrar rechazo y corregir unidad, no cerrar G2. Tier alto integración/revisión.

## M3 — Seis unidades (una condicional)

### E01a — Acciones del editor y composición del shell

**Depende:** G2. **Entradas:** componentes layout/SceneEdit, modelo/Editor actuales, PRD R07/R15, formato revisiones. **Dueño:** nuevo `studio/src/editor-actions.ts`, `components/{ProjectHeader,SceneList,RecoveryDialog}.tsx`, `tests/unit/editor-actions.test.ts`; coordinador es único dueño de `screens/Editor.tsx`, `App.tsx`, `model.ts`, `styles.css`. Worker entrega integración pequeña serializada, no fork del editor.

**Comportamiento:** reutilizar texto/orden/duración M1, acciones tipadas validadas y layout P2–P5 integrando preview/preflight/job revisados. Selección por ID, reordenar contiguo, revisión de escena para cambios propios y afectadas por startMs. Revisión raíz avanza por transacción persistida y puede agrupar acciones UI; secuencia dirty es local en memoria, commit prepara revisión raíz siguiente soportada por store y no reescribe bindings/approval. Dirty no se calcula por aprobación. No schema ni proveedor.

**Primer rojo/oráculo:** reducer mantiene IDs/continuidad/revisiones y rechaza duración total excedida sin alterar draft; E2E `tests/e2e/editor-shell.e2e.ts` guarda/reabre después de reorder con companion real y compara disco; error/edición durante save conserva M1. **Comandos:** U actions, B shell DOM y Chromium para layout, T/D. **Cierre:** [ ] estado guardado/conflicto/uncertain/salida no regresa, [ ] ninguna segunda fuente de Project mutable. Tier alto por integración compartida.

### E01b — Inspector visual y subtítulos sin modelado libre

**Depende:** E01a. **Entradas:** componentes SceneInspector/EntityUsage, formato visual/entities/captionStyle. **Dueño:** nuevos `components/{SceneInspector,EntityUsage}.tsx`, `tests/unit/scene-inspector.test.ts`, `tests/e2e/scene-inspector.e2e.ts`; acciones compartidas se integran serializadamente por coordinador. Sin editar geometría global/variantes ni assets externos.

**Comportamiento:** seleccionar catálogo/reutilizar identidad, mover/rotar/escala uniforme, cámara keyframes/paleta, captions/ancla/margen y visualIntent; formulario convierte grados a radianes explícitamente. Mostrar entity/version/usos y bloqueos de diseño. Input inválido local no corrompe snapshot; estilo desconocido readOnly.

**Primer rojo/oráculo:** intentar escala por eje/override identidad falla, reutilizar crea componentId nuevo conservando entityId; save/reopen reproduce parámetros y capturas antes/después consistentes. Chromium muestra inspector/preview sin solapamiento y controles teclado. **Comandos:** U inspector, B inspector Chromium, T/D. **Cierre:** [ ] todos campos permitidos accesibles, [ ] sin selector de función no implementada, [ ] voz no regenerada. Tier estándar.

### E01c — Importar medio nuevo sin fingir relink

**Depende:** E01b, F05, C01. **Entradas:** API «Ingesta manual de medios nuevos», formato manifest/inspección, componentes MediaReview y AssetManifest actual. **Dueño:** nuevo `src/companion/store/asset-ingest.ts`, `studio/src/components/AssetImport.tsx`, `tests/integration/asset-ingestion.test.ts`, `tests/e2e/asset-import.e2e.ts`. Store/HTTP/api.ts/Editor son integración serializada del coordinador, sin schema nuevo ni otro editor concurrente.

**Comportamiento:** archivo explícito, licencia/atribución, bytes raw/MIME y CAS; generar ID/hash/metadata real/staging, incorporar manifest tras comprobar límites y disco. UI dirty exige guardar o cancelar antes, no sobrescribe draft para importar. Elegir audio y aceptar binding son acciones separadas; imágenes se admiten sin promesa de composición. Nunca seleccionar archivo de home por path proporcionado ni descargar URLs.

**Primer rojo/oráculo:** nuevo audio válido en disco aparece con duración/canales/hash inspeccionados y source user tras guardar/reabrir; MIME falso/exceso/licencia inválida/CAS concurrente conservan JSON previo y no publican referencia rota. Cambiar audio deja anterior disponible y binding pendiente; cancel/error de selector no altera nada. Respuesta perdida exige reconciliar manifest antes de retry, sin importar duplicado silencioso. **Comandos:** I asset-ingestion con bytes reales, B asset-import DOM y Chromium para selector nativo si corresponde, T/D. **Cierre:** [ ] ingesta nueva distinta de relink existente, [ ] commit/uncertain/limpieza propios probados, [ ] procedencia no inventada y sin media remota. Tier alto filesystem/integración.

### E02a — Invalidación fina del editor

**Depende:** E01, V06. **Entradas:** formato bindings/digests; flujos F4; PRD R18–R20. **Dueño:** nuevos `src/shared/dependencies.ts`, `tests/unit/dependencies.test.ts`, `tests/integration/editor-invalidation.test.ts`; integración única de editor-actions por coordinador, sin alterar esquema ni historial de formato.

**Comportamiento:** matriz de dependencias por texto/locale, cámara/luz/identidad, orden, duración, gain, offset/audio y captions; conservar bindings/medios anteriores, derivar stale/current/sin verificar. Reducir invalidación sin reaceptar automáticamente. Cambio global/variante se prueba como operación interna del modelo para preservar contrato, **no** habilita UI avanzada fuera de alcance.

**Primer rojo/oráculo:** tabla parametrizada: texto invalida voz/words; cámara no; orden conserva alineación local; duración solo encaje; gain cambia output audio/content pero no input palabras; offset sí. Guardar/importar otro workspace conserva obsolescencia y bloquea preflight consumido; MP4/old approval permanece anterior. **Comandos:** U dependencies, I invalidation en disco, T/D. **Cierre:** [ ] cada fila F4 ligada a test, [ ] sin borrado/pagos implícitos ni renovación de bindings. Tier alto integridad.

### E03a — Interfaz adaptador y fake de guion

**Depende:** E02, C01. **Entradas:** API «Adaptadores y propuestas», PRD R12/R13. **Dueño:** nuevos `src/companion/providers/{adapter,fake-script}.ts`, `tests/unit/fake-script.test.ts`. No HTTP/Editor/credenciales/red.

**Comportamiento:** describe/prepare/execute acotados, script proposal cerrado con IDs/duración/texto y inputDigest de snapshot; fake determinista etiquetado, no promesa de costo ni contenido «IA real». Ningún payload HTML/código/geometry libre.

**Primer rojo/oráculo:** propuesta >12 escenas/texto excedido/campo path/instrucción HTML no se ejecuta ni se acepta como código; input cambiado altera digest, fake repetido mismo seed/entrada es estable. Guard de red intenta conexión y demuestra bloqueo, cero solicitudes en flujo. **Comandos:** U fake-script, T/D. **Cierre:** [ ] validador a runtime no solo TS, [ ] error sanitizado y abort comprobado. Tier estándar.

### E03b — Fake de voz, conversión y fallos inciertos

**Depende:** E03a. **Entradas:** API VoiceProposal/unidad timestamps, formato voz/words, fixture V04. **Dueño:** nuevos `src/companion/providers/{fake-voice,alignment}.ts`, `tests/unit/provider-alignment.test.ts`, `tests/integration/fake-provider.test.ts`. No creación de voz real ni provider remoto.

**Comportamiento:** fake devuelve resourceId de bytes locales autorizados, límites/sha/timing/procedencia; conversión seconds→ms una vez con redondeo y posterior validación; abort/timeout antes y después de supuesto envío dan estados distinguibles. Idempotencia solo describe capacidad real del fake, no garantía de terceros.

**Primer rojo/oráculo:** casos 0.45→450, límites/rangos/colapso/overlap/unidad errónea rechazados; timeout después de envío produce remote-uncertain y contador de intentos no aumenta sin acción nueva. Bytes staging coinciden hash, sin acceso a paths remotos. **Comandos:** U alignment, I fake-provider disco y red bloqueada, T/D. **Cierre:** [ ] medias/words no se aplican automáticamente, [ ] secreto canario ausente en salida/journal/logs. Tier estándar.

### E04a — Preparación y autorización explícita de solicitud

**Depende:** E03. **Entradas:** API requests/authorization, componentes RequestReview, flujos F7. **Dueño:** nuevos `src/companion/providers/requests.ts`, `components/RequestReview.tsx`, `tests/integration/request-authorization.test.ts`, `tests/e2e/request-review.e2e.ts`. HTTP/api.ts solo coordinador; sin adaptador real.

**Comportamiento:** prepare no ejecuta; preview muestra qué sale/destino/capacidad/costo desconocido/límite y fake; authorize token de un uso TTL/digest/presupuesto, execute con operationId y un activo. Cancelar/no configurar nunca llama adapter.execute. Credencial futura solo sesión companion, ninguna lectura de .env.

**Primer rojo/oráculo:** autorización expirada/reusada/digest alterado/proveedor cambiado rechazada antes de execute; backend real con fake cuenta cero ejecuciones al cancelar y una al confirmar doble click; origen/token ajenos rechazan. **Comandos:** I authorization, B review DOM más Chromium foco si modal, T/D. **Cierre:** [ ] aprobación editorial única no se usa como permiso de gasto, [ ] no CTA ambiguo ni habilitación de real. Tier alto seguridad.

### E04b — Revisar y aceptar propuestas por CAS

**Depende:** E04a. **Entradas:** API Proposal/accept, componentes ProposalReview, E02 dependencias. **Dueño:** nuevos `src/companion/providers/proposals.ts`, `components/ProposalReview.tsx`, `tests/integration/proposal-acceptance.test.ts`, `tests/e2e/proposals.e2e.ts`. Editor/store/HTTP existentes solo integración coordinador; no ejecutar proveedor.

**Comportamiento:** diff legible de campos/escenas/medios, origen y revisión; aceptar valida propuesta, dependencias y CAS, incorpora recurso de staging por assetId y bindings exactos, guarda con recibo. Rechazar preserva canónico. Acceptance de propuesta no aprueba automáticamente contenido completo ni siguiente solicitud.

**Primer rojo/oráculo:** edición concurrente entre review y accept →409 y bytes canónicos intactos; respuesta inválida/medio cambiado no se incorpora; aceptación correcta guarda/reabre valores/bindings y revisión única esperada. Dos accepts no aplican dos veces. **Comandos:** I acceptance disco, B proposals, T/D. **Cierre:** [ ] stale inspeccionable no forzable, [ ] error/cancel no sustituye contenido con vacío, [ ] snapshot anterior preservado. Tier alto integridad.

### E05a — Integración real opcional, nunca baseline obligatorio

**Depende:** E04, D04; permisos de red/secretos/gasto adicionales vigentes. **Entradas:** API adapter y gate de proveedor de delivery; documentación oficial del **servicio elegido después**, no elección por este worker. **Dueño:** propuesto `src/companion/providers/real/<adapterId>.ts`, tests de contrato con fixtures sanitizados y procedimiento local de integración. No package/HTTP/schema/otro proveedor sin alcance nuevo.

**Comportamiento:** una capacidad/servicio por tarjeta autorizada, límites/timestamps/idempotencia verificados contra docs actuales; credencial solo memoria sesión, presupuesto por operación y sin retry ambiguo. Si se autorizan dos capacidades, repetir esta tarjeta con IDs E05a-script/E05a-voice y permisos separados, no fan-out oculto.

**Primer rojo/oráculo:** contrato local rechaza respuesta inválida/canario/timeout incierto antes de llamada real; integración real mínima requiere autorización concreta, registra request/receipt sanitizados y costo observado vs límite sin cuerpos/keys. No ejecutar para «ver si funciona». **Comandos:** U/I del adaptador seleccionado; comando real y máximo gasto documentados y aprobados antes. **Cierre:** [ ] gate/servicio/capacidad/docs/versiones/límite registrados, [ ] secreto ausente de artefactos, [ ] si no autorizado estado «no aplicable a offline / integración real pendiente», no PASS fake como real. Tier alto.

### E06a — Resultados tardíos y conservación de revisión anterior

**Depende:** E02, E03, E04. **Entradas:** API retención/proposals y «Descubrimiento de intentos y propuestas tras reinicio», flujos F4/F6, PRD R11/R18. **Dueño:** nuevos `src/companion/providers/{reconcile,discovery}.ts`, `tests/integration/late-proposal.test.ts`, `tests/integration/generation-discovery.test.ts`; cambios journal/snapshots/proposals y HTTP/api.ts serializados por coordinador después de sus dueños. Sin historial dentro de schema ni UI de ramas.

**Comportamiento:** resultado tras edición se archiva como propuesta stale con snapshot/media protegidos; conserva anterior aprobado y último MP4. Implementar listado autenticado por proyecto con GenerationAttemptSummary/proposalId, limit/cursor/corte/TTL de API e índice de secuencia persistente; conservar fila mínima del intento mientras su propuesta esté protegida. Lookup por ID verifica pertenencia al proyecto. Descubrimiento local no llama execute, reconcile remoto ni retry; no depende de estado recordado por navegador. Cambios UI no destruyen histórico local. Reserva previa de quota y rechazo antes de iniciar, sin evicción silenciosa; descarte explícito revisado muestra referencias/efecto, nunca borra assets canónicos automáticamente.

**Primer rojo/oráculo:** fake lento, editar/guardar/reabrir antes de respuesta: bytes canónicos actuales intactos, propuesta antigua y audio histórico existen y hash igual; cuota llena impide nuevo intento sin perder snapshots/proposals. generation-discovery falla primero porque, usando solo projectId tras reiniciar companion, no puede enumerar ni recuperar proposalId sin IDs previos. Con disco/procesos/HTTP reales: paginar limit=1 y recorrer corte completo sin duplicados, descubrir propuesta stale protegida más antigua que límites de metadatos no protegidos, recuperar payload por ID descubierto y comparar hash; cursor vencido/previo al reinicio exige empezar desde proyecto. Token ausente/OriginHost ajeno/cursor manipulado/ID de otro proyecto se rechazan. Contadores de envío fake y guard de red prueban cero execute/reconcile/retry por reinicio/listado/GET. Ningún archivo fuera de temporal propio se elimina. **Comandos:** I late-proposal e I generation-discovery, T/D. **Cierre:** [ ] propuestas retenidas localizables sin opaque IDs recordados, [ ] paginación acotada/auth y filas protegidas verificadas, [ ] todos pins/quotas sin crecimiento sin límite, [ ] import/copy advierte no transportar journal. Tier alto.

### E06b — Recuperación, reintento y cierre G3

**Depende:** E06a. **Entradas:** API incertidumbre/cancel/reconcile y «Descubrimiento de intentos y propuestas tras reinicio», delivery Gate G3. **Dueño:** nuevos `tests/e2e/generation-recovery.e2e.ts`, `tests/integration/provider-restart.test.ts`; integración de descubrimiento en api.ts/recovery UI solo coordinador, sin escribir otro índice. Sin E05 obligatorio.

**Comportamiento:** con navegador nuevo sin storage ni IDs previos y companion reiniciado/token nuevo, listar/abrir proyecto M1 y usar discovery paginado para recuperar intentos/proposalIds retenidos, inspeccionar propuesta stale y mostrar remote-uncertain/interrupted sin nueva solicitud. Cursor invalidado por restart vuelve a primera página, no bloquea recuperación. Reconciliación local de journal no equivale a consultar proveedor; cualquier consulta remota requiere acción/autorización aplicable y reintento acción explícita con nuevos attemptId/authorizationId. Cancelación no promete evitar cargos. Reabrir conserva revisión aprobada anterior y draft guardado, no cambios de memoria nunca confirmados.

**Primer rojo/oráculo:** antes de implementar integración, E2E inicia navegador/proceso companion nuevos, sin cookies/localStorage/attemptId/proposalId/cursor recordados: abrir proyecto no permite aún encontrar propuesta tardía retenida y test falla. Después, crear con fake una propuesta stale en disco y otro intento enviado pendiente; matar solo proceso propio, reiniciar companion y navegador, obtener token nuevo, listar proyectos y paginar intentos hasta encontrar proposalId, GET de propuesta conserva payload/hash y no aplica al borrador. Intento pendiente queda interrupted/remoteState uncertain si ya fue enviado; ausencia de resultado no inventa ready. Contadores/guard de red registran cero execute/reconcile/retry por arranque/descubrimiento; solo tras nueva confirmación explícita hay segundo intento/autorización nuevos. E2E además edita/revisa/acepta fake/guarda/reabre/exporta con invalidación y fallo recuperable. **Comandos:** I provider-restart, B generation-recovery con red externa bloqueada; M solo parte export autorizada, T/D. **Cierre:** [ ] recuperación real desde navegador+companion nuevos sin IDs recordados, [ ] G3 offline documentado con E05 pendiente/no aplicable, [ ] todos bloqueantes de recuperación resueltos, [ ] ninguna afirmación de integración real sin evidencia. Tier alto.

## M4 — Cinco unidades de cierre

### H01a — Corpus hostil y fronteras

**Depende:** G3. **Entradas:** delivery «Casos mínimos del corpus», API seguridad actual/privada, PRD R13/R14. **Dueño:** nuevos `tests/security/hostile-inputs.test.ts`, `tests/integration/runtime-security.test.ts`, fixtures textuales acotados; cualquier fix funcional se devuelve a tarjeta dueña, no reescritura amplia.

**Comportamiento:** extender corpus existente a runtime/jobs/proposals: traversal/symlink/URL/HTML/keys/profundidad/JSON/props/versions/overrides; fuente/imagen/audio hostiles y secreto canario. Fuzz determinista 1000 casos con seed registrada y límites de tiempo, no fuzz ilimitado/red real.

**Primer rojo/oráculo:** control negativo abre una ruta prohibida de harness y el detector debe fallar; entradas reales a HTTP/parser no producen red, shell ni lectura/escritura fuera de workspace. Verificar señuelo externo intacto y guard de DNS/TCP efectivo. **Comandos:** U security, I runtime-security; M solo decodificadores autorizados; T/D. **Cierre:** [ ] todos casos críticos tienen rechazo observable y documento previo intacto, [ ] errores sanitizados no revelan paths/tokens. Tier alto seguridad.

### H01b — Fallos de recursos bajo carga acotada

**Depende:** H01a. **Entradas:** arquitectura presupuestos, V06c oráculos, PRD R11. **Dueño:** nuevos `tests/integration/resource-envelope.test.ts`, informe de límites en setup por coordinador. No aumentar límites para pasar ni ejecutar carga en equipo ajeno.

**Comportamiento:** medir árbol real de worker/encoder, disk/backpressure/timeout/preparación/queue/pins; repetir cancel en prepare/capture/encode/verify. Usar umbrales de prueba pequeños más una prueba fixture con defaults; nunca agotar disco/memoria del host deliberadamente.

**Primer rojo/oráculo:** watchdog real dispara en hijo que asigna/retiene recurso, sin hijos huérfanos; sentinel ajeno vive y salida anterior hash intacto. Al terminar disco/temp/RSS vuelven dentro del presupuesto medido; cuota retenida se distingue de temporal. **Comandos:** I resource-envelope + M bajo D03, T/D. **Cierre:** [ ] máquina/picos/tiempos/versiones y limitación de sandbox documentados, [ ] ningún caso crítico skip/autopass. Tier alto procesos.

### H02a — Teclado, foco y estados recuperables

**Depende:** E01, F06. **Entradas:** componentes «Interacción», UX README accesibilidad, flows F1–F7. **Dueño:** nuevos `tests/e2e/accessibility.e2e.ts`, correcciones localizadas de componentes/CSS a través del coordinador si hay otro dueño. No introducir biblioteca UI/tema nuevo.

**Comportamiento:** recorrido solo teclado, modales/errores/pending/readOnly, 200% zoom, 320/390/1280/1440 px; contraste medido, nombres/roles y estado no solo color. Cmd/Ctrl+S y transport no roban entrada de texto. Reduced motion no altera frame exportado.

**Primer rojo/oráculo:** foco visible/retorno tras cancel/error, orden lógico y bounds reales Chromium; control negativo oculta foco o desborda panel y debe fallar. Simular save fallido no navega/limpia dirty. No certificar WCAG completo solo por herramienta automática. **Comandos:** B accessibility Chromium, T/D. **Cierre:** [ ] matriz estado×pantalla verificada y captura medida, [ ] errores consola/runtime capturados, [ ] barreras restantes publicadas, bloqueantes corregidos. Tier estándar; revisión humana a11y.

### H03a — Calidad AV y sincronía completa

**Depende:** V08, E01; D01/D02/D03. **Entradas:** PRD R08–R10, delivery oráculos, V07 goldens. **Dueño:** nuevos `tests/integration/av-quality.test.ts`, reporte AV bajo docs/dev por coordinador. Sin regeneración de voz ni cambio del catálogo fuera de corrección acordada.

**Comportamiento:** decodificar MP4 completo y verificar PTS monotonía, frames/duración exactos, voz no excedida ni clipping introducido por mezcla, silencio y ausencia audio elegida; escuchar inicio/transición/final y leer captions con cámara en movimiento. Defaults de análisis: peak mezcla≤0 dBFS sin samples saturados introducidos por gain; eventos temporales conocidos dentro de ±1 frame (33.334 ms); bounds/textos por V07. Desajuste exige corregir input/mezcla, no ampliar tolerancia automáticamente.

**Primer rojo/oráculo:** archivo con drift de 2 frames/caption omitido/audio cortado/clipping intencional debe fallar detector; prueba positiva usa medios revisados y ffprobe+decode, no metadata sola. **Comandos:** M av-quality y revisión humana con evidencia, T/D. **Cierre:** [ ] escucha/lectura humana identificada separada del análisis automático, [ ] medidas por principio/medio/final, [ ] calidad no atribuida a auditoría de cabeceras M1. Tier alto AV.

### H04a — Licencias y procedimiento offline reproducible

**Depende:** H01, H02, H03. **Entradas:** manifest/registro D01/D03, package/lock y herramientas realmente usadas. **Dueño:** propuestos `docs/dev/licenses.md`, actualización `docs/dev/setup.md`; no instalar/redistribuir binarios ni añadir licencia inventada.

**Comportamiento:** inventario exacto de fuente/audio/builtin/código/binario/codec, versión/hash/origen/licencia/atribución/obligación de distribución; procedimiento con entorno soportado y limitaciones. Prohibir redistribución no verificada, distinguir uso local de bundling. Nada de «libre de derechos» sin evidencia.

**Primer rojo/oráculo:** test futuro `tests/unit/license-manifest.test.ts` falla si fixture consumida/font builtin carece de registro/hash/licencia; revisión manual contrasta archivos de licencia reales (no requiere red en test). **Comandos:** U license-manifest, D y revisión de links/JSON. **Cierre:** [ ] recursos usados cubiertos y restricciones explícitas, [ ] arranque/recuperación/export offline sin pasos secretos. Tier estándar documental/técnico.

### H04b — Diagnóstico sanitizado útil

**Depende:** H04a. **Entradas:** arquitectura seguridad, PRD R17, API journal. **Dueño:** nuevos `src/companion/diagnostics/report.ts`, `studio/src/components/Diagnostics.tsx`, `tests/integration/diagnostic-report.test.ts`; HTTP/API integración coordinador, no recolector remoto.

**Comportamiento:** reporte local opt-in con IDs/códigos/versiones/métricas/etapas/hashes; sin guion completo, tokens, headers, credenciales, rutas absolutas personales ni bytes de medios. Preview antes de descarga, descarga no guarda proyecto ni envía red. Diagnóstico distingue motor no instalado de render fallido.

**Primer rojo/oráculo:** canarios en secreto/guion/path/header/metadata remota no aparecen en bytes reales del JSON diagnóstico; códigos de fallo suficientes para ubicar job/test y versión. Intento externo de solicitarlo falla auth. **Comandos:** I diagnostic-report, B DOM del panel cuando se integre, T/D. **Cierre:** [ ] revisión de privacidad fresca y zero network, [ ] reporte útil sin exponer snapshot local protegido. Tier alto privacidad.

### H05a — Handoff limpio e independiente v0.1

**Depende:** H01, H02, H03, H04. **Entradas:** PRD trace R01–R20, delivery G1–G4, setup, registro decisiones/evidencia de tarjetas. **Dueño:** nuevo `tests/e2e/handoff.e2e.ts`, acta final en delivery y setup por coordinador. No nuevas funciones/estilos/proveedores ni commit implícito.

**Comportamiento:** revisor independiente en workspace nuevo crea borrador/reabre/reordena/reutiliza identidad/importa/relinkea/revisa bindings/aprueba/exporta con y sin voz, simula conflicto/fallo/cancelación/reinicio y revisa reporte. Verifica portabilidad en segunda carpeta y límites publicados; real opcional se etiqueta pendiente si no autorizado.

**Primer rojo/oráculo:** test de recorrido falta de pasos/requisitos falla y conserva artefactos sanitizados; bytes/digests/PIDs/PNG/MP4 verificados por revisor, no solo acta del autor. **Comandos:** B handoff + suites relevantes U/I/E2E y M bajo permisos, T/D; registrar conteos/skips/procedencia por ejecutor. **Cierre:** [ ] cada R con evidencia o bloqueo explícito (no «todo PASS»), [ ] cero bloqueantes aplicables G4, [ ] aceptación humana técnica/visual diferenciada, [ ] árbol limpio salvo cambios autorizados y original inmutable. Tier alto revisión final; no auto-review.

## Coordinación, paralelismo y selección de contexto

Coordinador mantiene tabla tarjeta/estado/dueño/base/paths/contratos/evidencia/revisor. Solo él integra archivos compartidos: `Editor.tsx`, `App.tsx`, `model.ts`, `styles.css`, `studio/src/api.ts`, `src/companion/server/http.ts`, schema/types/limits, package/lock y documentos índice. No permitir dos agentes editando esos archivos simultáneamente; preparar módulos aislados y luego una integración serializada con pruebas de consumidor. Un cambio de contrato suspende consumidores afectados hasta nueva revisión. Mantener unidad completa con pruebas/docs, sin golf ni pérdida de infraestructura para ajustar líneas. Conteo de líneas es guía, no límite de permiso; dividir por comportamiento o justificar excepción coherente.

**Máximo simultáneo:** hasta 2 workers de implementación, solo tarjetas sin dependencia mutua ni rutas compartidas; 1 revisor fresco por unidad terminada. Ejemplo permitido después de C01: V02a y V04a; V03c espera V04a aunque V03b haya terminado. No lanzar trabajo siguiente «para aprovechar tiempo» si el contrato padre no está revisado. El usuario pidió delegación futura; aquí no se crea ningún agente.

Guía model-neutral: tier estándar para piezas puras/formularios/fixtures con contrato estable; tier alto para contratos, concurrencia, filesystem, seguridad, procesos, AV y gates. Un modelo de menor costo puede ejecutar tarjeta estándar después de revisión del contrato; nunca rebajar oráculos, permisos o revisión por costo. No se selecciona proveedor/modelo concreto ni se gasta presupuesto por este plan.

### Prompt copiable para worker

```text
Eres worker de Molecula Studio. Ejecuta SOLO <ID y título> tras autorización
del coordinador. Base esperada <commit>; verifica git status y preserva cambios ajenos.
SKILL: Load /Users/jose/.config/opencode/skills/cognitive-doc-design/SKILL.md
si cambias documentación. No buscar ni crear skills nuevos. No lanzar agentes.
Lee PROJECT_CONTEXT.md, AGENTS aplicables y la tarjeta <ID> de
docs/plan/implementation-tasks.md; luego SOLO sus entradas/encabezados enlazados.
Contrato aprobado: <versión/base de api-contracts y C01>; memoria relevante:
<resumen del coordinador, no pedir al worker reconstruir toda la historia>.
Archivos permitidos: <lista exacta>; integración compartida: <dueño/coordinador>.
Exclusiones y gates: <copiar los de la tarjeta; autorizaciones concretas o bloqueos>.
No cambiar original-specification.md, paquetes/config ni paths fuera del alcance.
No instalar, navegar, ejecutar media nativa, leer secretos, red/proveedores/gasto,
commit/push/deploy salvo permiso separado explícito y aprobaciones del harness.
Primero registra prueba roja de comportamiento y oráculo; implementa mínimo.
Ejecuta solo comandos autorizados <lista>. No usar mocks para probar disco/media/PID.
Si no puedes obtener oráculo/permiso, devuelve blocked/partial, no PASS ni skip oculto.
Guarda decisiones/descubrimientos/bugs importantes en Engram proyecto molecula_studio.
Devuelve: status (complete|partial|blocked), resumen, archivos/diff, prueba roja,
pruebas posteriores con conteos/skips/recursos/versiones/evidencia, riesgos,
decisiones pendientes y siguiente revisión recomendada. No autoaprobar ni iniciar otra tarjeta.
```

### Protocolo de revisor independiente fresco

Dar solo objetivo, contrato, diff/base, criterios y paths/oráculos, no conclusión del autor como verdad. Revisor no modifica producto durante la primera pasada ni lanza agentes; verifica claims contra archivos y repite tests críticos permitidos con procedencia propia. Para docs: enlaces locales/anclas, ejemplos JSON, cobertura R/unidades, DAG, actualidad frente a fuente y preservación original. Para código: invariantes/errores/regresión/seguridad/oráculos reales y gates, no solo estilo. Entrega hallazgos con severidad, path/heading y reproducción; distingue bloqueante real de sugerencia. Autor corrige con rojo→verde; revisor reevalúa fixes. Solo coordinador cierra tarjeta/unidad y actualiza delivery con evidencia, sin asumir aceptación estética ni autorización de gastos. Si ejecución no está permitida, revisión estática puede cerrar únicamente su alcance, no validar el oráculo faltante.
