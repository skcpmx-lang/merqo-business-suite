import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(root, 'src/shared'),
      '@renderer': path.join(root, 'src/renderer')
    }
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  },
  server: {
    port: 5199,
    strictPort: true
  }
});
