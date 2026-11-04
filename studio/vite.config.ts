import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Studio build only: the companion serves the built assets on loopback with
 * the session token injected into index.html. No dev server, no CORS.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/studio', import.meta.url)),
    emptyOutDir: true,
    target: 'es2023',
  },
});
