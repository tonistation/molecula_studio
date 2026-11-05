import { dirname, resolve } from 'node:path';
import { renderProject } from '../src/companion/render/render-service.ts';

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) {
  console.error('Uso: npm run render -- <ruta/project.json> [salida.mp4]');
  process.exitCode = 1;
} else {
  const projectFile = resolve(args[0]!);
  let lastPercent = -1;
  try {
    const output = await renderProject({
      projectFile,
      workspaceRoot: dirname(dirname(projectFile)),
      outputPath: args[1],
      onProgress: ({ progress }) => {
        const percent = Math.floor(progress * 100);
        if (percent !== lastPercent) {
          process.stderr.write(`Exportando: ${percent}%\n`);
          lastPercent = percent;
        }
      },
    });
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo exportar el video.');
    process.exitCode = 1;
  }
}
