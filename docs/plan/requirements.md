# Requisitos de Molecula Studio v0.1

Molecula Studio es un estudio web **local-first** para convertir una idea en un video vertical animado, editable y reproducible. Este es el **PRD canónico** de v0.1: funciones, reglas R01–R20 y aceptación. M1/G1 técnico local y V01 están implementados/revisados en `cbfc125`; composición, MP4 y editor audiovisual siguen pendientes. La evidencia está en [delivery](delivery.md), no se infiere de este PRD ni se repitió durante esta revisión documental.

## Ruta de lectura

1. Revisar alcance y criterios de aceptación de este documento.
2. Consultar [formato de proyecto](project-format.md) para persistencia y ejemplos.
3. Consultar [arquitectura](architecture.md) para responsabilidades y seguridad.
4. Revisar [continuidad visual](visual-continuity.md) y ejecutar posteriormente [entregas](delivery.md), con pruebas antes de implementación.

Layout/componentes: [UX](../ux/components.md). Transporte y DTO: [API](api-contracts.md). Trabajo delegable: [tarjetas](implementation-tasks.md). Estos documentos detallan el PRD sin duplicar su autoridad sobre alcance.

## Estado de las decisiones

| Categoría | Estado |
|---|---|
| Plan antes del desarrollo | Solicitado por el usuario |
| Guardar/reabrir desde primera fase | Requisito explícito; JSON simple, sin base de datos |
| Capacidad de múltiples estilos | Dirección solicitada; no significa varios estilos implementados en v0.1 |
| Stack, límites y detalles del formato | Base M1/schema 1 implementada; límites AV/engine futuros documentados como diseño, no mediciones |
| Implementación, instalaciones, servicios o gastos | Fuera de esta intervención documental |

