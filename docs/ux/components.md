# Layout y contratos de componentes

**Diseño ejecutable, no aprobación visual.** [Pantallas](screens.md) describe P1–P6 y [flujos](flows.md) las transiciones. Hoy `App` alterna lista/editor; no hay seis rutas funcionales. Este documento asigna layout, propiedad y contratos propuestos sin implementar UI ni generar imágenes.

## Mapa honesto de implementación

| Pantalla | Existe en `studio/src/` | Falta / tarjeta |
|---|---|---|
| P1 | `screens/ProjectList.tsx`, apertura desde `App.tsx` | Conservar errores/importación/guardas, H02/H05 |
| P2 | Nombre/idea/locale/estilo en `screens/Editor.tsx` | Reorganizar sin perder save/reopen, E01a |
| P3 | Texto, orden y duración mínimos en Editor | Revisión audiovisual, bindings y propuestas, V04b/E01/E04 |
| P4 | Sin runtime visual; datos visuales se conservan | Preview/Transport V03, SceneInspector E01b |
| P5 | Sin exportación ni trabajos | Preflight/JobPanel/ResultList V06; integración editor E01a |
| P6 | `screens/AssetManifest.tsx` para manifest/relink | Diagnóstico de motor/licencias y configuración acotada H04 |

Las láminas `wireframes.html` siguen siendo referencia estática. Persistencia M1 tiene evidencia técnica en [delivery](../plan/delivery.md); no extiende esa evidencia a layout, contraste o calidad 3D.

## Regiones del estudio — diseño E01

Objetivo desktop 1280×800: cabecera persistente, navegación de secciones y área principal. Cabecera con nombre, estado textual, última revisión confirmada, Guardar y secundarias; altura flexible, sin ocultar errores. Área P4: lista de escenas 220 px, centro flexible mínimo 320 px, inspector 300 px; gaps 16 px, padding 16 px. Preview mantiene proporción 9:16 y escala uniforme de coordenadas 1080×1920; transport debajo, jamás dentro de la raíz capturada. P3 reutiliza lista+formulario; P5 usa columna de checks y trabajo/resultados; P6 lista de recursos y diagnóstico. Son defaults de layout revisables con H02, no píxeles ya aprobados.

Por debajo de 1100 px, inspector debajo del centro; por debajo de 760 px, una columna y selección de escena etiquetada. No prometer edición móvil; mantener lectura/guardar, zoom 200 %, sin scroll horizontal de página a 320–390 px. Lista/inspector pueden tener scroll propio solo con foco visible y acceso al principio/fin. Nada de drag obligatorio. Navegación semántica con botones/enlaces; no crear un tablist si no se implementa su patrón completo.

## Props, acciones y estado

