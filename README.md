# Molecula Studio

Plan de una aplicación local para crear videos animados verticales a partir de guiones, escenas, voz y subtítulos. La visión contempla varios estilos; la primera entrega propone un único estilo 3D.

**Estado: M1/G1 técnico local cerrado y V01 implementado/revisado** (base `cbfc125`). Existen schema ejecutable, `ProjectStore`, companion HTTP y estudio React para crear/editar/guardar/reabrir borradores; V01 añade reloj/selección de escena, no composición. Todavía **no** hay render, voz sintética, proveedores ni exportación MP4. El [ROADMAP](ROADMAP.md) es el plan activo hacia el primer video; el [backlog anterior](docs/plan/implementation-tasks.md) está congelado. Véanse el [contexto](PROJECT_CONTEXT.md) y la [evidencia histórica](docs/plan/delivery.md).

## Ejecutar localmente

Requiere Node.js 26 (`.nvmrc`).

```sh
npm install
npm start   # compila el estudio (React + Vite) y levanta el companion
```

Abrí `http://127.0.0.1:4787`. El companion sirve el estudio en loopback con un token efímero inyectado en la página; no hay CORS abierto ni acceso al home completo. El workspace por defecto es `./workspace` (`MOLECULA_WORKSPACE` para cambiarlo).

```sh
npm run typecheck       # raíz + studio
npm test                # unit + integración (disco real)
npm run test:e2e        # navegador real (Lightpanda) contra el companion
```

## Por dónde empezar

1. Revisar el [ROADMAP activo](ROADMAP.md) y el [contexto](PROJECT_CONTEXT.md).
2. Recorrer las [pantallas y flujos](docs/ux/README.md) y abrir los [bosquejos HTML](docs/ux/wireframes.html) en un navegador.
3. Revisar el [formato de proyecto](docs/plan/project-format.md): **guardar y reabrir trabajos incompletos mediante JSON es un requisito de la primera fase de implementación (M1)**.

Para abrir los bosquejos en macOS desde la raíz del repositorio:

```sh
open docs/ux/wireframes.html
```

El HTML es una propuesta visual estática, no la aplicación ni una prueba de persistencia o renderizado. Para leer esas láminas no hace falta iniciar el companion. [Componentes/layout](docs/ux/components.md) distingue UI existente de diseño futuro; no hay aprobación estética humana implícita.

## Mapa de documentación

| Documento | Qué revisar |
| --- | --- |
| [ROADMAP](ROADMAP.md) | Plan activo, decisiones y pasos hacia el primer video |
| [Licencias](docs/dev/licenses.md) | Condiciones y versiones pendientes de los componentes previstos |
| [Requisitos](docs/plan/requirements.md) | Alcance, exclusiones y criterios de aceptación |
| [Arquitectura](docs/plan/architecture.md) | Componentes propuestos, límites y riesgos técnicos |
| [Entrega](docs/plan/delivery.md) | Hitos M0–M4 y evidencias necesarias para avanzar |
| [Formato de proyecto](docs/plan/project-format.md) | Persistencia JSON y recuperación de trabajo parcial |
| [API y datos de ejecución](docs/plan/api-contracts.md) | Ocho operaciones actuales y contratos futuros explícitamente no disponibles |
| [Tarjetas de implementación](docs/plan/implementation-tasks.md) | Backlog histórico congelado; no es el plan activo |
| [Experiencia de usuario](docs/ux/README.md) | [Pantallas](docs/ux/screens.md), [flujos](docs/ux/flows.md) y bosquejos |
| [Especificación original](docs/reference/original-specification.md) | Referencia histórica inmutable, no contrato actualizado |
| [Orientación de desarrollo](CLAUDE.md) | Reglas para futuras contribuciones |

## Límites actuales

**Continuidad visual requerida:** el JSON ya conserva entidades reutilizables; cada aparición referencia `entityId` y versión. La continuidad de datos está probada, no la geometría/render aún inexistentes. Las variantes deben ser intencionales, sin editor avanzado en el MVP. Véase [continuidad visual](docs/plan/visual-continuity.md) y V02/V07 para sus oráculos.

La primera fase implementada cubre persistencia y recuperación, no generación: guardar solo confirma tras verificar los bytes en disco; fallo precommit conserva anterior y fallo postcommit puede ser incierto. Render, voz y exportación siguen pendientes en el [ROADMAP](ROADMAP.md) y requieren los permisos aplicables. No se afirma rendimiento, calidad de exportación ni reproducibilidad audiovisual comprobada. Riesgos estáticos adicionales de revisión de save/retención están documentados en [API](docs/plan/api-contracts.md), sin fixes funcionales en esta intervención.

Repositorio de referencia: [tonistation/molecula_studio](https://github.com/tonistation/molecula_studio).
