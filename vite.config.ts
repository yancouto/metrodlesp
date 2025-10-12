import { defineConfig } from 'vite';

// Vite configuration for Metrodle SP
// - Serves index.html at project root
// - Uses src as module entry (index.html references /src/index.ts)
// - Outputs production build to ./build to avoid clashing with tsc's ./dist used by tests
export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'build',
    sourcemap: true,
    emptyOutDir: true,
  },
});
