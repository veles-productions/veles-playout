/**
 * IPC bridge utilities for communication between main ↔ renderer processes.
 * Defines channel names and typed message shapes.
 */

// ── Channel Names ──

export const IPC_CHANNELS = {
  // Main → Renderer
  STATE_CHANGE: 'playout:state',
  FRAME_STATS: 'playout:frameStats',
  CONNECTION: 'playout:connection',
  ERROR: 'playout:error',

  // Renderer → Main (invoke/handle)
  GET_STATE: 'playout:getState',
  GET_CONFIG: 'playout:getConfig',
  SET_CONFIG: 'playout:setConfig',
  GET_DISPLAYS: 'playout:getDisplays',
  GET_SDI_DEVICES: 'playout:getSdiDevices',
  SET_OUTPUT: 'playout:setOutput',
  GET_VERSION: 'playout:getVersion',

  // Output window frames
  OUTPUT_FRAME: 'output:frame',
} as const;

// ── Message Types ──

export interface FrameMessage {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export interface StatsMessage {
  fps: number;
  dropped: number;
  totalFrames: number;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export interface ConnectionMessage {
  clientId: string;
  event: 'connected' | 'disconnected';
  remoteAddress?: string;
  totalClients: number;
}
