# Molecula Studio

Plan de una aplicación local para crear videos animados verticales a partir de guiones, escenas, voz y subtítulos. La visión contempla varios estilos; la primera entrega propone un único estilo 3D.

**Estado: planificación (M0), sin producto implementado.** Este repositorio no ofrece todavía editor, guardado de proyectos ni exportación de video. Los documentos y bosquejos definen lo que se propone construir, no funcionalidades disponibles.

## Por dónde empezar

1. Revisar el [índice del plan](docs/plan/README.md): alcance, decisiones y etapas.
2. Recorrer las [pantallas y flujos](docs/ux/README.md) y abrir los [bosquejos HTML](docs/ux/wireframes.html) en un navegador.
3. Revisar el [formato de proyecto](docs/plan/project-format.md): **guardar y reabrir trabajos incompletos mediante JSON es un requisito de la primera fase de implementación (M1)**.

Para abrir los bosquejos en macOS desde la raíz del repositorio:

```sh
open docs/ux/wireframes.html
```

Es una propuesta visual estática, no la aplicación ni una prueba de persistencia o renderizado. No requiere iniciar un servidor de producto. Los documentos enlazados se están integrando; los enlaces pendientes no representan funciones implementadas.

## Mapa de documentación

| Documento | Qué revisar |
| --- | --- |
| [Requisitos](docs/plan/requirements.md) | Alcance, exclusiones y criterios de aceptación |
| [Arquitectura](docs/plan/architecture.md) | Componentes propuestos, límites y riesgos técnicos |
| [Entrega](docs/plan/delivery.md) | Hitos M0–M4 y evidencias necesarias para avanzar |
| [Formato de proyecto](docs/plan/project-format.md) | Persistencia JSON y recuperación de trabajo parcial |
| [Experiencia de usuario](docs/ux/README.md) | [Pantallas](docs/ux/screens.md), [flujos](docs/ux/flows.md) y bosquejos |
| [Especificación original](docs/reference/original-specification.md) | Referencia histórica inmutable, no contrato actualizado |
| [Orientación de desarrollo](CLAUDE.md) | Reglas para futuras contribuciones |

## Límites actuales

**Continuidad visual requerida:** personajes y objetos deben conservar identidad y proporciones entre escenas. Se propone un registro de entidades reutilizables en el JSON; cada aparición referencia `entityId` y versión, con estado por escena y proporciones bloqueadas. Las variantes deben ser intencionales, sin editor avanzado en el MVP. Renderizar mediante código no garantiza continuidad si cada escena regenera sus entidades. Véase [continuidad visual](docs/plan/visual-continuity.md), pendiente de integración.

Primero se revisará el plan completo, incluidos los bosquejos; el desarrollo del producto requiere autorización posterior. No hay comandos de instalación, ejecución o pruebas del producto definidos, ni proveedores activados. No se afirma rendimiento, calidad de exportación ni reproducibilidad comprobada.

Repositorio de referencia: [tonistation/molecula_studio](https://github.com/tonistation/molecula_studio).
