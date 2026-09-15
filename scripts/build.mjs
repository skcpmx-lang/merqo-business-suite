// MERQO build script:
// 1. Bundle Electron main + preload with esbuild (CJS).
// 2. Build the renderer with Vite.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distElectron = path.join(root, 'dist-electron');

await rm(distElectron, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'warning',
  // Native / Electron modules must stay external (loaded from node_modules at runtime).
  external: ['electron', 'better-sqlite3']
};

await build({
  ...common,
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(distElectron, 'main/index.js')
});

await build({
  ...common,
  entryPoints: [path.join(root, 'src/preload/index.ts')],
  outfile: path.join(distElectron, 'preload/index.js')
});

console.log('[build] main + preload bundled.');
execSync('npx vite build', { cwd: root, stdio: 'inherit' });
console.log('[build] renderer built. Done.');
