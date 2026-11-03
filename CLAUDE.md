# Orientación para contribuir a Molecula Studio

**Repositorio en planificación: no iniciar desarrollo del producto sin autorización.** No hay aplicación, servidor de producto, dependencias ni versiones instaladas documentadas. No inventar comandos de paquetes, variables de entorno o despliegues.

## Leer primero

1. [README.md](README.md): estado y navegación.
2. [docs/plan/README.md](docs/plan/README.md): alcance y secuencia de entrega.
3. [Requisitos](docs/plan/requirements.md), [arquitectura](docs/plan/architecture.md), [entrega](docs/plan/delivery.md) y [formato de proyecto](docs/plan/project-format.md).
4. [Experiencia de usuario](docs/ux/README.md), [pantallas](docs/ux/screens.md) y [flujos](docs/ux/flows.md).

Estos documentos son la fuente de los contratos propuestos. Están pendientes de integración y revisión conjunta: resolver contradicciones explícitamente, sin convertir recomendaciones en aprobaciones del usuario. Los bosquejos HTML no implementan esos contratos.

## Base técnica recomendada, no instalada

- Aplicación local: React, TypeScript y Vite; proceso Node.js accesible solo por interfaz de bucle local (`loopback`).
- Primer estilo visual: Three.js; capas SVG/DOM para gráficos y subtítulos.
- Exportación propuesta: Chromium con tiempo controlado por cuadro y composición con FFmpeg.
- Persistencia inicial: archivo JSON versionado para guardar y reabrir proyectos incompletos desde M1; los recursos asociados requieren un contrato explícito, no se presumen incluidos en el JSON.

Consultar la arquitectura para alternativas, restricciones y pruebas pendientes. Esta selección es una propuesta propia, no evidencia de la tecnología interna de productos de referencia. No fijar versiones ni añadir herramientas sin la evaluación correspondiente.

## Reglas de trabajo

- Mantener la visión multiestilo, pero proponer un solo estilo 3D inicial; los estilos futuros deben aparecer deshabilitados, no como funciones disponibles.
- Conservar sin cambios `docs/reference/original-specification.md` y el original externo `../especificaciones_clon_atom.md`. Su instrucción histórica de inicializar código **no autoriza** implementación ahora.
- Documentar en español profesional; usar identificadores técnicos en inglés. Evitar duplicar contratos detallados en los índices.
- No modificar configuración global, herramientas compartidas ni archivos de otros trabajos concurrentes. No hacer instalaciones, commits, push o despliegues sin autorización.
- Mantener secretos fuera del repositorio, ejemplos, archivos de proyecto y registros. No activar proveedores, realizar llamadas de pago ni asumir gastos autorizados.
- En implementación futura, aplicar desarrollo guiado por pruebas (TDD) y revisión independiente. Exigir evidencias antes de afirmar persistencia, sincronización, determinismo o rendimiento.
- Para validación visual, WebGL, composición y capturas, usar Chromium; las comprobaciones DOM sin motor visual no sustituyen esa evidencia.

## Antes de ampliar el alcance

**Contrato propuesto de continuidad:** registrar entidades reutilizables en el JSON; las apariciones referencian `entityId` y versión y contienen estado por escena. Preservar identidad y bloquear proporciones; permitir únicamente variantes intencionales, sin editor avanzado en el MVP. El renderizado mediante código no evita inconsistencias si cada escena regenera entidades. Consultar [continuidad visual](docs/plan/visual-continuity.md), pendiente de integración; comprobar la continuidad con revisión visual independiente, no solo con referencias válidas.

Revisar criterios y riesgos en [delivery.md](docs/plan/delivery.md). Cambiar primero el contrato propuesto y dejar trazabilidad de la decisión; no añadir silenciosamente base de datos, infraestructura remota, proveedores o estilos adicionales.
