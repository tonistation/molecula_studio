# Flujos recuperables por fase

**Regla principal:** guardar y reabrir trabajo incompleto forma parte de M1, antes de cualquier proveedor o render. Los siguientes flujos son contratos de experiencia pendientes de implementación, no pruebas ya ejecutadas.

## F1 · Crear, guardar y retomar un borrador — M1

```text
P1 Nuevo proyecto → P2 idea parcial → Guardar
  → companion valida identificador y configura espacio autorizado
  → valida documento → escritura atómica de JSON
  → respuesta de persistencia confirmada → actualizar revisión/último guardado
Cerrar → P1 Abrir proyecto → leer/validar JSON → mostrar mismo borrador
```

1. No solicitar cuenta, API key, modelo, audio o conexión externa.
2. Mantener un estado modificado desde el primer cambio. Permitir nombre predeterminado y campos incompletos.
3. Guardar una instantánea de la revisión solicitada. La atomicidad debe evitar dejar el JSON truncado; técnica, garantías ante cierre y recuperación de temporales se definen en arquitectura.
4. «Guardado» significa confirmación real del companion tras completar la persistencia acordada, no enviar una petición ni actualizar una marca local. Si el usuario editó durante la escritura, el éxito corresponde a la instantánea enviada y los cambios nuevos siguen «sin guardar».
5. Reabrir restaura idea, estilo, configuraciones, escenas parciales y referencias disponibles. Trabajos que figuraban activos quedan «Interrumpidos: requieren revisión», nunca se reanudan automáticamente.

**Medios y aprobación al reabrir:** reabrir un proyecto del workspace conserva la aprobación válida; si el contenido cambió, se muestra obsoleta por digest y no se borra. Conservar referencias no certifica la vigencia de medios: mostrar «Pendiente de validación» u «Obsoleto» y bloquear reproducción/exportación dependiente hasta resolver vínculo y revalidar procedencia y entradas. Si faltan vínculos o evidencia, conservar contenido sin tratarlo como actual ni regenerarlo automáticamente. La UX no introduce campos nuevos de procedencia.

**Importar desde fuera o clonar:** importar un JSON externo o **Guardar copia portable** limpia `approval` con aviso explícito, conserva medios, referencias y `mediaBindings`, y registra la edición —revisión y fecha nuevas— antes del commit; la UI muestra «Sin aprobación», nunca «Pendiente de validación». Exportar exige una nueva aprobación editorial: un sello importado no se reutiliza como confianza local ni reanuda jobs.

**Fallo de guardado:** mantener borrador y estado dirty; conservar última revisión/hora confirmada; explicar permiso/espacio/conexión cuando se conozca; reintentar sin generar duplicados involuntarios. Si el proceso muere antes de la primera escritura exitosa, la edición en memoria puede perderse: no prometer autosave o recuperación inexistentes.

**Continuidad persistida desde M1:** guardar/abrir conserva registro `entities`, `entityId`, `definitionVersion` y referencias de instancias, incluso con recursos ausentes. No reconstruir diseños independientes por escena al reabrir.

**Conflicto externo:** comprobar revisión/identidad de archivo antes de sobrescribir; no resolver con «última escritura gana» de forma silenciosa. La comparación exacta y la política de recuperación quedan en el contrato técnico.

## F2 · Abrir/importar sin perder el documento activo — M1

```text
Abrir proyecto
  → ¿cambios sin guardar? → guardar y continuar / descartar / seguir editando
  → selector cancelado: no cambiar documento
  → archivo elegido: leer como entrada no confiable
  → validar tamaño/formato/versión/estructura y referencias permitidas
     ├─ inválido o versión futura → error; documento actual intacto
     └─ válido → preparar/importar en espacio controlado
                 → confirmar apertura → cambiar documento activo
                 → revisar recursos ausentes en P6
```

La confirmación «Descartar» autoriza abandonar cambios solo cuando haya un reemplazo válido listo; un error de lectura/importación no debe vaciar el editor. Si se opta por «Guardar y continuar» y falla la escritura, detener la navegación. En navegación interna aplicar guarda; al cerrar pestaña usar advertencia nativa cuando sea viable, sin prometer texto personalizado ni bloquear el sistema operativo.

**Separar operaciones:**

