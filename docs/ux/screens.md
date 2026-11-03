# Seis pantallas para revisar antes de implementar

**Bosquejos de baja fidelidad, no interfaz funcional.** La navegación entre láminas está en [wireframes.html](wireframes.html). El contenido de ejemplo es manual: no sugiere que haya generación, guardado o render disponibles.

## Mapa de pantallas

| ID | Pantalla | Primera aparición | Resultado principal |
| --- | --- | --- | --- |
| P1 | Proyectos y apertura | M1 | Crear borrador o recuperar trabajo validado. |
| P2 | Idea y estilo | M1 | Definir intención y guardar aunque falten datos. |
| P3 | Guion y storyboard | M1 texto; M3 editor/aprobación | Revisar contenido y orden de escenas; M2 usa una fixture preparada. |
| P4 | Estudio y vista vertical | M2 prueba de fixture; M3 editor | M2 demuestra previsualización; M3 permite ajustar escenas desde el panel completo. |
| P5 | Exportaciones y resultados | M2 prueba MP4; M3 UI completa | Exportar una fixture de 10–15 s en M2; gestionar salidas desde el editor en M3. |
| P6 | Configuración y recursos | M1 | Configurar proyecto, diagnosticar y revincular. |

## P1 · Proyectos y apertura

```text
+------------------------------------------------------------+
| Molecula Studio              [Abrir proyecto] [Nuevo proyecto]|
| Espacio local · compañero conectado                         |
| Proyectos recientes                                        |
| El viaje de la sal | Borrador | rev. 4 | [Abrir]             |
| El brazo          | Faltan recursos     | [Abrir y revisar] |
| Sin proyectos: «Comience con una idea»                      |
| Importar: seleccione JSON; revise recursos por separado     |
+------------------------------------------------------------+
```

**Jerarquía:** Nuevo proyecto es la acción principal cuando la biblioteca está vacía; al haber recientes, Abrir sigue visible. La lista es local, no biblioteca en nube. Un registro reciente no es la autoridad del documento: al abrir se comprueba que el archivo siga disponible.

**Estados:** vacío con acceso a crear/abrir; leyendo con nombre de archivo; JSON inválido o versión futura con mensaje preciso y documento activo intacto; cancelación del selector sin efectos; reciente movido con «Seleccionar archivo»; companion desconectado con diagnóstico y sin falso guardado.

**Aceptación:** crear no exige proveedor ni recursos; abrir una configuración incompleta conduce a la última sección útil, no a un asistente obligatorio. La apertura nunca arranca trabajos.

## P2 · Idea y estilo

```text
+------------------------------------------------------------+
| El viaje de la sal   Cambios sin guardar  [Guardar] [Abrir] |
| Última escritura: sin guardar      [Descargar copia]         |
| Idea > Guion > Estudio > Exportar              [Configuración]|
| Nombre [El viaje de la sal_______________________________] |
| Idea   [Explicar cómo llega la sal a nuestra mesa_________] |
| Idioma [Español]  Formato [9:16]                            |
| Estilo [3D estilizado: seleccionado]                        |
|        [2D: futuro, deshabilitado] [Motion: futuro, deshab.] |
| [Guardar borrador]                  [Ir al guion manual]   |
+------------------------------------------------------------+
```

**Campos:** nombre, idea, idioma, estilo y configuración básica de escena admitida por schema 1. Público objetivo no forma parte del formulario inicial ni se inventa como campo del archivo. Una idea vacía no impide guardar; si falta nombre se usa «Proyecto sin título», renombrable. La duración objetivo, si se ofrece después, es orientación y no una promesa de duración renderizada.

**Estilos:** una tarjeta habilitada «3D estilizado», con ejemplos textuales de paisaje o personaje mediante presets acotados. No implica que cualquier modelo/animación sea compatible. Las alternativas futuras no son CTA ni prestaciones incluidas. El estilo del contenido no impone tema oscuro a toda la UI.

