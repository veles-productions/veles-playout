/**
 * Preload script for output windows (RGB + Alpha).
 * Exposes only the frame receiver via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('outputAPI', {
  onFrame: (callback: (data: { buffer: ArrayBuffer; width: number; height: number }) => void) => {
    const handler = (_event: unknown, data: { buffer: ArrayBuffer; width: number; height: number }) => callback(data);
    ipcRenderer.on('output:frame', handler);
    return () => ipcRenderer.removeListener('output:frame', handler);
  },
});
