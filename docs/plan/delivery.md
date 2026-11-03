# Entregas verificables antes de conectar proveedores

El desarrollo se organiza en incrementos completos: **M0 plan → M1 guardar/reabrir → M2 prueba audiovisual determinista → M3 editor/adaptadores → M4 validación v0.1**. El resultado de esta intervención es documentación; ninguna prueba de producto se declara aprobada.

## Reglas de ejecución futura

1. Tomar una unidad de comportamiento, escribir primero su prueba fallida y registrar la causa esperada.
2. Implementar lo mínimo para hacerla pasar; refactorizar sin perder el oráculo.
3. Ejecutar pruebas unitarias y de integración relevantes, y E2E real para el recorrido de la unidad.
4. Revisar seguridad y regresiones antes de marcar tarea completa.
5. Entregar una unidad coherente con sus pruebas y documentación; el tamaño es guía de revisión, no motivo para eliminar cobertura.

Los mocks sirven para fallos remotos o determinismo de unidades, no para acreditar escritura de disco, reproducción de archivos, composición WebGL o MP4 real. No se permite sustituir una prueba crítica por comprobar que se llamó una función.

No instalar dependencias, activar servicios, leer secretos, ejecutar proveedores ni generar gastos durante M0. El inicio posterior de implementación no autoriza gastos o red de proveedores automáticamente.

## M0 — Plan coherente y verificable

**Entrada:** especificación original preservada, requisitos del usuario e investigación previa.

| ID | Unidad | Dependencias | Aceptación / evidencia |
|---|---|---|---|
| P01 | Consolidar requisitos y exclusiones | Ninguna | R01–R20 vinculados a tareas; sin SaaS accidental |
| P02 | Definir formato y ejemplos completos | P01 | Schema escrito, dos JSON parseables y coherentes, parcial válido |
| P03 | Delimitar arquitectura y seguridad | P01, P02 | Un reloj, límites, save atómico, renderer acotado, sin secretos |
| P04 | Integrar bosquejos UX | P01–P03 | Crear/guardar/abrir/incompleto/error/faltantes/cancelación representados |
| P05 | Revisión cruzada del plan | P01–P04 | Sin contradicciones de IDs, unidades, estados, fases o estilos |

**Gate G0:** revisión documental completa y pendientes explícitos. No equivale a PASS del producto. Esta solicitud termina en M0; M1 queda preparado, sin una aprobación rutinaria nueva de cada decisión técnica propuesta.

## M1 — Estudio offline que no pierde el borrador

**Resultado:** crear y editar manualmente proyecto vacío/parcial, guardar, cerrar procesos y reabrirlo. No renderer, proveedor ni FFmpeg necesarios.

| ID | Unidad TDD y alcance | Dependencias | Pruebas / requisitos |
|---|---|---|---|
| F01 | Scaffold mínimo, schema compartido y entorno fijado | G0 | Versiones LTS/compatibilidad documentadas; test runner ejecuta sin proveedor |
| F02 | Parser/validador schema 1 | F01, P02 | Vacío/storyboard válidos; refs/versions de entities y entradas hostiles rechazadas; R02, R04, R13, R19 |
| F03 | ProjectStore con commits atómicos y conflictos | F02 | Integración disco real, fault injection de write/rename/fsync; R03 |
| F04 | Estudio mínimo: nombre, idea, escenas texto y dirty | F02, F03 | Crear/editar/guardar/abrir en navegador con companion real; R01, R02 |
| F05 | Importar copia, manifest y relink | F02, F03 | Copia entre dos workspaces, audio faltante y sustitución explícita; R05 |
| F06 | Guardar copia/descarga y protección de salida | F04, F05 | Confirmación veraz, fallo conserva dirty, cancelar no descarta; R03, R15 |
| F07 | Frontera loopback y acceso a archivos | F01, F03 | Origen ajeno/token ausente/traversal/symlink rechazados; R13, R14 |
| F08 | Roundtrip offline y recuperación | F04–F07 | Reiniciar navegador/companion; conservar vacío, borrador, entities y bindings obsoletos; importar limpia aprobación con aviso sin perder medios; R01–R05, R18, R19 |

