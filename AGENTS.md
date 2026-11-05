# Molecula Studio — instrucciones para agentes

Estudio local para crear videos verticales animados (idea → guion → voz → vista previa → MP4). Existen schema `project.json` v1, `ProjectStore`, companion HTTP loopback y editor React. Todavía no hay render, voz ni MP4.

## Plan activo

**[ROADMAP.md](ROADMAP.md)** es el plan activo. Ejecutar **un paso por sesión** con sus reglas («Reglas para OpenCode»). Si otro documento lo contradice, prevalece ROADMAP.md hasta que el paso 0.1 alinee los documentos. [`docs/plan/implementation-tasks.md`](docs/plan/implementation-tasks.md) queda congelado como backlog posterior.

## Qué leer

1. ROADMAP.md: «Decisiones», «Arquitectura objetivo», «Reglas para OpenCode» y el paso pedido.
2. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md): stack, estilo de código y carpetas.
3. Solo los archivos que nombra el paso. No recorrer `docs/plan/` ni `docs/ux/` completos salvo que el paso lo pida.

## Comandos

- `npm run typecheck` · `npm test` · `npm run test:unit` · `npm run test:integration`
- `npm start`: compila el estudio y levanta el companion en `127.0.0.1:4787`.
- Node fijado por `.nvmrc` (26.x). No actualizar dependencias como efecto lateral.

## Reglas

- Código, identificadores y comentarios en inglés. Documentación y textos de UI en español profesional neutro.
- Extender lo existente (`ProjectStore`, schema, frontera HTTP); no reescribirlo.
- `src/shared/` y `src/companion/` se ejecutan con type stripping de Node: sin JSX ni `enum`.
- Secretos solo en variables de entorno; nunca en el repo, `project.json`, logs ni respuestas.
- Commits: al terminar un paso con typecheck y tests en verde, hacer commit automático en la rama del paso (conventional commits) y marcar el paso en «Progreso» de ROADMAP.md. Nunca commit en `main` ni push sin pedido del usuario.
- No instalar ni gastar en proveedores sin que el paso o el usuario lo autoricen.
- No modificar `docs/reference/original-specification.md`.
- Navegadores: Lightpanda solo para pruebas DOM del estudio y para leer documentación que usa JavaScript. No renderiza WebGL ni canvas, así que no sirve para render ni para validar lo visual: para eso usar Remotion Studio, la vista previa o el Chrome Headless Shell de Remotion.
- Si el paso contradice el código real o exige un cambio de schema o una dependencia nueva: detenerse y preguntar.

## Estilo de respuesta

Si la skill `caveman` está disponible, usarla **solo para las respuestas en el chat**. Nunca aplicarla a código, comentarios, documentación, textos de UI, mensajes de error ni commits. Comandos, rutas, salidas de tests y errores se citan textuales.