| Acción | Significado | Qué no implica |
| --- | --- | --- |
| Guardar | Actualiza el JSON canónico del proyecto en el espacio controlado y confirma revisión. | No es una descarga del navegador. |
| Guardar copia portable | Crea una carpeta nueva con `project.json` y todos los activos referenciados disponibles; confirma solo al completarse la copia. | No sobrescribe el proyecto abierto, no reutiliza su `projectId` y no es «Descargar copia JSON». |
| Descargar copia JSON | Solicita exportación de configuración JSON del borrador; indicar si incluye cambios no guardados. No limpia estado dirty. | No verifica que el navegador haya escrito en disco; no actualiza revisión canónica ni incluye recursos; no es portable por sí sola. |
| Abrir proyecto | Recupera un proyecto local autorizado o importa un JSON desde selector y valida antes de activarlo. | El nombre/ruta del navegador no otorga acceso al sistema de archivos. |

**Portabilidad:** **Guardar copia portable** produce una carpeta nueva con `project.json` y todos los activos referenciados disponibles, usando `projectId` nuevo, revisión raíz 0 y fechas nuevas, y conservando IDs y versiones de entidades y escenas. Se confirma solo al completarse la copia; si faltan activos se avisa cuáles y la copia queda como borrador, nunca etiquetada «completa». Para transportarla se mueve la carpeta entera junto con `assets/` —rutas planas `assets/<assetId>.<ext>`—, sujeta a validación local; no hay ZIP en v0.1. Schema 1 usa entidades de catálogo procedural, no importación de modelos o fuentes. Importar desde fuera o clonar limpia la aprobación con aviso y exige nueva revisión editorial. Copiar solo el JSON permite abrir texto/identidades, pero muestra audio ausente y bloquea operaciones dependientes. Ni presencia del archivo ni nombre idéntico prueban vigencia. No leer rutas absolutas de terceros.

## F3 · Escribir, ordenar y aprobar — M1 texto; M3 editor

```text
P2 idea → P3 escribir escenas manualmente → guardar cualquier avance [M1]
  → fixture preparada y exportación técnica acotada de 10–15 s [M2]
  → revisar orden/texto/intención visual → aprobar revisión en editor [M3]
  → importar voz/tiempos admitidos o preparar manualmente → P4 [M3]
```

- La aprobación es explícita y distinta de Guardar. Un documento guardado puede seguir incompleto.
- Añadir, mover o quitar escena invalida aprobación pertinente. Eliminar escena con contenido requiere confirmar el efecto sobre sus referencias; no borrar archivos físicos como efecto lateral silencioso.
- Descripciones visuales no son comandos ejecutables; el editor solo permite parámetros del esquema soportado.
- El contenido manual/de prueba identifica su origen. Ningún control debe fingir que una fixture es resultado del proveedor.

## F4 · Cambiar contenido sin destruir resultados aprobados — M2 prueba; M3 UI

La invalidación avanza **solo hacia dependencias descendentes**. No reiniciar todo por cada cambio ni sobrescribir resultados anteriores.

| Cambio de entrada | Pasa a pendiente/obsoleto | Se conserva |
| --- | --- | --- |
| Texto de narración | Aprobación editorial pertinente, voz de los clips con texto cambiado, alineación y montaje/subtítulos/render dependientes. | Clips de texto e inputs de voz idénticos con vínculo vigente; versión aprobada anterior identificada. |
| Inputs de voz (voz elegida, parámetros o velocidad de síntesis) | Voz y alineación dependientes, montaje, encaje temporal, subtítulos y render. | Texto y aprobación editorial si no cambiaron; entidades visuales. |
| Sustitución de audio | Vínculo/procedencia, alineación, encaje, montaje/subtítulos y render dependientes: requieren validación. | Texto y referencias previas; no solicitar síntesis por el mero reemplazo. |
| Reordenar escenas con narraciones idénticas | Aprobación del orden, montaje/línea temporal global, subtítulos globales y render. | Clip de voz y alineación local de cada narración si inputs y vínculos siguen vigentes; no regenerar voz. |
| Ajustar duración de escena | Revalidar encaje audio/escena, montaje y temporización dependiente; render. | Voz y alineación local si sus inputs no cambiaron. Si no encaja, bloquear salida y ofrecer ajuste manual; no síntesis automática ni gasto implícito. |
| Estilo o preset visual | Compatibilidad/aprobación visual, previsualización y render; recursos incompatibles se señalan. | Guion y voz si el estilo no altera sus entradas. Si sí las altera, mostrar dependencias específicas. |
| Recurso, cámara o luz de una escena | Previsualización y render afectados; aprobación visual pertinente. | Texto, audio y tiempos si no dependen de ese cambio. |
| Apariencia/posición del subtítulo | Previsualización y render. | Voz y alineación. |

