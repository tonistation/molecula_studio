# Especificaciones Técnicas (PRD): Clon Local "Proyecto Atom"

Este documento contiene las especificaciones arquitectónicas y técnicas para construir un motor local de generación automática de videos verticales (.mp4) con estética isométrica 3D, bajo poligonado (Low Poly), subtítulos palabra por palabra (Kinetic Typography) y voz en off sintética, optimizado para ser programado por agentes de IA como **Claude Code**, **Codex** o **Argon**.

---

## 1. Visión del Sistema y Alcance
El sistema automatiza el pipeline de producción de video en formato vertical (1080x1920, 9:16) abstrayendo toda la edición en código mediante dos componentes principales:
1. **Generación de Activos (Orquestación por IA):** Guion, audio de voz en off (ElevenLabs), marcas de tiempo estructuradas y metadata de la escena en formato JSON.
2. **Motor de Renderizado Local:** Un navegador sin interfaz (Headless Chrome vía Puppeteer/Playwright) que ejecuta una escena en **Three.js (WebGL)** para el entorno 3D y manipula el DOM para los subtítulos cinéticos, capturando el lienzo (`<canvas>`) cuadro por cuadro mediante **FFmpeg**.

---

## 2. Análisis Estético de Referencias (Proyecto Atom)

Basado en los ejemplos de `proyecto_atom` (ej. `tuerca.mp4`, `brazo.mp4`), la estética visual se descompone en los siguientes parámetros exactos para producción:

* **Cámara Isométrica / Ortográfica:** Cámara fija apuntando en diagonal (`Vector3(1, 1, 1).normalize()`). Elimina la perspectiva de fuga. Los objetos lejanos miden lo mismo que los cercanos.
* **Estilo Low Poly (Flat Shading):** Modelos 3D limpios con conteo poligonal bajo. Las superficies no se suavizan; se activa `flatShading: true` en los materiales de Three.js para que las facetas geométricas reaccionen de forma dura a la luz.
* **Iluminación de Contraste Extremo:** Fondo del lienzo completamente oscuro (`#05050a` o negro puro). La iluminación depende de luces direccionales intensas y focos cónicos (`SpotLight`) con sombras proyectadas de alta resolución para generar atmósfera de maqueta nocturna.
* **Subtítulos Tipo "Pop-In" Sincronizados:** El texto aparece en el centro exacto, una palabra a la vez. Utiliza fuentes Sans-Serif ultra pesadas (`Montserrat Black` o `The Bold Font`). Cada palabra clave se ilumina en colores de alto impacto (Verde Neón `#00FFCC` o Amarillo Neón) o se encierra en un recuadro sólido.
* **Elementos de Interfaz de Datos:** Inclusión de indicadores analíticos falsos superpuestos en el Canvas 2D o DOM (velocímetros, trayectorias lineales dibujadas, cronómetros), simulando una explicación científica interactiva.

---

## 3. Arquitectura del Pipeline Local

El pipeline se ejecuta secuencialmente en tu máquina local dividiéndose en 4 etapas automatizadas por scripts:

```
[ Idea/Tema ] ➔ (1. Guion e IA Agent) ➔ (2. ElevenLabs API & Timestamping) ➔ (3. Headless Browser + Three.js Canvas) ➔ (4. FFmpeg Compilación) ➔ [ Video .mp4 ]
```

### Fase 1: Generación de Guion y Estructura (Python / Node.js)
El Agente de IA procesa el tema original y devuelve un objeto JSON estructurado con la siguiente firma exacta:
```json
{
  "meta": {
    "topic": "Por qué se afloja una tuerca",
    "style": "Datos Neon / Low Poly"
  },
  "script": [
    {
      "scene_id": 1,
      "text": "Conduces hasta casa, aparcas, y no recuerdas nada.",
      "visuals": { "model": "car_red", "animation": "drive_loop", "light_intensity": 1.5 }
    }
  ]
}
```

