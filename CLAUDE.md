# Orientación para contribuir a Molecula Studio

**M1/G1 técnico local cerrado; V01 implementado/revisado.** Hay aplicación React, companion Node, schema/ProjectStore y dependencias documentadas en [setup](docs/dev/setup.md). No hay runtime 3D, voz sintética ni MP4. Leer [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) primero. Esta intervención prepara documentación antes de más código; no iniciar V02 ni elegir modelo sin el alcance de ejecución correspondiente.

## Leer primero

1. [README.md](README.md): estado y navegación.
2. [docs/plan/README.md](docs/plan/README.md): alcance y secuencia de entrega.
3. [Requisitos](docs/plan/requirements.md), [arquitectura](docs/plan/architecture.md), [entrega](docs/plan/delivery.md) y [formato de proyecto](docs/plan/project-format.md).
4. [Experiencia de usuario](docs/ux/README.md), [pantallas](docs/ux/screens.md) y [flujos](docs/ux/flows.md).

El [PRD](docs/plan/requirements.md) es canónico; [API](docs/plan/api-contracts.md) distingue ocho operaciones reales de diseño futuro; [tarjetas](docs/plan/implementation-tasks.md) define ejecución posterior. Resolver contradicciones sin convertir diseño en aprobación del usuario. Bosquejos HTML no son seis pantallas funcionales.

## Base técnica existente y propuesta

- Aplicación local: React, TypeScript y Vite; proceso Node.js accesible solo por interfaz de bucle local (`loopback`).
- Primer estilo visual propuesto, aún no instalado: Three.js; capas SVG/DOM para gráficos y subtítulos.
- Exportación propuesta: Chromium con tiempo controlado por cuadro y composición con FFmpeg.
- Persistencia inicial: archivo JSON versionado para guardar y reabrir proyectos incompletos desde M1; los recursos asociados requieren un contrato explícito, no se presumen incluidos en el JSON.

React/TS/Vite, Node y playwright-core ya están declarados y fijados por package/lock/entorno. Consultar arquitectura/contexto para allowlist y alternativas excluidas. No añadir framework UI ni actualizar dependencias como efecto lateral; herramientas propuestas no prueban tecnología interna de referencias ni autorizan ejecución nativa.

## Reglas de trabajo

- Mantener la visión multiestilo, pero proponer un solo estilo 3D inicial; los estilos futuros deben aparecer deshabilitados, no como funciones disponibles.
- Conservar sin cambios `docs/reference/original-specification.md` y el original externo `../especificaciones_clon_atom.md`. Su instrucción histórica de inicializar código **no autoriza** implementación ahora.
- Documentar en español profesional; usar identificadores técnicos en inglés. Evitar duplicar contratos detallados en los índices.
- No modificar configuración global, herramientas compartidas ni archivos de otros trabajos concurrentes. No hacer instalaciones, commits, push o despliegues sin autorización.
- Mantener secretos fuera del repositorio, ejemplos, archivos de proyecto y registros. No activar proveedores, realizar llamadas de pago ni asumir gastos autorizados.
- En implementación futura, aplicar desarrollo guiado por pruebas (TDD) y revisión independiente. Exigir evidencias antes de afirmar persistencia, sincronización, determinismo o rendimiento.
- Para validación visual, WebGL, composición y capturas, usar Chromium; las comprobaciones DOM sin motor visual no sustituyen esa evidencia.

## Antes de ampliar el alcance

**Continuidad:** registro/ref/version ya persistidos; geometría, aislamiento de instancias y revisión visual siguen en V02/V07. Preservar identidad/proporciones; variantes solo intencionales, sin editor avanzado en MVP. Consultar [continuidad visual](docs/plan/visual-continuity.md); IDs válidos por sí solos no prueban render consistente.

Revisar criterios y riesgos en [delivery.md](docs/plan/delivery.md). Cambiar primero el contrato propuesto y dejar trazabilidad de la decisión; no añadir silenciosamente base de datos, infraestructura remota, proveedores o estilos adicionales.
