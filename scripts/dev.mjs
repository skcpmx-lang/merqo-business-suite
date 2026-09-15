// MERQO dev script: Vite dev server + Electron (with HMR start URL).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const electron = require('electron'); // path to electron binary

const PORT = 5199;

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

vite.on('exit', (code) => process.exit(code ?? 0));

// Wait until the dev server responds.
const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Vite dev server did not start');
};

await waitForServer();

const env = { ...process.env, MERQO_DEV_URL: `http://localhost:${PORT}/` };
const electronProc = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env });
electronProc.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