Todos los nombres/rutas siguientes son **propuestos**, salvo App/Editor/AssetManifest. DTO de runtime/job/proposal: [API](../plan/api-contracts.md#diseño-compartido-previo-a-consumidores--c01). Props no se guardan en project.json. Un coordinador de editor conserva draft, revisión confirmada, dirty y locks; componentes presentacionales no escriben por su cuenta ni llaman proveedores.

| Componente / ruta propuesta bajo `studio/src/components/` | Props tipadas y acciones | Estado / dueño |
|---|---|---|
| `ProjectHeader.tsx` | `{title:string,revision:number,dirty:boolean,saveState:"idle"|"saving"|"uncertain"|"error",readOnly:boolean,onSave:()=>Promise<boolean>,onCopy:()=>void,onBack:()=>void}` | No cambia Guardado antes de recibo/relectura; E01a coordina Editor |
| `SceneList.tsx` | `{scenes:readonly Scene[],selectedId:string|null,readOnly:boolean,onSelect:(id:string)=>void,onMove:(id:string,delta:-1|1)=>void,onAdd:()=>void,onRemove:(id:string)=>void}` | Selección local, no ID por índice; foco conserva escena al mover; E01a |
| `Preview.tsx` | `{snapshot:Project,frameIndex:number,runtime:PreparedRuntime|null,status:"empty"|"loading"|"ready"|"error",errorCode:string|null}` | Usa mismo renderFrame de captura; dispose anterior al cambiar snapshot; V03a |
| `Transport.tsx` | `{frameIndex:number,totalFrames:number,playing:boolean,canPlay:boolean,onSeek:(frame:number)=>void,onPlay:()=>void,onPause:()=>void}` | Reloj audio maestro si withVoice actual; pause/seek cuantiza V01; V03c |
| `SceneInspector.tsx` | `{project:Project,sceneId:string,readOnly:boolean,issues:readonly Issue[],onChange:(action:SceneEdit)=>void}` | SceneEdit unión cerrada de texto/duración/preset/camera/captions/transform; no CSS libre ni overrides de identidad; E01b |
| `EntityUsage.tsx` | `{entities:readonly Entity[],sceneId:string,readOnly:boolean,onReuse:(entityId:string)=>void}` | Identidad/version/uso visible; no editor global/variantes libres; E01b |
| `MediaReview.tsx` | `{scene:Scene,asset:Asset|null,bindingState:"missing"|"unverified"|"stale"|"current",readOnly:boolean,onAcceptAudio:()=>void,onAcceptWords:()=>void}` | Aceptación explícita después de inspección; no refresca bindings al montar; V04b |
| `AssetImport.tsx` | `{dirty:boolean,readOnly:boolean,pending:boolean,onSaveFirst:()=>Promise<boolean>,onImport:(file:File,source:{license:string,attribution:string})=>Promise<void>}` | Recurso nuevo con procedencia y commit CAS; no confundir con relink de asset ya declarado; E01c |
| `PreflightPanel.tsx` | `{checks:readonly PreflightCheck[],pending:boolean,onCheck:()=>void,onResolve:(action:string,sceneId?:string)=>void}` | Recheck antes de enqueue; opciones cambian draft y requieren aprobar/guardar; V06a |
| `JobPanel.tsx` | `{job:Job|null,cancelPending:boolean,onCancel:()=>Promise<void>,onRetry:()=>void}` | Progreso por frames/etapa; cancelled solo tras hijos detenidos; V06b/c |
| `ResultList.tsx` | `{results:readonly ExportReceipt[],states:Readonly<Record<string,"current"|"stale"|"unverified">>,onOpen:(resultId:string)=>void}` | Verificación companion antes de servir bytes; no link file://; V06d |
| `RequestReview.tsx` | `{preview:RequestPreview|null,mode:"fake"|"real",pending:boolean,onConfirm:()=>void,onCancel:()=>void}` | Muestra contenido/capacidad/costo/límite y destino; nunca confirmación implícita; E04a |
| `ProposalReview.tsx` | `{proposal:Proposal,currentRevision:number,pending:boolean,onAccept:()=>void,onReject:()=>void}` | Diff legible y fuente; aceptar stale deshabilitado con motivo; E04b |
| `RecoveryDialog.tsx` | `{reason:"dirty"|"conflict"|"uncertain",pending:boolean,onSave:()=>Promise<boolean>,onDiscard:()=>void,onCancel:()=>void}` | Reutiliza semántica M1; fallo no cierra ni navega; E01a/H02 |

`SceneEdit` se define contract-first en E01a junto al reducer; no dar a workers permiso genérico para mutar Project. Cada acción declara sceneId, valor validado y dependencias invalidadas. Datos visuales desconocidos quedan inertes y controles de edición/render deshabilitados; copia original raw sigue disponible. Las props no deben confundir readOnly con indisponibilidad de motor: motor ausente permite guardar configuración compatible.

## Interacción, accesibilidad y recuperación

- Formularios con label visible, ayuda/errores por `aria-describedby`, unidades s/ms explícitas. Input temporal inválido puede mantenerse localmente; no introducir NaN o layout inválido al Project. Validación al confirmar campo, sin ajustes silenciosos fuera del snap documentado.
- Cmd/Ctrl+S guarda salvo diálogo incompatible; no interceptar espacio global mientras se escribe. Transport con botones accesibles y slider etiquetado: flechas ±1 frame, Home/End primero/último; espacio reproduce solo con foco en transport. Anunciar tiempo al pausar, no 30 veces/s.
- Lista con botones Subir/Bajar y nombre de escena; tras eliminar vuelve a vecina o Añadir. Tras mover mantiene foco/selección por ID. ReadOnly deja inspección/selección/descarga, no acciones que alteran contenido o inician trabajos.
- Diálogo real con nombre accesible, foco inicial no destructivo, Tab contenido, Escape cuando no deja operación ambigua y retorno al disparador. Error/pending persiste dentro; confirmar descartar no borra anterior hasta sustituto validado. No usar forced click para demostrar usabilidad.
- `aria-busy` en región en trabajo; status polite para guardado/etapas; errores importantes alert una vez. No usar solo color; botón deshabilitado con razón visible y acción de recuperación. Desactivar dobles envíos conservando edición concurrente donde M1 la soporta.
- Loading/empty/error/partial/readOnly/current/stale se prueban por componente. Fallo preview no borra draft; fallo/cancel job conserva último resultado; desconexión conserva memoria y última confirmación, sin fingir autosave. Audio se inicia por acción, nunca al montar/abrir. Movimiento reducido elimina decoración, no cambia tiempo determinista del video.

## Defaults técnicos visuales, no dirección artística aprobada

Dentro de `stylized-3d@1` / `explainer-v1`, escoger geometría reproducible de primitivas, no assets remotos. Catálogo V02: eje Y arriba, modelo centrado en origen, dimensiones finales exactamente `identity.proportions` mediante ajuste del modelo base, nunca escala no uniforme de instancia/padre. Car: cuerpo caja, cabina caja y cuatro ruedas cilíndricas; character: cabeza esférica y tronco/extremidades simples con rig mínimo; rockLayers: 2–6 cajas apiladas de igual altura; arrow: eje+punta orientados por direction; label: ancla 3D y texto DOM proyectado. Ratios de piezas versionados en tests, no variación por escena. Paleta/material de definición; luz diurna fija del catálogo o paleta dark. No física ni shaders importados.

Cámara: parámetros persistidos mandan; interpolación lineal y hold final de formato. Preview no modifica encuadre para «hacerlo bonito». Overlays: cajas de texto dentro de safeMargin, anclas upper/center/lower, palabra activa `[startMs,endMs)`, ajuste de línea limitado a ancho útil; overflow produce error visible de composición, no texto truncado. Fuente solo `builtin-sans-heavy-v1`, archivo/licencia pendientes D01. Colores/tamaño vienen del schema; comprobar contraste y oclusión en Chromium. Audio fixture y dirección estética se resuelven en D01/D02: estas decisiones técnicas no equivalen a aprobar font, cámara, voz o calidad final.

## Aceptación por capa

1. Tests puros prueban acciones, estado y ratios; DOM-only prueba formularios/errores sin afirmar geometría visible.
2. Chromium prueba foco, layout, fuente real, overlays/WebGL y captura completa; AV requiere decodificación/ffprobe/escucha con autorización nativa.
3. G2/V08 y H03 documentan revisión estética/auditiva humana separada del PASS técnico. No actualizar goldens ni tolerancias para ocultar un fallo. Registro de decisiones y tarjetas: [implementación](../plan/implementation-tasks.md).