M1 ya cerró su alcance técnico local. La intervención actual solo prepara documentación antes de más código: no inicia V02, elige modelo ni autoriza instalaciones, media nativa, proveedores o gastos. Las decisiones técnicas acotadas se documentan; los permisos y decisiones de producto genuinos están en el [registro](implementation-tasks.md#registro-de-decisiones-y-autorizaciones).

## Usuario, necesidad y criterio de valor

Usuario inicial: creador individual trabajando en su propio equipo, sin cuenta, equipo colaborativo ni operador de infraestructura. Necesita conservar una idea incompleta, entender qué falta y producir un video vertical verificable sin perder ediciones ni depender de un servicio pago. Éxito de v0.1: otra persona reproduce el recorrido offline de creación→edición→reapertura→revisión→exportación, comprende obsolescencia/errores y conserva datos ante fallos previstos. No se mide éxito por cantidad de botones ni por una demo que solo funciona en memoria.

Prioridad obligatoria: persistencia y control de versiones, luego prueba audiovisual determinista, editor utilizable y hardening. Generación real es opcional (E05), no condición para G3 ni v0.1 offline. Rendimiento y calidad visual requieren medidas/revisión humana, no objetivos comerciales inventados ni garantía de fidelidad automática a referencias.

## Producto y recorrido principal

El creador abre el estudio local, crea un proyecto, escribe una idea y guarda. Puede cerrar y volver a abrir el proyecto aunque no tenga escenas, voz, activos o subtítulos. Después construye un storyboard, revisa cada escena, previsualiza y exporta un MP4. Las generaciones remotas solo existen en una fase posterior y requieren una acción explícita informada.

| Paso | Resultado observable |
|---|---|
| Crear | Proyecto vacío editable con nombre, idea y configuración |
| Guardar | Confirmación de escritura finalizada en carpeta local controlada |
| Reabrir | Recuperación de configuración, trabajo parcial y referencias a activos |
| Planificar | Escenas con guion, duración, intención visual y estilo disponible |
| Revisar | Validación visible, pendientes y resultado por escena |
| Animar | Cámara, objetos, rótulos y subtítulos evaluados por tiempo |
| Exportar | MP4 vertical con composición completa, audio si fue elegido y reporte de resultado |

## Alcance por entrega

### M1: persistencia antes de generación

- Estudio y companion local, creación de proyecto y edición manual mínima de nombre, idea y escenas de texto.
- Guardar, guardar copia y abrir desde workspace; importación explícita de JSON externo.
- Sincronización del estado modificado, errores de guardado, conflictos y advertencia de salida.
- Proyecto incompleto válido: cero escenas; escenas sin visuales o voz; activos faltantes.
- Sin API de IA, credenciales, navegador de render ni FFmpeg obligatorios para guardar.

### M2: prueba vertical determinista

- Película de referencia de 10–15 segundos, 1080×1920, 30 fps, con dos escenas.
- Primer estilo realmente disponible: `stylized-3d`, mediante componentes procedurales acotados.
- Personaje estilizado sencillo y explicación geológica con luz diurna como fixtures, no promesa de copiar las referencias con fidelidad automática.
- Cámara con movimiento parametrizado; textos/indicadores SVG o DOM y subtítulos por palabra.
- Identidades de personajes/elementos compartidas entre escenas: registro persistente, definiciones bloqueadas y referencias estables; no se regenera el diseño por escena.
- Audio fixture local con licencia documentada; también exportación silenciosa explícita.
- Previsualización, seek arbitrario y exportación comparten composición y reloj.
- Ningún proveedor real ni gasto requerido para demostrar el recorrido.

### M3 y M4: editor y generación controlada

- Editor por escena de texto, orden, duración, preset visual, cámara, subtítulos y voz.
- Adaptadores de guion y voz intercambiables; inicialmente simulados y offline.
- Habilitación real de un proveedor por capacidad únicamente con autorización explícita separada.
- Revisión humana antes de usar propuestas generadas y antes de cualquier nueva operación facturable.
- Validaciones, recuperación de fallos, portabilidad y calidad audiovisual para declarar v0.1 utilizable.

## Exclusiones explícitas

No se incluyen SaaS, alojamiento público, cuentas, colaboración simultánea, base de datos, pagos, analítica remota, generación masiva, editor de código, instalación automática de modelos, entrenamiento ni generación arbitraria de geometría. Tampoco efectos ilimitados, físicas, videos largos, formatos horizontales, mezclas de estilos por escena o importación de proyectos de otras aplicaciones.

Un estilo futuro puede aparecer como «No disponible», sin generar ni renderizar bajo esa etiqueta. No habrá botones que simulen capacidades no implementadas.

## Ajustes respecto a la especificación original

Se conserva intacto [el original](../reference/original-specification.md). Las siguientes decisiones son sustituciones propuestas, no correcciones sobre ese archivo.

| Original | Plan de v0.1 | Motivo |
|---|---|---|
| Isometría fija, noche y low poly obligatorio | Estilo 3D estilizado con cámara y luz parametrizadas | Las referencias revisadas incluyen personaje frontal y geología diurna con movimiento |
| Una palabra en centro exacto | Subtítulos con zona segura y énfasis editable | No tapar personaje ni información relevante |
| Solo canvas en captura | Capturar raíz de composición con canvas, DOM y SVG | El canvas aislado omitiría subtítulos y rótulos |
| Ejemplos `0.45` descritos como milisegundos | `450` ms enteros | El original mezcla segundos decimales con etiqueta de milisegundos |
| `.env` con claves como estructura base | Ningún secreto en proyecto; sesión por defecto en futuro | Evitar filtraciones y dependencias tempranas de proveedores |
| Script que produce video completo inmediatamente | Guardar primero; fixture vertical después; proveedores al final | Reducir riesgo y preservar trabajo desde el inicio |

Las observaciones de referencias provienen de la investigación previa compartida; este documento no afirma haber vuelto a medir esos videos.

## Requisitos y aceptación

Los identificadores son estables para vincular pruebas y entregas. «Aceptar» describe evidencia futura necesaria; hoy no implica PASS.

| ID | Requisito | Evidencia de aceptación |
|---|---|---|
| R01 | Crear y guardar sin red | Crear proyecto vacío, editar idea, guardar, cerrar servidor y navegador, reabrir en nueva sesión sin red y recuperar datos |
| R02 | Trabajo parcial de primera fase | Escena de texto sin visual/voz y activo faltante hacen roundtrip sin borrarse ni bloquear guardado |
| R03 | Guardado veraz y seguro | Solo mostrar «Guardado» después de confirmación del companion; fallo previo al commit conserva anterior/dirty; fallo posterior incierto exige verificar archivo sin falsa confirmación |
| R04 | Apertura no destructiva | JSON inválido, exceso o versión futura dejan intacto el proyecto activo |
| R05 | Portabilidad | Copiar JSON y carpeta de activos a otro workspace; verificar archivos y resolver faltantes sin rutas absolutas |
| R06 | Estilos honestos | Solo `stylized-3d` permite crear/renderizar; estilo desconocido abre advertencia de solo lectura |
| R07 | Storyboard editable | Cambiar texto/orden/duración conserva IDs, actualiza revisiones e invalida únicamente dependencias afectadas |
| R08 | Reloj determinista | Pedir un mismo frame antes y después de seek inverso produce mismo estado; seed persiste |
| R09 | Exportación completa | MP4 de fixture incluye 3D, subtítulos DOM, rótulos, cámara y audio; inspector confirma resolución/fps/duración |
| R10 | Sincronía | Caption visible en intervalo definido y audio alineado; sin deriva acumulada en prueba completa |
| R11 | Jobs recuperables | Cancelación/fallo liberan hijos y archivos temporales; reintento nuevo no duplica gastos silenciosamente |
| R12 | Proveedores bajo control | Adaptador fake prueba flujo; real solo tras aprobación por operación y sin secretos en JSON/logs |
| R13 | Importación hostil | Corpus de traversal, URL, HTML, claves peligrosas y excesos no ejecuta código ni provoca red/escritura fuera de workspace |
| R14 | Contención local | Origen ajeno o token ausente no puede leer/escribir/renderizar; renderer sin acceso remoto |
| R15 | Salida consciente | Abrir/cambiar/cerrar con cambios ofrece guardar, descartar explícito o cancelar; descarga no equivale a guardado |
| R16 | Calidad mínima accesible | Estado no solo por color, teclado/foco, textos legibles y controles con nombre; Chromium confirma composición |
| R17 | Derechos y diagnóstico | Activos/fuentes registran procedencia/licencia; reporte sanitizado permite localizar fallos sin claves ni guion completo |
| R18 | Revisión y aprobación vinculadas | Binding portable conserva obsolescencia de voz/timings tras guardar/importar; aprobación por digest no renueva medios ni jobs; resultado viejo no reemplaza escena modificada ni MP4 se presenta actual sin recibo coincidente |
| R19 | Identidad visual persistente | Mismo auto entre escenas conserva geometría, proporciones y materiales; guardar/reabrir mantiene registro, versiones y referencias |
| R20 | Instancias y variantes seguras | Pose/cámara no deforman proporciones; materiales/rig no contaminan otras instancias; variante explícita con lineage, sin overrides de identidad |

## Reglas de negocio transversales

1. **Borrador válido no equivale a salida lista.** Guardar no exige voz/visual/approval; preview/export consumen solo capacidades y medios verificados. Un manifest PNG/JPEG/audio admitido no promete que imágenes se compongan en el catálogo procedural inicial.
2. **Una aprobación editorial completa.** Solo `project.approval` sobre contentDigest completo; revisar guion/visual o aceptar bindings no crea sellos parciales. La «aprobación mínima» M2 es la misma regla con fixture/UI acotada, no un bypass. Cambiar opciones de salida invalida la aprobación si cambia digest.
3. **Tres acciones distintas:** guardar canónico confirma disco; copia portable crea ID nuevo/revisión 0/fechas nuevas; descarga solicita bytes, no limpia dirty ni acredita escritura. Importar sin colisión limpia approval existente con incremento de revisión/fecha; import con colisión-copy se clona a revisión 0. Conservar bindings/medios no los vuelve actuales.
4. **Edición no borra evidencia.** Conservar medios y approval históricos; derivar vigencia por dependencias/digests/archivos. Resultados tardíos pertenecen a su snapshot y no reemplazan borrador nuevo. Retención local es acotada con protección/rechazo previo, no historial ilimitado ni jobs dentro del JSON.
5. **Exportar es explícito.** Elegir con/sin voz y captions, revisar bindings consumidos, aprobar y guardar; preflight revalida, snapshot inmutable, publicación solo tras verificar. Silent no consume audio viejo, pero puede exigir revisar timings antes ligados a voz. Cancel/fallo conserva última salida válida.
6. **Autoridad separada.** Approval editorial, confirmación de envío, autorización externa de proveedor/presupuesto y permisos del harness son cosas diferentes. Abrir/guardar/aceptar propuesta no autoriza operación facturable futura. Incertidumbre remota nunca permite retry automático.
7. **Sin simulación de disponibilidad.** Estilo futuro, motor faltante y proveedor fake están etiquetados; no rediseño/GLB/script/HTML arbitrario. Un error recuperable no destruye proyecto activo ni impone regenerar todo.

Detalles normativos y algoritmos se mantienen en [formato](project-format.md), [API](api-contracts.md) y [arquitectura](architecture.md); no crear proyecciones de digest alternativas en UI.

## Trazabilidad función → regla → recorrido → contrato → trabajo

P1–P6 son pantallas de [UX](../ux/screens.md), F1–F7 flujos de [UX](../ux/flows.md), no tareas F01–F08. Las tarjetas futuras identifican tests/oráculos exactos; evidencia histórica F08/V01 está en delivery.

| Función | Regla | Pantalla / flujo | Datos / API canónicos | Tarea y evidencia |
|---|---|---|---|---|
| Crear y retomar offline | R01 | P1/P2, F1 | Project; create/read/save | F04/F08 verificados; H05a mantiene proceso nuevo |
| Conservar incompleto | R02 | P2/P3/P6, F1/F5 | nulls/manifest, schema 1 | F02/F08 verificados; V06a no bloquea guardar |
| Guardar de forma veraz | R03 | P2, F1/F2 | SaveReceipt/CAS/uncertain | F03/F06/F08 evidencia; C01 guard de revisión y H05a |
| Abrir/importar seguro | R04 | P1, F2 | parse/read/import/mode/raw | F02/F05/F08 evidencia; H01a corpus |
| Transportar/revincular | R05 | P1/P6, F2/F5 | CopyResult/ImportResult/RelinkResult; ingesta nueva futura | F05/F08 evidencia; V04a/E01c/H05a disco/hash |
| Mostrar estilos reales | R06 | P2/P4, F3 | styleId/version, registry | F02 envoltorio; V02b/V03a no fallback |
| Editar storyboard | R07 | P3/P4, F3/F4 | Scene/SceneEdit/revisiones | F04 texto mínimo; E01a/b/E02a save/reopen |
| Seek determinista | R08 | P4, F6 | FrameSample/EvaluatedFrame | V01 metadatos verificados; V02a/V07a/H03a |
| Exportar composición | R09 | P5, F6 | runtime/Job/ExportReceipt | V05a–d/V08a/H03a MP4 real |
| Sincronizar voz/palabras | R10 | P3/P4/P5, F4/F6 | audio/words/bindings/reloj | V04a/b/V03c/E03b/H03a PTS+escucha |
| Recuperar/cancelar jobs | R11 | P5, F6/F7 | journal/Job/attemptId | V06b/c/E06a/b/H01b PIDs/disco |
| Generación controlada | R12 | P3/P6, F7 | RequestPreview/authorization/Proposal | E03/E04 fake; E05 opcional real con D04 |
| Entrada hostil | R13 | P1/P6, F2/F5 | parser/asset validators/DTO cerrados | F02/F07 existentes; H01a real boundary |
| Contención local | R14 | Todas, F1–F7 | token/Origin/Host/resources por ID | F07/F08 existentes; V05a/H01a sin escapes |
| Salir sin perder datos | R15 | Cabecera/diálogo, F1/F2 | dirty/receipt/RecoveryDialog | F06/F08 existentes; E01a/H02a |
| Accesibilidad/claridad | R16 | Todas, F1–F7 | componentes/estados/labels | V03b/E01/H02a Chromium+teclado |
| Derechos/diagnóstico | R17 | P6, F5/F7 | Asset.source/diagnóstico sanitizado | V04a/D01/H04a/b licencia/canarios |
| Revisión y vigencia | R18 | P3/P5, F3/F4/F6 | bindings/approval/receipt/snapshot | F08 persistencia; V04b/V06a/d/E02/E06 |
| Identidad entre escenas | R19 | P4, F4/F5 | entities/ref/version/seed | F02/F08 datos; V02/V07/E02 geometría+visual |
| Aislamiento/variantes | R20 | P4, F4/F5 | identity/instance/variantOf | F02 estructura; V02b/c/V07a/E02a |

## Aceptación de producto y estado técnico

**Implementado** significa código y pruebas de su unidad; **aceptación técnica** exige oráculo real y revisión independiente; **aceptación visual/auditiva humana** registra juicio del producto sobre artefacto/versiones concretos. Ninguna implica las otras. M1/G1 y V01 tienen aceptación técnica acotada, no estética aprobada ni sincronía AV medida. La matriz anterior no convierte todos los R en PASS: partes audiovisuales, editor completo y H01–H05 esperan sus tarjetas/gates.

## Estados que deben ser visibles

| Objeto | Estados mínimos |
|---|---|
| Documento | Nuevo sin guardar, modificado, guardando, guardado, error, conflicto, solo lectura incompatible |
| Escena | Borrador, incompleta, lista para preview, lista para exportar, resultado obsoleto; derivados, no persistidos como verdad |
| Activo | Disponible, faltante, hash distinto, formato no admitido |
| Trabajo | `queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`; además resultado `current` o `stale` |
| Proveedor | No configurado, preparado para solicitud manual, pendiente de aprobación, ejecutando, fallido |

Guardar un borrador no exige una escena exportable. Exportar sí exige que las escenas cubran toda la duración, tengan visuales disponibles y que audio/subtítulos elegidos sean válidos. La ausencia de voz debe resolverse con «Exportar sin voz», no con audio inventado.

## Límites de producto propuestos

Estos números son defaults de protección a validar en M2/M4; no son resultados medidos ni garantía de rendimiento.

| Recurso | Default v0.1 | Al exceder |
|---|---|---|
| Duración total | 60 000 ms; prueba inicial 12 000 ms | Bloquear acción que excede y explicar límite |
| Escenas | 12, cada una 1 000–15 000 ms | Rechazar importación excedida o edición con error recuperable |
| Guion | 12 000 caracteres total; 2 000 por escena | Validación antes de guardar/importar/solicitar proveedor |
| JSON | 2 MiB UTF-8; profundidad 16 | Rechazar antes de activar documento |
| Activos | 100 archivos; 50 MiB/archivo; 500 MiB/proyecto | No copiar parcialmente; informar archivo y espacio necesario |
| Identidades | 32 definiciones; 16 instancias visuales por escena | Rechazar exceso; no generar identidades sustitutas silenciosas |
| Render | Uno activo; hasta dos en cola | Rechazar cola adicional con motivo |
| Generación | Una solicitud remota activa, sin fan-out | Esperar o cancelar explícitamente |
| Pantalla | Desktop desde 1280×800 como objetivo inicial | No prometer edición móvil |
| Salida | MP4, 1080×1920, 30 fps, H.264/AAC | No selector de formatos que no existen |

Límites numéricos adicionales del renderer y del schema se centralizan en [arquitectura](architecture.md#presupuestos-y-contención) y [formato](project-format.md). Cambiarlos requiere actualizar prueba, contrato y mensaje UX conjuntamente.

## Criterio de cierre de planificación

- Cada R tiene una tarea y una prueba identificable en delivery.
- Guardar/reabrir y faltantes están contemplados en bosquejos UX.
- Ambos JSON ilustrativos concuerdan con el contrato escrito.
- No hay contradicción entre tiempo, revisión, recursos, persistencia y exportación.
- Riesgos pendientes están visibles; solo las unidades con evidencia atribuida se describen como verificadas.

El siguiente paso es una revisión documental independiente fresca de PRD/contratos/UX/tarjetas. Después, con autorización de desarrollo, C01 precede a los nuevos consumidores de V02–V08; no iniciar V02 ni conectar proveedores durante esta intervención.
