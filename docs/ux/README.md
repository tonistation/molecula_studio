# UX de Molecula Studio: guardar primero, producir después

**Estado: propuesta para revisión, sin producto implementado.** Este plan delimita un estudio local para preparar videos verticales, guardar proyectos incompletos y retomarlos. La primera entrega debe resolver creación, edición, guardado y apertura en JSON; no depende de proveedores, motores gráficos ni base de datos.

## Recorrido de revisión

1. Revisar las seis [pantallas y bosquejos](screens.md).
2. Abrir [wireframes.html](wireframes.html): seis láminas HTML/CSS autónomas, sin APIs ni persistencia. Solo los enlaces de navegación son operativos.
3. Verificar [flujos, recuperación y criterios de aceptación](flows.md).
4. Alinear los contratos con arquitectura antes de desarrollar; los nombres exactos de campos JSON quedan pendientes de ese contrato.

## Decisiones de alcance

| Tema | Propuesta delimitada |
| --- | --- |
| Uso | Una persona, un equipo, proyectos locales; sin cuenta obligatoria. |
| Formato inicial | Video vertical 9:16; resolución y tasa de cuadros soportadas se fijan con el motor, no se prometen opciones arbitrarias. |
| Persistencia | JSON legible más carpeta de recursos; un companion local administra un espacio de trabajo controlado. Sin DB. |
| Primer hito | Guardar y reabrir un borrador parcial, incluso sin guion, audio ni renderizador. |
| Estilos | Arquitectura multiestilo, con una sola opción inicial: **3D estilizado**. 2D y gráficos en movimiento se muestran como futuros, deshabilitados. |
| Referencias | Paisajes y personajes 3D, iluminación y encuadres variados; las referencias sugieren subtítulos superiores, pero la UI solo ofrece anclas admitidas por el contrato vigente, con `upper` como default inicial. Oscuridad, isometría y cámara fija no son restricciones globales. |
| Edición | Formularios, lista ordenada de escenas, mover arriba/abajo y previsualización vertical. No editor de rigs, modelado libre ni línea de tiempo compleja por arrastre. |
| Continuidad | Seleccionar/reutilizar elementos de catálogo con identidad y proporciones bloqueadas; instancias de escena referencian la misma entidad, no rediseños independientes. |
| Generación | Primero guion, audio y recursos de prueba o importados manualmente; integración opcional con proveedores después. |
| Operaciones externas | Aprobación explícita del contenido y del envío/coste antes de una solicitud potencialmente pagada. No compra ni facturación dentro del estudio. |
| Exportación | Trabajo local explícito, con diagnóstico de dependencias y resultado verificable; no render al abrir un proyecto. |

La [especificación original](../reference/original-specification.md) se conserva como referencia histórica, no como contrato visual vigente.

## Entregas y límites visibles

Los hitos siguen el plan de entrega canónico. Los bosquejos de editor completo no son requisitos de la prueba técnica acotada de M2.

| Hito | Disponible al terminar | No es requisito de ese hito |
| --- | --- | --- |
| **M1 · Proyecto recuperable** | P1 proyectos, P2 idea/estilo, edición textual mínima en P3, P6 configuración/revinculación; guardar/abrir JSON incompleto; guardar copia portable; descargar copia JSON; validación y guardas de salida. | WebGL, voz sintética, generación IA, exportar MP4. |
| **M2 · Prueba audiovisual acotada** | Fixture manual de 10–15 segundos, catálogo procedural, audio permitido, subtítulos y aprobación mínima de fixture; previsualización/captura y MP4 local verificable. Demuestra continuidad y pipeline, no un editor completo. | Editor integral P3/P4/P5, aprobación editorial completa, proveedores externos o importación de modelos. |
| **M3 · Editor básico y adaptadores opcionales** | Guion/storyboard con aprobación, escenas y entidades de catálogo configurables, audio importado, subtítulos, previsualización y exportaciones desde el editor. Proveedores opcionales de guion/voz solo con aprobación explícita antes de cada operación. | Render en nube, lotes masivos, edición geométrica, nuevos estilos, colaboración, pagos o sincronización. |
| **M4 · Pulido y validación final** | Validación final, accesibilidad, claridad de estados y recuperación; pulido del alcance ya definido. | Nuevas capacidades, nuevos estilos o proveedor obligatorio. |