Antes de regenerar, resumir alcance, entradas, reemplazos propuestos y eventual coste. Una solicitud usa una instantánea concreta. Si el borrador cambia mientras llega el resultado, guardarlo como resultado de la revisión anterior, no aplicarlo al borrador actual sin revisión.

**Fallo o cancelación del proveedor:** no sustituir la versión aprobada con salida vacía/parcial; mantener la propuesta nueva como fallida/cancelada y permitir revisar o reintentar. La versión anterior no pasa a ser mágicamente vigente para el borrador modificado. La implementación define retención local acotada, sin prometer historial ilimitado ni interfaz de ramas.

## F5 · Resolver audio ausente — M1 referencias; M2 fixture; M3 UI

### Continuidad antes de revincular

El panel «Elementos del proyecto» permite elegir/reutilizar una entidad de catálogo con identidad bloqueada y consultar sus escenas. Dos escenas del mismo automóvil referencian el mismo `entityId` y `definitionVersion`, no generan dos diseños. La identidad contiene geometría, proporciones, materiales, paleta y rig; la instancia contiene pose, posición, rotación y escala uniforme; la cámara pertenece a la escena. No hay escala no uniforme. Iluminación/perspectiva pueden variar píxeles sin cambiar identidad.

Edición geométrica, rigging, edición global y creación arbitraria de variantes son futuras. El formato distingue variantes intencionales mediante identidad/versionado explícito; no se ofrece un botón activo para crearlas en MVP. Una futura modificación global debe listar usos, confirmar efectos e invalidar resultados visuales pertinentes sin actualizar escenas aprobadas silenciosamente.

```text
Abrir JSON → referencia ausente → texto editable + aviso persistente
  → P6 audio esperado → seleccionar archivo permitido → validar/importar
     ├─ cancelar/error → referencia anterior conservada
     └─ confirmar → nueva referencia controlada → marcar cambios → Guardar
```

No hace falta resolver todos los medios para guardar. Sí para reproducir/exportar audio dependiente. Schema 1 permite archivos de audio y entidades de catálogo procedural, no GLB/modelos/fuentes externos. Verificar compatibilidad, procedencia y vínculo según arquitectura, no solo nombre. El companion aplica límites y acceso; la UI explica el rechazo sin exponer secretos.

Si el audio es compartido, mostrar escenas afectadas antes de confirmar. Recuperar el archivo esperado conserva referencia, pero requiere comprobar vínculo/vigencia; un sustituto diferente exige revalidar alineación/encaje y confirmar, sin regenerar voz automáticamente. Las identidades visuales se resuelven por catálogo/versionado, nunca seleccionando modelos externos ni duplicando diseños por escena.

## F6 · Exportación local — M2 fixture acotada; M3 UI completa

**M2:** demostrar un MP4 audiovisual local de 10–15 s mediante fixture preparada, catálogo procedural, audio y subtítulos. No requiere el editor integral ni la pantalla de trabajos completa. **M3:** ofrecer el recorrido de editor siguiente, conservando la prueba de M2 como regresión. **M4:** pulir y validar finalmente estos comportamientos, sin introducir un pipeline nuevo.

```text
P4 revisar → P5 elegir salida (con voz / sin voz) → preflight según esa salida
  → guardar revisión si hay cambios
  → instantánea aprobada y válida → confirmar exportación local
  → trabajo (uno activo) → capturar → codificar → verificar archivo
     ├─ válido → completado + abrir resultado
     ├─ error → diagnóstico + reintentar explícitamente
     └─ cancelar → cancelando → cancelado; no publicar parcial
```

