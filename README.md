# Molecula Studio

Plan de una aplicación local para crear videos animados verticales a partir de guiones, escenas, voz y subtítulos. La visión contempla varios estilos; la primera entrega propone un único estilo 3D.

**Estado: ROADMAP implementado hasta 5.4, con selector de voces y demo de planos distintos.** Existen schema 2, `ProjectStore`, companion HTTP y estudio React con renderer 3D, subtítulos, vista previa y exportación MP4 silenciosa o con voz por CLI/UI. Guion y dibujo ofrecen modos manual/automático con Codex CLI; voz permite subir WAV/MP3 o generar con Vibi TTS/STT, con consentimiento previo de consumo. Las suites usan dobles locales; después se realizó una prueba real limitada de Vibi con Alice (una TTS y una STT), con voz valorada positivamente por el usuario pero subtítulos estimados, no alineación real. Codex real y el recorrido completo con proveedores siguen pendientes. El [ROADMAP](ROADMAP.md) es el plan activo; el [backlog anterior](docs/plan/implementation-tasks.md) está congelado. Véanse el [contexto](PROJECT_CONTEXT.md) y la [evidencia histórica](docs/plan/delivery.md).

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

## Elegir y escuchar una voz

En un proyecto abierto: «Voz automática» → «Cargar voces Vibi» → elegir voz. El selector muestra nombre e idioma/acento cuando el catálogo los informa; la ficha amplía género, estilo y descripción disponibles. No se deduce «español mexicano» del nombre ni del idioma español. Si faltan datos, aparece «Idioma/acento no informado»; no hay filtro por país.

«Escuchar muestra» reproduce una muestra existente del proveedor, sin crear tareas TTS/STT ni enviar narración. Solo se habilita si hay una URL de muestra compatible y validada; «Detener», cambiar de voz o salir cancela la descarga y detiene el audio. La muestra puede estar en otro idioma. Generar la narración sigue requiriendo confirmar el consumo TTS + STT por separado. Esta mejora se verificó con documentación pública, HTTP falso y tonos locales, **sin nuevas consultas a cuentas/proveedores reales**; disponibilidad y acentos reales no comprobados. [Soporte y límites](ROADMAP.md#ampliación-autorizada--detalles-y-muestras-de-voces).

## Diagnóstico de subtítulos estimados

Si STT termina pero sus palabras o tiempos no son utilizables, se guarda el audio con subtítulos estimados y un aviso específico en Voz manual/automática: por ejemplo `[word-count-mismatch]`, `[text-mismatch]` o `[rounding-collapse]`. No se recortan tiempos ni se flexibiliza la coincidencia para aparentar alineación real. Los errores de proveedor siguen siendo errores, sin guardado.

La respuesta HTTP puede incluir `alignmentDiagnostic`: solo motivo, conteos acotados, duración del audio e índice de palabra, sin transcripción ni texto enviado. Es efímero: no se guarda en el proyecto ni se registra en logs. Al reabrir no se recupera ese diagnóstico. [Códigos y límites](ROADMAP.md#ampliación-autorizada--diagnóstico-de-alineación).

La prueba real anterior usó 76 caracteres y produjo 4963 ms de audio con 14 palabras estimadas. La respuesta STT cruda no se conservó: su causa exacta es desconocida y esta mejora **no demuestra corregir ese caso**. No se hicieron nuevas llamadas reales ni reintentos.

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

Guardar solo confirma tras verificar los bytes en disco; fallo precommit conserva anterior y fallo postcommit puede ser incierto. Hay exportación H.264/AAC 1080×1920 a 30 fps, voz manual/automática y flujo guiado. Siguen pendientes Codex real, recorrido completo con proveedores, validación humana del video completo y sincronía fonética fina; la escucha positiva de Alice corresponde solo a la prueba corta. Metadatos/muestras de voces siguen sin verificarse contra una cuenta real. Véase el [ROADMAP](ROADMAP.md). No se afirma rendimiento garantizado ni aprobación estética humana. Riesgos históricos de save/retención están documentados en [API](docs/plan/api-contracts.md).

Repositorio de referencia: [tonistation/molecula_studio](https://github.com/tonistation/molecula_studio).