En M1 los espacios de vista previa y exportación explican «Disponible en una fase posterior»; no aparentan un motor funcionando. Una configuración de estilo puede persistirse antes de que su renderizador exista.

## Gramática común de la interfaz

- Cabecera de proyecto: nombre editable, **Guardar**, **Abrir proyecto**, estado de cambios, última escritura confirmada y revisión guardada. **Guardar copia portable** (carpeta con JSON y activos) y **Descargar copia JSON** son acciones secundarias y nunca sustituyen Guardar; la descarga no incluye binarios ni confirma escritura.
- Estados de documento: «Sin guardar», «Cambios sin guardar», «Guardando…», «Guardado · revisión 4 · 10:42» y «No se pudo guardar». La hora y revisión de ejemplo de los bosquejos no representan una escritura real.
- Estado persistente junto al control, no solo notificación temporal. Fallar al guardar mantiene el documento modificado y disponible para reintentar o descargar una copia.
- Avance por secciones, sin obligar a terminar el pipeline para guardar. «Pendiente de revisión» no equivale a «Error».
- Una acción primaria por sección; acciones destructivas o pagadas identificadas por su efecto, no por un ambiguo «Continuar».

La invalidación depende de las entradas: texto o inputs de voz cambiados invalidan voz/alineación dependientes; reordenar narraciones idénticas conserva clips y alineación local vigentes, pero invalida montaje/timeline global; ajustar duración revalida encaje sin regenerar voz ni gastar automáticamente. El detalle está en F4 de [flujos](flows.md).

## Seguridad y confianza

El navegador no escribe rutas arbitrarias. El companion recibe un identificador de proyecto autorizado dentro de su espacio de trabajo. Un archivo abierto mediante selector es entrada no confiable: validar primero, no ejecutar instrucciones ni confiar en rutas de su JSON. Los recursos referenciados se importan o revinculan mediante selección explícita y validación del companion.

En schema 1 las entidades visuales proceden del catálogo procedural; no se importan GLB, modelos o fuentes arbitrarios. Los archivos de medios permitidos son audio, separado del JSON y con ruta plana `assets/<assetId>.<ext>` dentro de la carpeta `assets/`. El JSON no contiene recursos embebidos, credenciales ni secretos. La carpeta `assets/` acompaña al JSON al trasladar un proyecto mediante **Guardar copia portable**, que confirma solo al completarse y avisa de activos faltantes; **Descargar copia JSON** entrega solo configuración y advierte que no es un paquete portátil completo. No existe sincronización automática ni copia de seguridad en nube.

Reabrir un proyecto del workspace conserva referencias y la aprobación válida; abrir o guardar no renueva la aprobación, y si el contenido cambió se muestra obsoleta por digest, no se borra. Importar un JSON externo o **Guardar copia portable** sí limpia `approval` con aviso explícito, conserva medios, referencias y `mediaBindings`, registra esa edición —revisión y fecha nuevas— antes del commit y la UI muestra «Sin aprobación», no «Pendiente de validación». Los vínculos de audio/alineación siguen sujetos a revalidación: el companion debe resolver vínculo y procedencia antes de usarlos como actuales, y hasta entonces la UI los marca «Pendiente de validación» u «Obsoleto» y bloquea los usos dependientes, sin regenerar ni pagar automáticamente. No se agregan campos UX alternativos al contrato.

## Identidad visual entre escenas

