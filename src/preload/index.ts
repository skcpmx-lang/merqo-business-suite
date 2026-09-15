// MERQO preload — typed IPC bridge (skeleton, expanded in later phases).
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('merqo', {
  version: '1.0.0'
});