**Estados:** nuevo sin guardar; guardando con control temporalmente ocupado; éxito solo tras confirmación persistida; permiso denegado/disco lleno/companion caído con texto y reintento. No bloquear la edición por ausencia de IA. «Generar propuesta» solo aparece habilitable en M3 tras configuración y consentimiento. M4 pule y valida, no introduce proveedores.

**Aceptación M1:** escribir media idea, guardar, cerrar y abrir conserva esa media idea, selección de estilo y configuración. No hay generación automática al pasar a guion.

## P3 · Guion y storyboard

```text
+------------------------------------------------------------+
| El viaje de la sal | rev. 4 | Cambios sin guardar [Guardar] |
| Idea > GUION > Estudio > Exportar                           |
| Escenas                  | Escena 2 · Texto                 |
| 1. Origen                | [El agua se evapora…___________] |
| 2. Evaporación [actual]   | Visual [Paisaje / salinas_____] |
| 3. Mesa                  | Duración [4 s · manual]         |
| [Añadir] [Subir] [Bajar]  | Voz: pendiente · sin coste      |
| Pendiente de revisión    | [Importar audio]                |
| [Guardar borrador]       | [Aprobar guion y storyboard]    |
+------------------------------------------------------------+
```

**Edición:** texto por escena, intención visual, duración manual, añadir/eliminar con confirmación si hay contenido y reordenar mediante botones. No línea de tiempo arrastrable obligatoria. El storyboard inicial es lista de tarjetas con descripciones y miniaturas de prueba cuando existan, no arte generado prometido.

**Aprobación:** estado vinculado a entradas/procedencia definidas por arquitectura. Aprobar requiere texto/orden válidos y resumen de pendientes; no dispara voz ni render. En M3 «Ir al estudio» permite inspección incompleta, pero exportar exige validación. M1 permite guardar texto parcial sin aprobar; M2 usa una fixture acotada, no exige esta UI completa. Tras abrir/importar, aprobación y medios quedan pendientes hasta comprobar vínculos y vigencia; no se restauran como actuales por mera lectura del JSON.

**Cambios después de aprobar:** texto o entradas de voz cambiados invalidan voz y alineación dependientes; reordenar narraciones idénticas conserva clips y alineación local validada, pero invalida montaje/línea temporal; ajustar duración exige comprobar encaje sin regenerar voz automáticamente. Mostrar el efecto específico, no «regenerar todo». Editar no borra medios anteriores. Antes de regenerar se detalla alcance y posible coste. Si falla el proveedor, permanece accesible la versión aprobada anterior, identificada como no correspondiente al borrador actual.

**Estados:** guion vacío con «Añadir escena» y ejemplo manual; importación de audio en curso; duración/audio incompatibles; generación cancelada; proveedor no configurado; propuesta fallida con «Reintentar» y versión anterior preservada. No se muestra precio fijo ficticio: «Coste no disponible» cuando no hay estimación fiable.

## P4 · Estudio y previsualización vertical

```text
+------------------------------------------------------------+
| El viaje de la sal | Cambios sin guardar [Guardar] [Abrir] |
| Idea > Guion > ESTUDIO > Exportar                           |
| Escenas     | Vista 9:16           | Escena 2               |
| 1 Origen    | +----------------+  | Preset [Catálogo]      |
| 2 Salinas   | | SUBTÍTULO      |  | Elemento [Catálogo]    |
| 3 Mesa      | |                |  | Cámara [Frontal]       |
|             | | paisaje simple |  | Luz [Día]              |
|             | |                |  | Ancla [según contrato] |
|             | +----------------+  | [Zona segura visible]  |
|             | [Reproducir] 0:04   | Voz [Importada]         |
| [Subir/bajar escena]               | [Revisar recursos]     |
| Elementos: Auto rojo · diseño/proporciones bloqueados       |
| auto-rojo / versión 1 · usado en escenas 1 y 3 [Reutilizar] |
+------------------------------------------------------------+
```

