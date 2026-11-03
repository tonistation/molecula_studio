# Identidad constante entre escenas

**Sí hace falta un contrato de identidad.** Usar código no garantiza continuidad si cada escena vuelve a construir un auto con otros parámetros, semilla, materiales o transformaciones heredadas. El MVP debe reutilizar definiciones de proyecto, no regenerar diseños por escena. Esto no requiere un editor 3D completo.

## Separación del contrato

| Identidad persistida e inmutable | Instancia/puesta en escena |
|---|---|
| `entityId` y `definitionVersion` | `componentId`, referencia exacta a definición |
| Generador, versión, seed y parámetros de diseño | Posición y rotación |
| Geometría y proporciones relativas | Escala uniforme y distancia a cámara |
| Materiales/paleta y rig de catálogo | Pose y animación admitidas por rig |
| Vínculo de voz, si existe en futuro | Cámara, iluminación y estado intencional versionado |

`entities` vive dentro del JSON desde M1; escenas guardan referencias, no copias editables de identidad. En M2 los diseños son un catálogo procedural pequeño y bloqueado: personaje, auto, capas geológicas, flecha y rótulo. No hay editor de modelado/rig, ni rediseño automático por IA.

Un auto lejano se ve menor; perspectiva y giro cambian su silueta proyectada. Eso no es drift. La proporción en espacio de modelo y las longitudes de piezas/rig deben permanecer constantes. Escala por eje está prohibida por defecto, incluso si proviene de un padre de la jerarquía. Una deformación intencional futura necesita estado explícito y validado, no una excepción silenciosa.

## Cambios de diseño

- **Cambio global:** nueva versión de la misma identidad; actualizar todas sus referencias en una transacción del documento, incrementar revisiones e invalidar frames/exportaciones dependientes. Nunca modificar una definición ya usada por un job en curso.
- **Variante:** nuevo `entityId`, `variantOf` con identidad y versión de origen; solo las instancias elegidas la usan. Base y escenas anteriores no cambian.
- **Movimiento/pose:** no cambia definición ni su seed. No permite override de materiales, proporciones, rig o voz.

Guardar/reabrir conserva definiciones, refs y lineage. Referencia inexistente o versión que no coincide es error estructural, no una invitación a generar un reemplazo. Activos externos futuros deben fijar versión/hash/licencia en manifest; no hay descargas automáticas.

## Garantías que un ID solo no demuestra

1. **Aislamiento:** definición congelada, geometría compartida solo si inmutable, materiales/rig/estado mutable por instancia. Animar o resaltar un auto no cambia el de otra escena.
2. **Procedural reproducible:** seed, parámetros y versión del generador pertenecen a la definición. No crear semilla por escena ni usar tiempo real como diseño.
3. **Proporciones efectivas:** inspeccionar ratios en espacio de modelo y transformaciones heredadas en runtime, además de capturas. Una referencia correcta con escala no uniforme sigue siendo un fallo.

## Pruebas exigidas, todavía no ejecutadas

| Caso | Oráculo estructural | Oráculo visual |
|---|---|---|
| Mismo auto en dos escenas | Misma definición/version/seed y ratios de piezas | Revisión con cámaras distintas; sin exigir píxeles idénticos |
| Guardar/reabrir | Registro/refs y parámetros conservados | Repetir vistas de referencia tras reapertura |
| Pose y movimiento | Longitudes de rig y ratios de modelo constantes | Giro y cambio de pose sin estiramiento involuntario |
| Mutación de material/rig | Segunda instancia no cambia al modificar estado de primera | Colores/pose de la segunda permanecen según su estado |
| Variante explícita | Nuevo ID + lineage; base intacta | Solo instancias seleccionadas muestran variante |
| Cambio global | Refs actualizadas; jobs anteriores obsoletos | Todas las instancias nuevas usan nueva versión |

Se rechazan dangling refs, versiones inválidas, lineage cíclico y overrides de identidad. R19/R20 y tareas F02/F08/V02/V07/E02 trazan estas garantías. La aprobación actual es para analizar y planificar, no para afirmar que estas pruebas pasaron.
