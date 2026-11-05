# Referencias visuales

Criterios del resultado buscado, extraídos de dos ejemplos (15 s cada uno, 9:16). Leer antes de los pasos 1.3, 1.4, 3.1 y 3.3 de [ROADMAP.md](../../../ROADMAP.md).

Las hojas de cuadros son imágenes locales opcionales y no se versionan. Los criterios escritos aquí pueden consultarse sin ellas.

| Archivo local opcional | Tema |
|---|---|
| `ref-sal.jpg` | «¿De dónde sale la sal del mar?» — paisaje, ríos, rocas, lluvia |
| `ref-brazo.jpg` | Ejercicio de brazo en el marco de una puerta — personaje, cuenta regresiva |

Fuente original de referencia: <https://www.proyectoatom.lat> (producto comercial de terceros). **Son referencias de género y calidad, no de marca:** no copiar sus personajes, nombre «ATOM», logotipos ni escenas concretas.

## Criterios

| Aspecto | Qué se ve | Regla para Molecula |
|---|---|---|
| Estética 3D | Low-poly con sombreado plano (caras visibles), colores saturados, cielo con degradado, sol y nubes simples. | Material plano (`flatShading`), paleta por escena, sin texturas fotográficas. |
| Objetos | **Específicos del tema** en cada escena: salero, montaña con río, cascada, roca, gota, personaje frente a una puerta. | Un catálogo fijo de 5 entidades no alcanza. Ver «Implicación» abajo. |
| Cámara | Movimiento constante y suave: acercamientos a un objeto, paneos siguiendo un río, ligera inclinación. Nunca estática. | Cada escena tiene al menos un movimiento de cámara con easing. |
| Animación | Partículas (destellos, lluvia, burbujas), agua que fluye, objetos que caen o ruedan, brazo del personaje que se levanta. | Animaciones derivadas del frame; partículas con seed determinista. |
| Subtítulos | Tercio superior. Frase corta (1 línea, 2–5 palabras). Palabras ya dichas o por decir en gris translúcido; **palabra activa en blanco y negrita**. A veces la palabra clave lleva recuadro. Sans geométrica, tamaño moderado (≈ 4–5 % del ancho). | Estilo «karaoke» por defecto; recuadro como `emphasis`. |
| Rótulos | Píldoras oscuras redondeadas con texto blanco anclados a objetos 3D («agua dulce», «agua salada»). | Rótulos como overlay DOM proyectado desde la posición 3D. |
| Elementos UI | Contador «30 s» en píldora, flechas `>>` animadas que indican acción. | Componentes overlay reutilizables (contador, flecha, rótulo). |
| Ritmo | Cambio de plano o de foco cada 2–3 s; gancho con pregunta en el primer segundo. | Escenas cortas (2–5 s) y prompt de guion con gancho inicial. |
| Sonido | Voz en off continua; el producto de referencia además tiene paso de «Sonido» (música/efectos). | Música y efectos en Fase 6 (requiere schema 2). |

## Implicación para la arquitectura

Estos videos no salen de un catálogo fijo de primitivas: cada escena se **construye para el tema**. Hace falta un «kit de escena» (terreno, agua, nubes, partículas, rocas, personaje articulado, rótulos, movimientos de cámara) y que el paso de IA **componga escenas con ese kit**. La forma de hacerlo (escena declarativa en JSON o código generado) es una decisión abierta registrada en ROADMAP.md.

## Referencia de método: 187 Media

<https://187media.com> vende un kit de pago único (carpeta de instrucciones para Claude o ChatGPT de escritorio; voz con ElevenLabs aparte), no una suscripción. Lo útil es su **fórmula de contenido**, aplicable al prompt de guion (paso 3.1):

1. **Pregunta reconocible en 3 s** («¿Por qué la paloma no se electrocuta en el cable?»). Si no se reconoce al instante, no se hace.
2. **Investigación con fuentes**, explicada con palabras simples.
3. **Cierre para compartir:** llevar la idea a la vida del espectador y a alguien que conoce.
4. Entregables extra: **portada** y **texto del post**; efectos de sonido sutiles en giros y cifras.

Su enfoque es que la IA dibuje y anime cada escena (código generado), cercano a la opción B de ADR-09.

## Otros estilos vistos (futuros, deshabilitados)

- **Noche cinematográfica:** escenas 3D nocturnas, look documental, subtítulos pequeños en minúscula.
- **Infografía neón:** gráficos y cifras animados sobre fondo oscuro.
