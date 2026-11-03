# Requisitos de Molecula Studio v0.1

Molecula Studio será un estudio web **local-first** para convertir una idea en un video vertical animado, editable y reproducible. La primera entrega funcional debe guardar y reabrir proyectos incompletos sin conexión ni proveedores. Este documento es un plan, no evidencia de implementación ni aprobación de nuevas decisiones técnicas.

## Ruta de lectura

1. Revisar alcance y criterios de aceptación de este documento.
2. Consultar [formato de proyecto](project-format.md) para persistencia y ejemplos.
3. Consultar [arquitectura](architecture.md) para responsabilidades y seguridad.
4. Revisar [continuidad visual](visual-continuity.md) y ejecutar posteriormente [entregas](delivery.md), con pruebas antes de implementación.

Los bosquejos y la interacción visual se documentan por separado por el responsable UX. Este contrato define comportamiento, no sustituye sus pantallas.

## Estado de las decisiones

| Categoría | Estado |
|---|---|
| Plan antes del desarrollo | Solicitado por el usuario |
| Guardar/reabrir desde primera fase | Requisito explícito; JSON simple, sin base de datos |
| Capacidad de múltiples estilos | Dirección solicitada; no significa varios estilos implementados en v0.1 |
| Stack, límites y detalles del formato | Baseline técnico propuesto y revisable por los agentes |
| Implementación, instalaciones, servicios o gastos | Fuera de esta intervención documental |

Una vez verificado el plan, no hace falta una aprobación técnica rutinaria adicional para considerar M1 listo para comenzar. Esto no convierte esta solicitud de planificación en autorización para escribir producto o activar proveedores.

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
- Riesgos pendientes están visibles; ningún documento afirma que la implementación fue validada.

El siguiente paso documental es verificar este conjunto junto con UX. El siguiente paso de producto, en una intervención de desarrollo, es M1; no conectar proveedores primero.
