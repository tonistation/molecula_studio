# Plan de Molecula Studio

**M0: definir y revisar el producto antes de implementarlo.** Este índice orienta la lectura; los contratos detallados pertenecen a los documentos enlazados. Su integración cruzada está pendiente y ningún hito de producto se declara cumplido.

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

1. [Requisitos](requirements.md): necesidades, exclusiones y aceptación.
2. [Experiencia de usuario](../ux/README.md): [pantallas](../ux/screens.md), [flujos](../ux/flows.md) y [bosquejos HTML](../ux/wireframes.html).
3. [Formato de proyecto](project-format.md): guardar, validar y reabrir trabajo parcial.
4. [Arquitectura](architecture.md): componentes y límites de confianza.
5. [Entrega](delivery.md): dependencias, pruebas y condiciones de avance.

Los archivos enlazados están siendo redactados en paralelo; revisar su coherencia al integrarlos. Para abrir los bosquejos estáticos, consultar el [README principal](../../README.md).

## Secuencia propuesta

| Hito | Resultado esperado, todavía no implementado |
| --- | --- |
| M0 — Plan actual | Requisitos, contratos, riesgos y bosquejos revisados antes de desarrollar |
| M1 — Persistencia primero | Crear trabajo parcial, guardarlo en JSON y reabrirlo sin exigir contenido completo; probar errores y conservación de datos |
| M2 — Prueba vertical | Video de 10–15 segundos, formato 9:16, primer estilo 3D, audio y subtítulos; evidencia de renderizado con tiempo determinista y límites declarados |
| M3 — Editor e integraciones | Edición de proyecto e integración controlada con proveedores; cualquier activación o gasto requiere autorización específica |
| M4 — Validación | Verificación integral de recuperación, exportación, experiencia de usuario y límites en un entorno documentado |

Los criterios completos y el orden de dependencias se mantienen en [delivery.md](delivery.md), no en este resumen. La recuperación de proyectos de M1 debe conservarse durante los hitos posteriores.

## Evidencia y pendientes

- La [especificación original](../reference/original-specification.md) se conserva como antecedente inmutable. Sus ejemplos y afirmaciones estéticas no sustituyen requisitos actuales ni prueban la implementación de terceros.
- Los bosquejos expresan intención; no prueban que exista editor, persistencia, voz o exportación. El motor de ejecución no está construido y no hay medidas de rendimiento ni demostración de determinismo.
- Antes de implementar: integrar documentos, resolver discrepancias, revisar riesgos de recursos y licencias, y acordar las evidencias de aceptación. El JSON no debe contener secretos ni código ejecutable.

### Referencias técnicas oficiales

Para contrastar las propuestas: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/docs/), [Vite](https://vite.dev/guide/), [Node.js](https://nodejs.org/en/learn), [Three.js](https://threejs.org/docs/), [Playwright](https://playwright.dev/docs/intro) y [FFmpeg](https://ffmpeg.org/documentation.html). Son referencias de investigación, no dependencias instaladas ni evidencia de la arquitectura de Atom o Caniscopio.