- Preflight identifica aprobación pendiente/obsoleta, catálogo incompatible, motor indisponible y problemas de destino; sobre medios, evalúa solo lo que consume la salida elegida explícitamente en P5: «Con voz» (`withVoice`) exige audio actual disponible en cada escena y timing vinculado, mientras «Sin voz» (`silent`) excluye el consumo de audio y nunca se bloquea por audio ausente u obsoleto. Reabrir conserva la aprobación válida; importar o clonar la limpia y exige nueva aprobación editorial, sin volver actuales los medios por sí solo. Acciones «Revisar guion», «Revincular audio» o «Diagnóstico» conducen al punto correcto.
- Mostrar fase y avance medible. Si falta información, usar «Preparando…», no un porcentaje inventado.
- Un resultado anterior sigue visible como «Revisión anterior». No sobrescribirlo al iniciar un trabajo; una salida fallida no elimina el último MP4 válido.
- Cerrar/reabrir: trabajos activos se muestran interrumpidos/obsoletos y se reconcilian con el servicio local antes de ofrecer un nuevo intento; no lanzar una segunda instancia ni reanudar sin consentimiento. Si existe aún un proceso, mostrar su estado comprobado y permitir decidir cancelarlo/seguir observando.
- Cancelar detiene según capacidad del motor; la UI no promete instantaneidad ni marca cancelado hasta confirmación. Fallo al cancelar mantiene aviso y estado real.

## F7 · Solicitud opcional a proveedor — M3

```text
Configurar credencial fuera del JSON → preparar solicitud
  → revisar contenido enviado, proveedor, propósito, estimación y límites
  → confirmación explícita → enviar una vez → revisar resultado
     ├─ aceptar propuesta → actualizar borrador e invalidar descendientes
     └─ rechazar/fallo/cancelar → conservar versión anterior
```

Si no hay estimación fiable: «Coste no disponible; puede generar cargos en su proveedor». No mostrar un precio ficticio ni llamar «gratis» al desconocido. Advertir antes de enviar que cancelación local no garantiza evitar cargos ya iniciados. Un timeout no autoriza reintento automático pagado; primero reconciliar estado cuando sea posible. Guardar/abrir nunca ejecuta este flujo. No se guardan secretos ni en el JSON, copias o logs compartibles.

## Matriz transversal de estados

| Estado | Respuesta visible | Disponible sin pérdida |
| --- | --- | --- |
| Vacío | Instrucción concreta y acción inicial. | Crear/abrir/guardar borrador parcial. |
| Cargando | Nombre del proceso, estado ocupado y cancelación cuando proceda. | Lectura del contenido previo; evitar doble envío. |
| Error | Motivo conocido, detalle diagnóstico y acción de recuperación. | Documento anterior y edición en memoria. |
| Cancelado | Qué se detuvo y qué se conserva. | Volver a editar o reintentar explícitamente. |
| Éxito | Evidencia apropiada: revisión persistida o salida válida. | Continuar sin confundir borrador con aprobación. |
| Recurso ausente | Identidad y dependencia bloqueada. | Edición textual, guardado y revinculación. |
| Motor no disponible | Componente faltante y enlace a diagnóstico. | Guardar/abrir y editar configuración. |
| Coste desconocido | Desconocimiento explícito y advertencia antes del envío. | Cancelar sin solicitud. |
| Resultado obsoleto | Revisión origen y cambios que lo invalidaron. | Inspección del anterior sin llamarlo vigente. |

## Escenarios de aceptación antes de cerrar cada hito

### M1 · Obligatorios antes de proveedores/render