### Fase 2: Audio y Sincronización de Subtítulos (ElevenLabs)
El texto completo se envía a la API de **ElevenLabs** habilitando la opción de **marcas de tiempo por alineación fonética (Timestamping / Alignment Data)**. 
* **Salida de Audio:** Un archivo `voz.mp3`.
* **Salida de Datos:** Un array de objetos JSON con cada palabra y sus milisegundos de inicio y fin exactos:
```json
[
  { "word": "Conduces", "start": 0.00, "end": 0.45 },
  { "word": "hasta", "start": 0.46, "end": 0.72 },
  { "word": "casa,", "start": 0.73, "end": 1.10 }
]
```

### Fase 3: Escena 3D e Inyección en el Canvas (JavaScript / WebGL)
Un servidor web local levanta una página que renderiza el video de forma exacta.
* **Fondo:** Servido con un `<canvas id="threeCanvas">` acoplado a Three.js.
* **Modelado:** Carga de elementos assets locales (.gltf) previamente optimizados en un directorio `/assets/models/`.
* **Capa de Subtítulos:** Un contenedor HTML superior o un Canvas 2D secundario transparente sincronizado mediante un reloj interno de milisegundos (`requestAnimationFrame` o lectura forzada por cuadro).

### Fase 4: Captura y Encodificación de Video (FFmpeg)
Para producción masiva estable, la captura en tiempo real con `MediaRecorder` del navegador puede dropear frames. Se recomienda **renderizado deterministic frame-by-frame**:
1. El script de automatización congela el tiempo del motor Three.js a pasos fijos (ej. `1/30` o `1/60` segundos por frame).
2. Captura el contenido del canvas en crudo (`canvas.toDataURL('image/jpeg')` o lectura de WebGLBuffers).
3. Transmite las imágenes directamente al búfer de entrada de un proceso hijo de **FFmpeg** corriendo localmente en la terminal.
4. Comando base de compilación final:
```bash
ffmpeg -r 30 -f image2pipe -vcodec mjpeg -i - -i voz.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k output.mp4
```

---

## 4. Estructura del Repositorio Local

Diseño de carpetas idóneo para que tu IA de desarrollo (Claude Code/Codex) reconozca el contexto de inmediato:

```
├── .env                  # API Keys (ElevenLabs, OpenAI, Claude)
├── package.json          # Dependencias (Three.js, Puppeteer/Playwright, dotenv)
├── pipeline.js           # Orquestador maestro del flujo
├── src/
│   ├── ai_agent.js       # Conexión con LLM para guiones
│   ├── voice_service.js  # Interfaz con ElevenLabs (Audio + Timestamps)
│   ├── renderer/
│   │   ├── index.html    # Plantilla base del reproductor 9:16
│   │   ├── app.js        # Lógica de Three.js (Cámara isométrica, Luces, Animación)
│   │   ├── ui.js         # Sistema de subtítulos cinéticos palabra por palabra
│   └── compiler.js       # Manejo del proceso FFmpeg e inyección deterministic
└── assets/
    ├── models/           # Archivos .gltf/.glb low-poly (autos, tuercas, flechas)
    ├── fonts/            # Montserrat-Black.ttf / TheBoldFont.ttf
    └── sfx/              # Efectos de sonido (whoosh, thud, beep)
```

---

## 5. Instrucciones para la IA (System Prompt de Inicialización)
Pega este bloque de instrucciones exactas a tu IA de código para arrancar el proyecto:

> *"Actúa como un ingeniero experto en automatización de medios, gráficos 3D en la web y FFmpeg. Necesito inicializar un repositorio local basado en Node.js que replique la funcionalidad del backend de 'Proyecto Atom'. El sistema debe tomar una entrada de texto, llamar a un LLM para formatear un JSON de escenas, consumir la API de ElevenLabs para generar audio y timestamps de alineación, alimentar una escena isométrica de Three.js configurada en Flat Shading dentro de un Headless Browser, y compilar cuadro por cuadro un archivo MP4 vertical final usando FFmpeg. Comienza creando el archivo package.json, el archivo de configuración .env y el script base de Three.js con la cámara ortográfica y luces de alto contraste orientadas a la estética nocturna descrita."*