**Paneles (M3):** lista ordenada, lienzo 9:16 y propiedades de escena; M2 prueba una fixture de 10–15 s sin exigir estos controles completos. Solo presets soportados: cámara, iluminación, entidad de catálogo procedural y movimiento limitado. No hay importación GLB ni rig editor. Paisaje/personaje son familias previstas sujetas al catálogo, no promesas de modelos arbitrarios. La UI ofrece únicamente anclas de subtítulo admitidas por contrato; el ancla superior de las referencias queda pendiente de confirmación técnica. Revisar margen seguro y legibilidad sin prometer compatibilidad universal.

**Reproducción:** posición temporal, reproducir/pausar y selección de escena; audio solo por acción explícita y después de validar vínculo/vigencia. Vista previa no equivale a render final. Mostrar «Pendiente de validación», «Necesita revisar montaje» o «Voz desactualizada» según dependencia; reordenar o ajustar duración no exige siempre regeneración. No reproducir voz anterior como si correspondiera a texto nuevo.

**Elementos del proyecto:** seleccionar/reutilizar entidades de catálogo y consultar nombre estable, `entityId`, `definitionVersion`, identidad/proporciones bloqueadas y escenas usuarias. «Reutilizar» crea una instancia referenciada, no un diseño independiente. El ejemplo alternativo **Auto rojo**, `auto-rojo`, versión 1, usado en escenas 1 y 3 ilustra continuidad; no añade un automóvil a la historia de la sal.

La identidad contiene geometría, proporciones, materiales, paleta y rig. Por instancia cambian pose, posición, rotación y escala uniforme; la cámara es de escena. No ofrecer escala no uniforme. Otra cámara/pose no exige píxeles idénticos. Edición geométrica, rigging, edición global y creación arbitraria de variantes no están disponibles en MVP. Una futura variante debe ser explícita y una modificación global debe listar usos y pedir confirmación.

**Estados:** sin escena → volver al guion; audio ausente → «Revincular audio» sin perder edición; entidad procedural no disponible → placeholder y diagnóstico de catálogo/versión, nunca selector GLB; motor no disponible → explicación y configuración conservada; cargando; error de previsualización con diagnóstico; éxito con «Vista previa». M1 informa disponibilidad futura; M2 demuestra la fixture; M3 ofrece los controles completos.

**Pantalla estrecha:** propiedades debajo de vista y lista; selección mediante control etiquetado. Mantener Guardar accesible sin cubrir el contenido y sin scroll horizontal de página.

## P5 · Exportaciones y resultados

```text
+------------------------------------------------------------+
| El viaje de la sal | Guardado · rev. 5 [Guardar] [Abrir]    |
| Idea > Guion > Estudio > EXPORTAR                           |
| Comprobación: guion ✓ audio ✓ recursos ✓ motor ✓ disco ✓  |
| Perfil [Vertical 1080 × 1920 · 30 fps]*                     |
| Revisión de origen: 5   Destino: salida local del proyecto  |
| [Exportar video]                                          |
| Trabajo actual: Renderizando · 120 / 300 cuadros [Cancelar]|
| Resultados: rev. 4 · anterior · [Abrir archivo]             |
| Interrumpido al cerrar: [Revisar y volver a intentar]       |
+------------------------------------------------------------+
```

\*Perfil objetivo a validar con arquitectura y capacidad del motor, no selector de formatos ilimitados.

**Preflight:** comprobar aprobación vigente, dependencias actuales, medios/timing válidos, motor disponible y espacio de trabajo utilizable. La aplicación exporta una revisión guardada e inmutable; si hay cambios, pide guardar primero. Un cambio posterior no modifica un trabajo ya iniciado: mostrar su revisión origen.

**Trabajo acotado:** uno activo; no simular porcentajes. Si existe total medible, indicar cuadros; si no, etapa y actividad indeterminada. Tiempo restante solo si está calculado de forma razonable, nunca constante inventada.

