/**
 * Vitest global test setup for veles-playout.
 *
 * Mocks Electron APIs so main-process modules can be tested in Node.js.
 */

import { vi, beforeEach } from 'vitest'

// ── Mock electron module ──

vi.mock('electron', () => {
  const mockWebContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    setFrameRate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    capturePage: vi.fn().mockResolvedValue({
      resize: vi.fn().mockReturnValue({ toJPEG: vi.fn().mockReturnValue(Buffer.from([])) }),
    }),
    send: vi.fn(),
  }

  const BrowserWindow = vi.fn().mockImplementation(() => ({
    webContents: { ...mockWebContents },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    show: vi.fn(),
    close: vi.fn(),
  }))

  return {
    app: {
      getVersion: vi.fn().mockReturnValue('0.1.2-test'),
      getPath: vi.fn().mockReturnValue('/tmp/veles-playout-test'),
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
    },
    screen: {
      getAllDisplays: vi.fn().mockReturnValue([
        { id: 1, label: 'Test Display', size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      ]),
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: vi.fn(),
    },
    net: {
      fetch: vi.fn(),
    },
    session: {},
  }
})

// ── Mock electron-store ──

vi.mock('electron-store', () => {
  const stores = new Map<string, Record<string, unknown>>()

  return {
    default: vi.fn().mockImplementation((opts?: { name?: string; defaults?: Record<string, unknown> }) => {
      const name = opts?.name ?? 'default'
      if (!stores.has(name)) {
        stores.set(name, { ...(opts?.defaults ?? {}) })
      }
      const data = stores.get(name)!

      return {
        get store() { return { ...data } },
        get: (key: string) => data[key],
        set: (key: string, value: unknown) => { data[key] = value },
        delete: (key: string) => { delete data[key] },
        clear: () => {
          for (const k of Object.keys(data)) delete data[k]
          if (opts?.defaults) Object.assign(data, opts.defaults)
        },
        has: (key: string) => key in data,
      }
    }),
  }
})

// ── Mock electron-updater ──

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdatesAndNotify: vi.fn().mockResolvedValue(null),
  },
}))

// ── Mock uuid ──

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-uuid-${++uuidCounter}`),
}))

// ── Reset state between tests ──

beforeEach(() => {
  uuidCounter = 0
})