**Primera secuencia de tests:** JSON vacío → borrador con nulls → importación maliciosa → write fallido conserva anterior → E2E guardar/cerrar/reabrir. La UI puede ser mínima, pero las garantías de persistencia no se posponen.

**Gate G1:** demo offline real con evidencia de archivo y reapertura, prueba de fallo de escritura, importación no destructiva y dos escritores. Ningún badge «guardado» depende de descargar un archivo o almacenar solo en memoria/localStorage.

M1 conserva visuales del storyboard aunque aún no los dibuje. No debe eliminar campos desconocidos de una versión de estilo que solo puede abrir en modo lectura.

## M2 — Prueba vertical con fixtures, no gastos

**Resultado:** exportación real de 10–15 segundos con dos escenas y audio local; el JSON sobrevive a otra sesión.

| ID | Unidad TDD y alcance | Dependencias | Pruebas / requisitos |
|---|---|---|---|
| V01 | Timeline de ms y evaluación de frame | G1 | Fronteras, frame final, seek inverso y seed; R08, R10 |
| V02 | Registry de estilos/entidades y catálogo procedural bloqueado | V01 | Cámara/personaje/auto/geología; seed/version fija e instancias aisladas; R06, R19, R20 |
| V03 | Preview y overlays por tiempo | V01, V02 | Captions/labels en zonas seguras con Chromium; R08, R10, R16 |
| V04 | Activo de voz fixture, alineación y aprobación mínima | F05, V01 | Bindings/aceptación manual, duración, silencios y palabras de borde; R05, R10, R17, R18 |
| V05 | Worker de captura y encoder | V02–V04 | Chromium+FFmpeg reales, composición completa y ffprobe; R09 |
| V06 | Colas, revisión, cancelación y límites | V05 | Aborto mata hijos propios, disco/buffer acotados; preflight bloquea medios/aprobación obsoletos y recibo vincula MP4/opciones; R11, R18 |
| V07 | Comparativa preview/export y continuidad | V03–V06 | Frames/poses/captions; mismo auto entre escenas y ratios modelo; R08–R10, R19, R20 |
| V08 | Demo reproducible de prueba vertical | V07 | Reabrir fixture, seek, exportar con/sin voz; inspección humana y técnica |

**Gate G2:** salida 1080×1920 a 30 fps, duración exacta esperada, audio audible y subtítulos incluidos. Instrumentar contadores de frames, tiempos y picos de memoria; no declarar rendimiento sin máquina de referencia y resultados.

No basta una pantalla negra con un archivo MP4 válido. Deben verse personaje y capas geológicas, movimiento de cámara, rótulo y cambio de palabras. La dirección artística se revisa contra las referencias sin exigir copia literal ni confundir prueba de tecnología con calidad final.

## M3 — Editor utilizable y adaptadores bajo autorización

**Resultado:** modificar storyboard y revisar propuestas sin perder control de versiones o costos. La fase puede completarse con adaptadores fake si no existe autorización para red facturable; en ese caso se etiqueta «integración real pendiente», no proveedor disponible.

| ID | Unidad TDD y alcance | Dependencias | Pruebas / requisitos |
|---|---|---|---|
| E01 | Editor de orden/duración/texto/visual/captions | G2 | Persistencia real y validación inmediata; R07, R16 |
| E02 | Ampliar invalidación de dependencias al editor | E01, V06 | Bindings portables ya probados en M1/M2; texto invalida voz, cámara no, duración solo revalida ajuste; identidad global invalida visual, variante no altera base; R07, R18–R20 |
| E03 | Interfaces de guion/voz y adaptadores fake | E02 | Respuestas inválidas, alineación segundos→ms y timeout incierto; R10–R12 |
| E04 | Revisión de propuestas y aprobación de solicitud | E03 | Texto/capacidad/costo potencial visibles; cancelar no llama red; R12 |
| E05 | Un adaptador real por capacidad, si autorizado | E04, gate de proveedor | Integración acotada, sin claves en artefactos, recibo sanitizado; R12, R17 |
| E06 | Manejo de fallos/reintento y snapshots | E02–E04 | Reintento nuevo explícito, resultado obsoleto y error recuperable; R11, R18 |