**Estados:** vacío; comprobando; bloqueado por recursos/audio/aprobación; en espera; renderizando; codificando; cancelando; cancelado; fallido; completado con archivo comprobado; interrumpido tras reapertura. «Abrir archivo» se habilita solo si existe salida válida. Cancelar no anuncia éxito mientras el proceso siga activo. Resultado parcial no aparece como video terminado.

## P6 · Configuración, diagnóstico y revinculación

```text
+------------------------------------------------------------+
| Configuración del proyecto                      [Volver]  |
| Estilo [3D estilizado]   Preset [Paisaje]                   |
| Espacio local: proyecto autorizado · revisión 5            |
| Recursos: 2 encontrados / 1 ausente [Revisar]               |
| Companion: conectado   Motor: no disponible [Diagnóstico] |
| Proveedor opcional: no configurado · M3                    |
| [Guardar configuración]            [Descargar copia JSON]  |
| +------------------------------------------------------+  |
| | Revincular audio: narracion.wav                      |  |
| | No se encontró assets/audio/narracion.wav             |  |
| | [Seleccionar archivo] [Cancelar]                      |  |
| | Verificar compatibilidad antes de confirmar.          |  |
| +------------------------------------------------------+  |
+------------------------------------------------------------+
```

**Configuración del proyecto:** estilo y parámetros de escena que se guardan en JSON. **Entorno local:** estado de companion, Chromium/FFmpeg y diagnóstico; rutas autorizadas resumidas, sin exponer secretos. **Proveedor:** credenciales solo mediante almacenamiento local separado definido por arquitectura, nunca en JSON ni logs exportados. M1 no exige configurarlas.

**Revinculación (schema 1):** identificar audio esperado, seleccionar archivo permitido, validar tipo/compatibilidad y procedencia según arquitectura, confirmar referencia dentro del espacio controlado. Si cambió el audio, revalidar alineación, encaje y salidas dependientes; no asumir vigencia por mismo nombre. Cancelar conserva referencia y contenido anterior. No interpretar una ruta recibida en JSON como permiso de lectura. Las entidades visuales se resuelven por catálogo procedural, no mediante modelos externos.

**Diálogo de implementación:** nombre accesible, foco inicial significativo, Tab contenido, Escape cancela si es seguro, retorno al disparador. Error junto al selector sin cerrar diálogo. En el HTML está representado como bloque, no como modal funcional.

Para audio compartido, mostrar todas las escenas afectadas antes de confirmar; recuperar el archivo no prueba por sí solo su vínculo con narración/aprobación. Una entidad procedural ausente/incompatible se diagnostica mediante catálogo/versionado: no se ofrece seleccionar modelo externo ni editar identidad global como «reparación».

## Controles compartidos y copy de recuperación

| Situación | Mensaje y acción previstos |
| --- | --- |
| Salir/abrir otro proyecto con cambios | «Hay cambios sin guardar». Guardar y continuar / Descartar cambios y continuar / Seguir editando. Si guardar falla, no navegar. |
| Fallo de escritura | «No se pudo guardar. Sus cambios siguen abiertos». Reintentar / Descargar copia. Última escritura confirmada permanece visible. |
| Importación inválida | «No se abrió el archivo: formato no válido». Detalle local y seleccionar otro; no reemplazar el proyecto activo. |
| Versión futura | «Este proyecto requiere una versión más reciente». No forzar apertura ni degradar datos. |
| Revisión externa modificada | «El archivo cambió fuera del estudio». No sobrescribir sin revisión; ofrecer recuperar versión externa o conservar una copia del borrador. |
| Proveedor sin estimación | «Coste no disponible. La solicitud puede generar cargos en su proveedor». Confirmar envío explícitamente o cancelar. |
| Companion desconectado | «No hay conexión con el servicio local». Reintentar conexión; conservar edición en memoria y ofrecer copia si es posible. |

Los atajos y modales son requisitos de implementación, no funcionalidades de las láminas. Véanse [flujos](flows.md) y [criterios de salida](README.md#puerta-de-aprobación-antes-de-desarrollar).
