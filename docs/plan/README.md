# Plan de Molecula Studio

**M1/G1 técnico local cerrado y V01 implementado/revisado** en `cbfc125`; no hay composición ni MP4 todavía. Este índice orienta; [delivery](delivery.md) conserva evidencia por criterio. El plan actualizado requiere revisión documental independiente antes de más código, sin confundir cierre técnico con aprobación estética.

## Alcance y decisiones

La visión es una herramienta local de creación de videos animados verticales con distintos estilos. Se propone empezar con **un único estilo 3D**, dejando las alternativas futuras visibles pero deshabilitadas, sin prometer generación visual arbitraria.

| Estado | Decisión o restricción |
| --- | --- |
| Aprobado por el usuario | Plan completo con bosquejos de pantallas antes del desarrollo; repositorio `tonistation/molecula_studio`; dirección multiestilo |
| Requisito del usuario | Guardar y reabrir proyectos incompletos desde la primera fase; JSON simple de configuraciones como solución inicial |
| Propuesta del plan | Un estilo 3D inicial; arquitectura local; secuencia M1–M4 y criterios técnicos sujetos a revisión |
| No autorizado por este plan | Desarrollo inmediato, instalaciones, activación de proveedores, gastos o despliegues |

El guardado no depende de terminar el guion, generar voz ni exportar un video. El contrato de JSON debe distinguir configuración, recursos externos y trabajo pendiente; guardar configuraciones no implica empaquetar automáticamente todos los recursos.

**Requisito aclarado por el usuario:** personajes y objetos conservan identidad y proporciones entre escenas. **Decisión de diseño propuesta:** registro de entidades reutilizables en JSON; cada aparición referencia `entityId` y versión, con estado por escena y proporciones bloqueadas. Variantes solo intencionales, sin editor avanzado en el MVP. El renderizado mediante código no garantiza continuidad si se regeneran entidades por escena. El contrato se desarrolla en [continuidad visual](visual-continuity.md), pendiente de integración y revisión visual independiente.

## Ruta de revisión

1. [Contexto de una página](../../PROJECT_CONTEXT.md) y [PRD canónico](requirements.md): necesidades, exclusiones, R01–R20 y trazabilidad.
2. [Experiencia de usuario](../ux/README.md): [pantallas](../ux/screens.md), [flujos](../ux/flows.md) y [bosquejos HTML](../ux/wireframes.html).
3. [Formato de proyecto](project-format.md): guardar, validar y reabrir trabajo parcial.
4. [API actual y diseñada](api-contracts.md), [arquitectura](architecture.md): transporte, DTO, límites y retención.
5. [Componentes UI](../ux/components.md): layout, props, propiedad y estados.
6. [Entrega](delivery.md) y [tarjetas detalladas](implementation-tasks.md): evidencia, DAG, pruebas rojas y ejecución futura.

No iniciar consumidores de contratos nuevos antes de C01/revisión; permisos de fuente/audio/nativo/proveedor se identifican por tarea. Para abrir bosquejos estáticos, consultar el [README principal](../../README.md).

## Secuencia propuesta

| Hito | Estado y resultado |
| --- | --- |
| M0 — Plan | Documentos y bosquejos existentes; actualización de handoff pendiente de revisión fresca |
| M1 — Persistencia primero | G1 técnico local cerrado; borrador, copia/importación/relink y recuperación con evidencia real |
| M2 — Prueba vertical | Solo V01 completo (reloj/selección); V02–V08 pendientes para video de 10–15 s, 9:16, 3D/audio/subtítulos |
| M3 — Editor e integraciones | Edición de proyecto e integración controlada con proveedores; cualquier activación o gasto requiere autorización específica |
| M4 — Validación | Verificación integral de recuperación, exportación, experiencia de usuario y límites en un entorno documentado |

Los criterios completos y el orden de dependencias se mantienen en [delivery.md](delivery.md), no en este resumen. La recuperación de proyectos de M1 debe conservarse durante los hitos posteriores.

## Evidencia y pendientes

- La [especificación original](../reference/original-specification.md) se conserva como antecedente inmutable. Sus ejemplos y afirmaciones estéticas no sustituyen requisitos actuales ni prueban la implementación de terceros.
- Los bosquejos expresan intención; la evidencia de persistencia proviene de tests M1, no del HTML. V01 demuestra determinismo de metadatos, no de píxeles/audio. No hay medidas de rendimiento AV.
- Antes de más código: revisar este conjunto y gates explícitos; C01 materializa contratos compartidos. El JSON no contiene secretos, jobs ni código ejecutable.

### Referencias técnicas oficiales

Para contrastar las propuestas: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/docs/), [Vite](https://vite.dev/guide/), [Node.js](https://nodejs.org/en/learn), [Three.js](https://threejs.org/docs/), [Playwright](https://playwright.dev/docs/intro) y [FFmpeg](https://ffmpeg.org/documentation.html). Los enlaces no prueban instalación ni versión: consultar package/lock y [setup](../dev/setup.md). Tampoco acreditan la arquitectura interna de productos de referencia.
