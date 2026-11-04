# Molecula Studio

Plan de una aplicación local para crear videos animados verticales a partir de guiones, escenas, voz y subtítulos. La visión contempla varios estilos; la primera entrega propone un único estilo 3D.

**Estado: implementación de M1 en curso.** Ya existen el schema ejecutable, el `ProjectStore` con commits atómicos, la frontera HTTP local del companion y un estudio mínimo en React para crear/editar/guardar/reabrir borradores. Todavía **no** hay render, voz, proveedores ni exportación MP4; nada de eso se declara disponible.

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

La primera fase implementada cubre persistencia y recuperación, no generación: guardar solo confirma tras verificar los bytes en disco, y un fallo de escritura conserva la revisión anterior. El render, la voz sintética y la exportación pertenecen a M2/M3 y requieren trabajo y autorización propios. No se afirma rendimiento, calidad de exportación ni reproducibilidad comprobada.

Repositorio de referencia: [tonistation/molecula_studio](https://github.com/tonistation/molecula_studio).
