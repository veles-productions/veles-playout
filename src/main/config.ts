/**
 * Persistent configuration via electron-store.
 * Stores output settings, window positions, API endpoint, etc.
 */

import Store from 'electron-store';

export interface PlayoutConfig {
  /** veles-core API base URL for template fetching */
  apiUrl: string;
  /** WebSocket server port for studio connections */
  wsPort: number;
  /** Optional auth token for WS connections (query param ?token=) */
  wsAuthToken: string;
  /** HTTP health endpoint port (0 = disabled) */
  healthPort: number;
  /** Target frame rate (25 = PAL, 30 = NTSC) */
  frameRate: number;
  /** Output resolution */
  resolution: { width: number; height: number };
  /** RGB output window monitor index (-1 = disabled) */
  rgbMonitor: number;
  /** Alpha output window monitor index (-1 = disabled) */
  alphaMonitor: number;
  /** SDI output config */
  sdi: {
    enabled: boolean;
    fillDevice: number;
    keyDevice: number;
    displayMode: string;
  };
  /** NDI output config */
  ndi: {
    enabled: boolean;
    senderName: string;
  };
  /** Template cache max size in bytes (default 500MB) */
  cacheMaxBytes: number;
}

const defaults: PlayoutConfig = {
  apiUrl: 'http://localhost:8000',
  wsPort: 9900,
  wsAuthToken: '',
  healthPort: 9901,
  frameRate: 25,
  resolution: { width: 1920, height: 1080 },
  rgbMonitor: -1,
  alphaMonitor: -1,
  sdi: {
    enabled: false,
    fillDevice: 0,
    keyDevice: 1,
    displayMode: 'HD1080i50',
  },
  ndi: {
    enabled: false,
    senderName: 'Veles Playout',
  },
  cacheMaxBytes: 500 * 1024 * 1024,
};

export const config = new Store<PlayoutConfig>({
  name: 'playout-config',
  defaults,
});

export function getConfig(): PlayoutConfig {
  return config.store;
}

export function setConfig<K extends keyof PlayoutConfig>(
  key: K,
  value: PlayoutConfig[K],
): void {
  config.set(key, value);
}

export function resetConfig(): void {
  config.clear();
}
