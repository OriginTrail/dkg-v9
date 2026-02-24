import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  server: {
    port: 4321,
    open: '/demo/index.html',
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
  },
  optimizeDeps: {
    exclude: ['oxigraph'],
  },
});