Un automóvil o personaje conserva geometría, proporciones, materiales, paleta y rig. El panel **Elementos del proyecto** permite seleccionar una entidad de catálogo, reutilizarla y consultar dónde aparece. Por instancia se ajustan pose, posición, rotación y escala uniforme; la cámara pertenece a la escena. No se permite deformación no uniforme. Otra pose, cámara o iluminación produce píxeles diferentes sin necesariamente cambiar la identidad.

El contrato coordinado con arquitectura usa registro `entities`, identidad estable `entityId` y versión `definitionVersion`; las instancias de escena referencian esa identidad/versionado. Guardar/abrir conserva registro y referencias desde M1; M2 prueba continuidad con una fixture y M3 ofrece el panel editable completo. Los campos restantes se concretan con arquitectura.

**Fuera del MVP:** edición geométrica, rigging, edición global de identidad y creación arbitraria de variantes. El formato distingue una variante intencional mediante identidad/versionado explícito, pero no se ofrece su creación libre en el editor inicial. Una futura modificación global debe listar escenas afectadas y pedir confirmación; no sustituir originales silenciosamente.

## Accesibilidad y adaptación

Objetivo de diseño: WCAG 2.2 AA, pendiente de verificación en implementación. Etiquetas visibles, controles de al menos 44 px como objetivo táctil, foco contrastado, orden de tabulación lógico y estados expresados con texto además de color. Guardar mediante Cmd/Ctrl+S en el futuro; no interceptar atajos dentro de diálogos incorrectamente.

Escritorio es el contexto principal. En ancho reducido: cabecera envuelve acciones, paneles se apilan y la previsualización conserva 9:16 dentro del ancho disponible; lista/formularios sustituyen cualquier vista densa. No se necesita arrastrar para editar. Sin animación decorativa en guardado o navegación de teclado; respetar movimiento reducido y no reproducir audio automáticamente.

## Puerta de aprobación antes de desarrollar

- [ ] Validar las seis pantallas, etiquetas y separación entre fases.
- [ ] Confirmar contrato de archivo versionado, referencias relativas y límites de importación con arquitectura.
- [ ] Confirmar que M1 incluye escritura atómica real y reapertura del borrador, no solo descarga del navegador.
- [ ] Aprobar un único estilo 3D inicial y una biblioteca pequeña de escenas/recursos compatibles.
- [ ] Verificar identidad/proporciones bloqueadas de una entidad reutilizada y referencias preservadas al guardar/abrir; no exigir píxeles idénticos entre cámaras distintas.
- [x] Capturar el HTML en Chromium a 1440, 390 y 320 px y comprobar las seis anclas/retornos: sin desbordamiento horizontal ni errores de consola/runtime. Se inspeccionaron además capturas de los cambios en P4 y P6; no equivale a una auditoría completa de accesibilidad o producto.
- [ ] Convertir criterios de [flows.md](flows.md) en pruebas de implementación; los bosquejos no prueban comportamiento.

## Coordinación técnica, no implementación

Evidencia temporal de la comprobación posterior a correcciones G0: `/private/var/folders/ky/xtx1sc_j6yv2js44vhx5fb6h0000gn/T/opencode/molecula-ux-g0-n9XubE` (capturas y `report.json`). No es un recurso requerido por los bosquejos y puede no existir en otro equipo. Quedan pendientes teclado, zoom, contraste y comportamiento real de persistencia. El ancla inicial es `upper`, con `center`/`lower` disponibles; la importación externa o la copia portable limpia la aprobación y exige nueva revisión editorial, mientras reabrir conserva la válida. Aquí no se agregan campos JSON.

La recomendación base del coordinador es React/TypeScript/Vite para UI, companion Node local, Three.js para el primer estilo, subtítulos SVG/DOM y captura Chromium/FFmpeg. Este documento define experiencia y estados, no instala dependencias ni valida esas APIs. La arquitectura deberá concretar contratos y motores; el HTML es independiente de cualquier framework.
