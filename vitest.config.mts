import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.join(root, 'src/shared'),
      // Node tests import the handler registry; the Electron bridge itself
      // is a no-op stub (enforcement is exercised via dispatchIpc directly).
      electron: path.join(root, 'tests/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks'
  }
});
