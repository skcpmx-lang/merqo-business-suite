/**
 * Native-module packaging guard (release audit, Windows validation round).
 *
 * The Windows build strategy relies on better-sqlite3 v13 shipping N-API
 * prebuilds in the npm package:
 *   - `prebuilds/win32-x64.node` must exist for the packaged app to load
 *   - it must be an N-API module (exports `napi_register_module_v1`) so the
 *     same binary works under Node (tests) and Electron (production) without
 *     a per-Electron-ABI rebuild
 *   - `electron-builder.yml` must keep `npmRebuild: false`, otherwise a
 *     clean Windows CI without build tools fails at packaging time
 * If an upstream better-sqlite3 release changes any of these, this test
 * fails BEFORE we ship a broken installer.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PRE = path.join(ROOT, 'node_modules/better-sqlite3/prebuilds');

describe('native prebuild packaging guard', () => {
  it('better-sqlite3 prebuilds exist for all shipped platforms (x64 + arm64)', () => {
    for (const p of [
      'linux-x64.node', 'linux-arm64.node', 'linuxmusl-x64.node',
      'win32-x64.node', 'win32-arm64.node',
      'darwin-x64.node', 'darwin-arm64.node'
    ]) {
      expect(existsSync(path.join(PRE, p)), `prebuilds/${p} must exist in the npm package`).toBe(true);
    }
  });

  it('win32-x64 prebuild is a PE binary that exports the N-API registration entry', () => {
    const file = path.join(PRE, 'win32-x64.node');
    const buf = readFileSync(file);
    // PE "MZ" magic
    expect(buf.subarray(0, 2).toString('latin1')).toBe('MZ');
    // N-API modules export napi_register_module_v1 (ABI-stable across Node/Electron)
    expect(buf.toString('latin1')).toContain('napi_register_module_v1');
  });

  it('electron-builder.yml disables npmRebuild (prebuilds make rebuild moot)', () => {
    const yml = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toMatch(/^npmRebuild:\s*false\s*$/m);
  });

  it('electron-builder.yml unpacks better-sqlite3 from asar (native modules cannot load from asar)', () => {
    const yml = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toContain('**/node_modules/better-sqlite3/**');
  });
});