**Gate de proveedor independiente:** verificar términos, límites, unidad de timestamps, mecanismo de idempotencia y estimación de costo del servicio elegido. Solicitar autorización explícita de uso facturable con presupuesto antes de E05. No requerir ni leer claves para E01–E04. No inferir aprobación a partir de un botón genérico de «continuar» o de abrir un proyecto.

**Gate G3:** edición completa con save/reopen e invalidación probadas; generadores fake claramente identificados. Si E05 se realizó, documentar alcance exacto; si no, la aplicación no promete generación real.

## M4 — Portabilidad, calidad y cierre v0.1

| ID | Unidad | Dependencias | Pruebas / requisitos |
|---|---|---|---|
| H01 | Corpus de seguridad y recursos | G3 | Fuzz acotado, traversal/URL/HTML, procesos/disk/tiempos; R13, R14 |
| H02 | Accesibilidad y errores recuperables | E01, F06 | Teclado, foco, mensajes y pending states en UI real; R15, R16 |
| H03 | Calidad audiovisual y medidas | V08, E01 | Artefactos decodificados, clipping/captions/layout, métricas; R08–R10 |
| H04 | Licencias, diagnóstico y procedimiento local | H01–H03 | Fuentes/activos/binarios revisados, reporte sin secretos; R17 |
| H05 | Recorrido completo independiente | H01–H04 | Otro revisor crea/reabre/relinkea/exporta sin pasos implícitos |

**Gate G4:** todos los criterios aplicables tienen evidencia reproducible y limitaciones publicadas. No elevar a SaaS ni habilitar estilos/proveedores futuros para declarar terminado.

## Matriz de oráculos críticos

| Prueba | Oráculo real | No sustituir por |
|---|---|---|
| Guardado confirmado | Bytes de archivo final, reopen en proceso nuevo y digest esperado | HTTP 200 sin verificar disco |
| Atomicidad | Inyectar fallos antes/después de commit; lector ve anterior o nuevo completo | Mock que siempre retorna éxito |
| Portabilidad | Dos carpetas aisladas, assets copiados y hash; relink de faltante | Array de paths en memoria |
| Determinismo | Estado exacto por frame + capturas repetidas con tolerancia fijada | «Animación parece suave» |
| Composición | PNG/frames decodificados muestran canvas y DOM; inspector y revisión humana | Exportar solo canvas |
| Audio/sincronía | Duración/PTS con herramienta de inspección y escucha; palabras en frames frontera | Contar callbacks de audio |
| Cancelación | PID propios terminados, pipes cerrados y temporal no publicado | Estado UI `cancelled` únicamente |
| Seguridad de origen | Solicitudes reales desde origen ajeno/token ausente rechazadas | Verificar booleano de CORS |
| Sin gastos implícitos | Proxy/spy de red registra cero peticiones antes de autorización | Botón gris sin mirar backend |
| Continuidad | Diseño/seed/version/ratios del auto iguales entre escenas; materiales/rig aislados, revisión visual bajo cámaras distintas | Solo comparar entityId o exigir píxeles idénticos bajo otra luz |
| Vigencia portable | Editar texto sin borrar voz/timings, guardar y abrir en otro workspace: siguen obsoletos y export bloqueado; aceptar manualmente actualiza solo bindings revisados | Depender del journal local o recalcular bindings al abrir |

## Casos mínimos del corpus de seguridad

- Archivos JSON inválidos/truncados, claves duplicadas, profundidad 17 y más de 2 MiB.
- `../../`, rutas absolutas POSIX/Windows, backslash, `%2e`, `file:`, `data:`, URLs remotas y symlinks.
- `__proto__`, `constructor`, `prototype`, HTML con handlers y texto de comandos shell.
- `styleId` inexistente, versión futura, componente/props desconocidos y schema ausente.
- Entity/versión inexistente, override de proporciones en instancia, escala no uniforme heredada, variante cíclica y mutación de material/rig compartido.
- Asset declarado pequeño con contenido grande, MIME falso, imagen con dimensiones excesivas y audio excedido.
- Hash alterado, archivo borrado después de importar, nombre duplicado y conflicto de revisión.
- Binding nulo/alterado, texto editado con medios retenidos, approval importada/obsoleta y MP4 sin recibo; guardar es válido pero usar/exportar obsoletos se bloquea. Cámara/orden/gain no provocan regeneración de voz ni alineación; duración solo bloquea si deja de caber.
- Navegación/cambio mientras guardar falla o sigue en curso; UI editada durante commit.
- Worker bloqueado, frame timeout, proceso hijo caído, disco insuficiente, encoder fallido y cancelación en cada etapa.
- Respuesta de proveedor inválida o tardía tras cambiar escena; timeout ambiguo sin retry automático.
- Secreto canario en adaptador fake: ausente de JSON, MP4 metadata, journal, errores y reporte.

