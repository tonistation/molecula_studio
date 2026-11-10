# Molecula Studio

Aplicación local para crear videos animados verticales a partir de guiones, escenas, voz y subtítulos. La primera entrega utiliza un kit declarativo 3D.

**Estado: implementado hasta 5.4; componentes reales verificados, aceptación humana pendiente.** Schema 2, persistencia local, editor React, kit 3D, subtítulos y exportación MP4 por CLI/UI. Guion/dibujo ofrecen modos manual/automático con Codex CLI; voz permite WAV/MP3 o Vibi TTS/STT con consentimiento. La aceptación del 09/11/2026 confirmó los schemas reales de guion y dibujo por separado y un recorrido **guion manual → dibujo Codex real → voz/alineación Vibi reales → MP4 descargado y reabierto**. No verifica un pipeline totalmente automático sobre la misma propuesta. El [ROADMAP](ROADMAP.md#aceptación-real-acotada--9-de-noviembre-de-2026) detalla resultados y límites; el [backlog anterior](docs/plan/implementation-tasks.md) sigue congelado.

En la aceptación automática posterior se guardó un guion de tres escenas; el primer dibujo devolvió HTTP 504 tras el límite local de 180 s. La causa de la espera es desconocida. Los errores de proceso incluyen metadatos efímeros acotados, sin salida del CLI; no demuestran qué ocurrió dentro de Codex.

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
npm run render -- workspace/<projectId>/project.json [salida.mp4]
```

El render lee la revisión guardada, no modifica el JSON y no exige aprobación editorial. Por defecto publica en `<workspace>/.renders/<projectId>/<revision>-<fecha-UTC>.mp4`; el workspace es el padre de la carpeta del documento. Una salida explícita es relativa al directorio actual; debe ser `.mp4` y no existir. Admite modo silencioso o voz desde los activos guardados. Ejemplo externo: `npm run render -- docs/plan/examples/storyboard-project.json workspace/storyboard.mp4`.

### Demo con planos distintos

El [storyboard de la sal del mar](docs/plan/examples/kit/sal-del-mar-storyboard.json) es un proyecto portátil de 36 s, sin archivos externos: montaña con lluvia → detalle de disolución → seguimiento del río → mar con evaporación. Se puede importar en el estudio o renderizar en silencio:

```sh
npm run render -- docs/plan/examples/kit/sal-del-mar-storyboard.json workspace/sal-del-mar-planos.mp4
```

Usar una salida nueva al repetir. La [demo local con voz](ROADMAP.md#ampliación-autorizada--demo-con-planos-distintos) dura 35,8 s y usa Paulina de macOS, sin proveedor ni gasto. Sus binarios no se versionan; no se afirma permiso de redistribución de esa voz. Los puntos dorados son símbolos ampliados, no cristales visibles en el agua.

### Apariencia del kit y compatibilidad

Las flechas son sólidos cerrados: la mayor dimensión de `proportions` define el largo; las otras dos, los diámetros de la punta elíptica. No se recortan las medidas. La punta ocupa el 35 % del largo y el cuerpo el 65 %, con diámetros del 40 % de la punta. El eje local +Y se orienta hacia `direction` antes de aplicar `rotation`. Ejemplo alargado: `{ "width": 0.3, "height": 1.5, "depth": 0.25 }`. Esta convención admite tanto flechas históricas largas en `depth` como dibujos largos en `height`.

El renderer usa luz principal con sombras suaves y relleno moderado, conservando sombreado plano y colores del proyecto. Las sombras cubren un volumen central de 48 unidades de ancho; no se garantiza cobertura para escenarios arbitrariamente grandes. Los ríos con terreno reciben orillas inclinadas que siguen sus puntos, hasta 0,18 anchos adicionales por lado y 0,08 anchos de relieve; no se añaden a cascadas ni mares. No se excava terreno ni se unen automáticamente objetos separados: hay que componer sus alturas y desembocaduras.

Durante `appear`, `disappear` y el `reveal` histórico, el material de profundidad usa la misma opacidad animada con `alphaHash` determinista. Las sombras parciales pueden mostrar grano y oscurecerse de forma no lineal cuando se superponen varias piezas; no requieren acumulación temporal ni cambian las sombras totalmente opacas. No se conserva una sombra opaca hasta el último frame ni se desactiva durante todo el fundido.

Son cambios de **apariencia compartidos por vista previa y exportación**, no de schema: los JSON anteriores siguen siendo válidos, conservan parámetros e identidades, pero sus renders pueden verse distintos. No hay migración ni reescritura automática de proyectos. El prompt de dibujo explica dimensiones, jerarquía visual y márgenes de cámara; la aprobación estética sigue siendo humana.

## Elegir y escuchar una voz

En un proyecto abierto: «Voz automática» → «Cargar voces Vibi» → elegir voz. El selector muestra nombre e idioma/acento cuando el catálogo los informa; la ficha amplía género, estilo y descripción disponibles. No se deduce «español mexicano» del nombre ni del idioma español. Si faltan datos, aparece «Idioma/acento no informado»; no hay filtro por país.

«Escuchar muestra» solicita audio existente, sin crear tareas TTS/STT ni enviar narración. Solo se habilita con una URL compatible y validada; «Detener», cambiar de voz o salir cancela la descarga y detiene el audio. Puede estar en otro idioma. El catálogo real funcionó, pero la única muestra solicitada devolvió 502: **su causa y disponibilidad upstream siguen desconocidas**, no se afirma reproducción real ni gratuidad universal. Ahora el error distingue HTTP, formato, firma, tamaño, red y plazo mediante datos seguros efímeros; la voz sigue utilizable y generar requiere su consentimiento separado. [Soporte y límites](ROADMAP.md#ampliación-autorizada--detalles-y-muestras-de-voces).

## Alineación parcial y diagnóstico de subtítulos

Si STT coincide exactamente en cantidad, orden y texto normalizado, se conservan todos los tiempos válidos. Solo los tramos contiguos con duración nula o negativa se estiman dentro del espacio libre entre tiempos válidos vecinos, o entre un vecino y el inicio/final del audio. El aviso en Voz manual/automática indica «Alineación parcial: se conservaron los tiempos válidos; X palabras con tiempos estimados». No se desplazan vecinos ni se excede la duración inspeccionada del audio.

Sin al menos un tiempo válido, sin 1 ms libre por palabra defectuosa, o ante texto distinto, tiempos no finitos/negativos/fuera del audio, solapamientos de tiempos válidos o colapso de redondeo, se mantiene la estimación completa con motivo específico. No se recortan ni ordenan tiempos. Los errores de proveedor siguen siendo errores, sin guardado.

Las respuestas HTTP incluyen `alignmentKind: 'aligned' | 'partial' | 'estimated'`. Por compatibilidad, `alignment` sigue siendo `'estimated'` si hay cualquier palabra estimada, incluso en modo parcial. `alignmentDiagnostic` conserva motivo, conteos acotados, duración e índice; solo la recuperación parcial añade `repairedWordCount`. Sin transcripción ni timestamps crudos en diagnóstico/logs. Estos metadatos son efímeros: se guardan los tiempos mixtos en `words` y sus vínculos habituales, **no su procedencia parcial**. Reabrir conserva tiempos, pero no recupera el aviso ni puede identificar qué palabras se estimaron. No cambia el schema. [Política exacta](ROADMAP.md#ampliación-autorizada--alineación-parcial).

La primera prueba real con Alice usó 76 caracteres y produjo 4963 ms de audio con 14 palabras estimadas; no se conservó la respuesta STT y su causa exacta sigue desconocida. Una segunda prueba STT autorizada sobre ese audio, sin nueva TTS, identificó 27 entradas (14 palabras y 13 espacios), texto coincidente y duración no positiva en las palabras 12 y 13 (índices desde cero). No se retuvieron transcripción ni timestamps crudos. Esta recuperación se verifica con una **reproducción sintética estructural**, no con la respuesta real conservada ni una nueva llamada real. Durante esta implementación no hubo consultas a proveedores, cuentas, claves ni reintentos pagados.

La aceptación posterior del 09/11/2026 es distinta: una TTS + una STT con Alice - Clear, Engaging Educator produjeron 5198 ms y 14 palabras completamente alineadas (`alignmentKind: 'aligned'`), sin estimación. Los tiempos y vínculos permanecieron al reabrir. Es alineación técnica válida; la precisión fonética y la aprobación audiovisual humanas siguen pendientes.

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

**Continuidad visual requerida:** el JSON conserva entidades reutilizables y el kit tiene renderer determinista con pruebas de seek y objetos compartidos. Las variantes deben ser intencionales, sin editor avanzado en el MVP. La aprobación estética final sigue siendo humana. Véase [continuidad visual](docs/plan/visual-continuity.md).

Guardar solo confirma tras verificar los bytes en disco; fallo precommit conserva anterior y fallo postcommit puede ser incierto. Hay exportación H.264/AAC 1080×1920 a 30 fps, voz manual/automática y flujo guiado. Siguen pendientes el recorrido totalmente automático sobre una misma propuesta, la disponibilidad real de muestras y la revisión audiovisual/fonética humana. Los rótulos anclados ahora ajustan su texto completo y su rectángulo al margen seguro sin modificar cámara ni objetos. No se afirma rendimiento garantizado ni aprobación estética humana. Riesgos históricos de save/retención: [API](docs/plan/api-contracts.md).

Repositorio de referencia: [tonistation/molecula_studio](https://github.com/tonistation/molecula_studio).
