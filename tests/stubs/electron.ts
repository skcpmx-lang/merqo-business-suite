/**
 * Minimal Electron stub for Node-based tests.
 *
 * Tests exercise the real enforcement path (dispatchIpc) directly, so the
 * ipcMain bridge itself is a no-op here.
 */
export const ipcMain = {
  handle: (_channel: string, _listener: (...args: unknown[]) => unknown): void => {}
};