El contenido hostil se trata como datos de prueba, no como instrucciones. Las pruebas no usan claves reales ni salida a Internet por defecto.

## Browser y evidencia

Pruebas DOM de formularios, lógica y errores JS: Lightpanda cuando soporte el recorrido. Layout, foco visible, captura WebGL, zonas seguras, solapamientos y screenshots: **Chromium con Playwright estándar**. Si un recorrido mezcla ambos, usar Chromium. No usar dumps textuales como evidencia visual ni forzar clicks para ocultar fallos de interacción.

Capturar console/runtime errors explícitamente; una navegación exitosa no demuestra que estén ausentes. Guardar evidencia sanitizada y versión de navegador/GPU/fuentes para explicar diferencias de rasterización.

## Mediciones y readiness

| Elemento | Estado hoy | Antes de declarar listo |
|---|---|---|
| Schema ejecutable | Propuesto en documento | F02 con fixtures/corpus y roundtrip |
| Guardado atómico | Diseño propuesto | F03/F08 en filesystem real |
| Renderer | Sin implementar por esta tarea | V05–V08 con MP4 y comparación visual |
| Límites de recursos | Defaults propuestos | V06/H01 con watchdog y fallo controlado |
| Rendimiento | Sin mediciones nuevas | Máquina de referencia, picos RSS/disco/tiempo y latencias |
| Proveedores | No activados | Gate independiente, E05 opcional autorizado |
| Seguridad y licencias | Riesgos identificados | H01/H04, revisión independiente |

No se asignan fechas ni duración estimada sin implementación/mediciones. Si un gate falla, se corrige la unidad relacionada antes de agregar nuevas capacidades; no se oculta el fallo tras una fase adicional.

## Riesgos y respuesta acotada

| Riesgo | Mitigación / señal para revisar |
|---|---|
| Calidad 3D insuficiente | Fixtures dirigidos y revisión visual en G2 antes de generadores |
| Memoria/tiempo de screenshots | Medir con prueba de 12 s; backpressure y límites; reconsiderar motor solo con evidencia |
| JSON no portable | Manifest, copia completa y prueba entre workspaces desde M1 |
| Perder trabajo ante fallo | Guardado explícito temprano, dirty veraz y atomicidad; sin promesa de autosave |
| Repetición de cargos | Manual approval por intento; incertidumbre visible; no retry automático |
| Licencias de assets/codecs | Registro de procedencia y gate antes de redistribuir |
| Scope multiestilo ilimitado | Registro extensible, un estilo shipping; resto no disponible |

## Contrato de coordinación con UX

- «Guardar» usa companion y confirma commit; «Descargar JSON» no es sinónimo.
- Inicio ofrece crear/abrir proyectos del workspace e importar copia externa.
- Borrador incompleto puede guardarse sin banners que lo llamen inválido; exportar indica pendientes concretos.
- Mostrar dirty/error/conflicto y advertencia de perder cambios desde M1.
- Relink permite elegir archivo, presenta hash distinto y no busca URLs automáticamente.
- Mostrar estilo inicial real; los futuros se identifican como no disponibles.
- Elementos reutilizables tienen identidad estable; primeros diseños bloqueados. Transformar/mover no rediseña; variante/global son operaciones distintas, sin editor 3D completo.
- Progreso/cancelación/exportación de versión anterior son estados diferenciados.
- Voz ausente requiere elección explícita para salida silenciosa.
- `upper` es anchor válido y default inicial; `center`/`lower` siguen disponibles. Audio/words «sin verificar» u «obsoletos» se conservan; revisar/aceptar, regenerar autorizado o excluir su uso, nunca marcar actuales al abrir. Importar/copia pide nueva aprobación editorial, no gasto ni reanudación de jobs.
- Ninguna pantalla debe sugerir que la planificación ya pasó pruebas de producto.