- [ ] Crear borrador sin idea completa; guardar, cerrar servicio/UI y reabrir desde JSON con mismos valores.
- [ ] Guardar texto parcial, estilo y configuración de escena sin audio, motor ni credenciales.
- [ ] Guardar/abrir `auto-rojo` versión 1 en dos escenas conserva registro y referencias aunque el recurso esté ausente; no genera diseños independientes.
- [ ] Edición durante un guardado mantiene dirty si el borrador es posterior a la instantánea persistida.
- [ ] Simular permiso denegado, disco lleno o desconexión: no mostrar «Guardado», no perder borrador y permitir reintentar.
- [ ] Interrumpir escritura: el archivo anterior sigue válido o hay recuperación explícita definida por arquitectura; no aceptar JSON truncado como éxito.
- [ ] Descargar copia JSON no limpia dirty ni actualiza última escritura canónica; advertir «Solo configuración; recursos no incluidos».
- [ ] Guardar copia portable crea una carpeta nueva con JSON y activos, `projectId` nuevo, revisión 0 y fechas nuevas, conserva IDs/versiones de entidades y escenas, confirma solo al completarse y avisa de activos faltantes sin llamar «completa» a una copia parcial.
- [ ] Cancelar selector, abrir JSON inválido, demasiado grande o de versión futura conserva proyecto activo y cambios.
- [ ] Confirmar salida con cambios: guardar y continuar solo navega tras éxito; cancelar vuelve al editor; error de apertura no vacía trabajo.
- [ ] Abrir JSON con ruta externa/traversal no lee archivos fuera del espacio autorizado; mostrar rechazo/revinculación.
- [ ] Mover carpeta de proyecto con recursos relativos conserva referencias; solo JSON abre con avisos y edición habilitada.
- [ ] Cambios externos no se sobrescriben silenciosamente; recuperación/copia mantiene ambas versiones hasta decidir.
- [ ] Reapertura con trabajo marcado activo no ejecuta ni paga operaciones automáticamente.

### M2 · Prueba audiovisual acotada

- [ ] Exportar fixture manual de 10–15 s con catálogo procedural, audio y subtítulos, sin proveedor ni editor completo; verificar MP4 audiovisual y continuidad.
- [ ] Reabrir un proyecto del workspace conserva la aprobación válida y sus referencias; si el contenido cambió, la aprobación se muestra obsoleta por digest y no se borra.
- [ ] Importar un JSON externo o guardar copia portable limpia `approval` con aviso, conserva medios, referencias y `mediaBindings`, registra revisión/fecha antes del commit y muestra «Sin aprobación»; el uso de medios sigue bloqueado hasta validar vínculo y vigencia.

### M3 · Editor básico, medios y salida local

- [ ] Editar guion aprobado invalida solo descendientes pertinentes; versión anterior permanece claramente etiquetada.
- [ ] Reutilizar una entidad conserva geometría, proporciones, materiales, paleta y rig. El inspector muestra usos e identidad bloqueada; pose/cámara diferentes no exigen píxeles idénticos. No hay editor geométrico ni creación arbitraria de variantes.
- [ ] Cambiar voz invalida tiempos/render, cambiar luz no invalida voz; regeneración nunca es implícita.
- [ ] Reordenar narraciones idénticas conserva clips y alineación local vigente; invalida montaje/timeline global. Ajustar duración revalida encaje sin regenerar voz ni gastar automáticamente.
- [ ] Recurso faltante no bloquea guardado pero sí la salida que lo necesita; cancelar revinculación no altera el documento.
- [ ] Motor indisponible permite editar; diagnóstico no se disfraza de render exitoso.
- [ ] Cancelación/fallo de exportación preserva salida válida anterior; resultado incompleto nunca habilita «Abrir video terminado».
- [ ] Reabrir tras interrupción exige revisar/reconciliar, sin arranque duplicado.

### M3 · Adaptadores opcionales

- [ ] Proveedor recibe contenido solo tras consentimiento explícito; coste desconocido y posibles cargos se explican.
- [ ] Fallo de proveedor preserva versión aprobada; timeout no provoca reintento automático pagado.

### M4 · Pulido y validación final (accesibilidad transversal desde M1)
- [ ] Navegar y editar con teclado sin arrastre; foco vuelve al disparador al cerrar diálogo; errores tienen etiquetas y anuncio accesible en producto.
- [ ] Verificar contraste, zoom 200 %, texto largo, 320–390 px, foco visible y movimiento reducido en Chromium. Estas comprobaciones no se han ejecutado sobre un producto.

## Contratos pendientes de arquitectura

Schema versionado y nombres exactos de campos; identificación/revisión de documento; escritura atómica y conflictos; límites de importación; resolución segura de recursos; retención de versiones aprobadas; estados de trabajos y reconciliación; almacenamiento separado de secretos. UX exige estos comportamientos, pero no inventa aquí un segundo schema incompatible con el plan técnico.

Nombres ya coordinados para continuidad: `entities`, `entityId`, `definitionVersion`; las instancias referencian entidades/versiones, no duplican diseños. Los campos restantes se alinean con arquitectura.
