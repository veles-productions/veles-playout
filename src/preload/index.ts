/**
 * Preload script — contextBridge for IPC between renderer and main process.
 * Only exposes safe, typed methods to the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface PlayoutAPI {
  /** Get current engine state */
  getState(): Promise<unknown>;
  /** Get config values */
  getConfig(): Promise<unknown>;
  /** Update a config value */
  setConfig(key: string, value: unknown): Promise<void>;
  /** Get available monitors */
  getDisplays(): Promise<unknown[]>;
  /** Get DeckLink device info (if available) */
  getSdiDevices(): Promise<unknown[]>;
  /** Subscribe to state changes */
  onStateChange(callback: (state: unknown) => void): () => void;
  /** Subscribe to frame stats */
  onFrameStats(callback: (stats: unknown) => void): () => void;
  /** Subscribe to connection events */
  onConnection(callback: (info: unknown) => void): () => void;
  /** Subscribe to errors */
  onError(callback: (error: string) => void): () => void;
  /** Set output configuration */
  setOutput(config: unknown): Promise<void>;
  /** Get app version */
  getVersion(): Promise<string>;
  /** Load a built-in test signal pattern */
  loadTestSignal(pattern: string, alpha?: boolean): Promise<void>;
  /** Get hardware info (SDI/NDI/displays) */
  getHardware(): Promise<unknown>;
  /** Transport: send PVW to PGM (go on-air) */
  take(): Promise<void>;
  /** Transport: clear PGM (off-air) */
  clear(): Promise<void>;
  /** Transport: play/resume PGM animation */
  play(): Promise<void>;
  /** Transport: stop/pause PGM animation */
  stop(): Promise<void>;
  /** Transport: freeze PGM output */
  freeze(): Promise<void>;
}

contextBridge.exposeInMainWorld('playoutAPI', {
  getState: () => ipcRenderer.invoke('playout:getState'),
  getConfig: () => ipcRenderer.invoke('playout:getConfig'),
  setConfig: (key: string, value: unknown) =>
    ipcRenderer.invoke('playout:setConfig', key, value),
  getDisplays: () => ipcRenderer.invoke('playout:getDisplays'),
  getSdiDevices: () => ipcRenderer.invoke('playout:getSdiDevices'),
  setOutput: (config: unknown) => ipcRenderer.invoke('playout:setOutput', config),
  getVersion: () => ipcRenderer.invoke('playout:getVersion'),
  loadTestSignal: (pattern: string, alpha?: boolean) =>
    ipcRenderer.invoke('playout:loadTestSignal', pattern, alpha),
  getHardware: () => ipcRenderer.invoke('playout:getHardware'),
  take: () => ipcRenderer.invoke('playout:take'),
  clear: () => ipcRenderer.invoke('playout:clear'),
  play: () => ipcRenderer.invoke('playout:play'),
  stop: () => ipcRenderer.invoke('playout:stop'),
  freeze: () => ipcRenderer.invoke('playout:freeze'),

  onStateChange: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('playout:state', handler);
    return () => ipcRenderer.removeListener('playout:state', handler);
  },
  onFrameStats: (callback: (stats: unknown) => void) => {
    const handler = (_event: unknown, stats: unknown) => callback(stats);
    ipcRenderer.on('playout:frameStats', handler);
    return () => ipcRenderer.removeListener('playout:frameStats', handler);
  },
  onConnection: (callback: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown) => callback(info);
    ipcRenderer.on('playout:connection', handler);
    return () => ipcRenderer.removeListener('playout:connection', handler);
  },
  onError: (callback: (error: string) => void) => {
    const handler = (_event: unknown, error: string) => callback(error);
    ipcRenderer.on('playout:error', handler);
    return () => ipcRenderer.removeListener('playout:error', handler);
  },
} satisfies PlayoutAPI);
