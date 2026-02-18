/**
 * Veles Playout — Main Process Entry Point
 *
 * Creates offscreen BrowserWindows for PVW/PGM rendering,
 * registers the template:// custom protocol,
 * starts the WebSocket control server,
 * and manages the control window dashboard.
 */

import {
  app,
  BrowserWindow,
  protocol,
  net,
  screen,
  ipcMain,
  session,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { PlayoutEngine } from './engine';
import { FrameCapture } from './capture';
import { OutputManager } from './output/manager';
import { WindowOutput } from './output/window';
import { SdiOutput } from './output/sdi';
import { NdiOutput } from './output/ndi';
import { WebSocketServer } from './ws-server';
import { BlackBurst } from './output/blackburst';
import { getConfig, setConfig, config } from './config';
import { getCacheDir } from './template/paths';
import { buildTemplateDoc } from './template/builder';
import { buildOGrafHostDoc, isOGrafTemplate } from './template/ograf';
import { generateTestSignal } from './template/test-signals';
import { detectHardware } from './hardware';
import { AsRunLog } from './as-run-log';

// ── Globals ──

let controlWindow: BrowserWindow | null = null;
let pvwWindow: BrowserWindow | null = null;
let pgmWindow: BrowserWindow | null = null;
let engine: PlayoutEngine;
let pgmCapture: FrameCapture;
let outputManager: OutputManager;
let wsServer: WebSocketServer;
let blackBurst: BlackBurst;
let asRunLog: AsRunLog;
let pvwThumbnailTimer: ReturnType<typeof setInterval> | null = null;

// ── Protocol Registration ──
// Must be registered before app is ready

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'template',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// ── App Lifecycle ──

app.whenReady().then(async () => {
  // Register template:// protocol handler
  protocol.handle('template', (request) => {
    const url = request.url.replace('template://', '');
    const filePath = path.join(getCacheDir(), url);

    if (fs.existsSync(filePath)) {
      return net.fetch('file://' + filePath.replace(/\\/g, '/'));
    }

    // Fallback: return empty response
    return new Response('', { status: 404 });
  });

  // Create engine
  engine = new PlayoutEngine();

  // Create offscreen windows for PVW and PGM
  const { resolution, frameRate } = getConfig();

  pvwWindow = createOffscreenWindow(resolution.width, resolution.height, frameRate);
  pgmWindow = createOffscreenWindow(resolution.width, resolution.height, frameRate);

  engine.setWindows(pvwWindow, pgmWindow);

  // Set up frame capture on PGM
  pgmCapture = new FrameCapture(frameRate);
  pgmCapture.attach(pgmWindow);

  // Set up output manager
  outputManager = new OutputManager();

  // Initialize optional hardware outputs
  const cfg = getConfig();

  if (cfg.sdi.enabled) {
    try {
      const sdi = new SdiOutput();
      await sdi.init(cfg.sdi);
      outputManager.addOutput('sdi', sdi);
    } catch (err) {
      console.warn('[Playout] SDI output unavailable:', err);
    }
  }

  if (cfg.ndi.enabled) {
    try {
      const ndi = new NdiOutput();
      await ndi.init(cfg.ndi);
      outputManager.addOutput('ndi', ndi);
    } catch (err) {
      console.warn('[Playout] NDI output unavailable:', err);
    }
  }

  // Window output (always available)
  const windowOutput = new WindowOutput();
  outputManager.addOutput('window', windowOutput);

  // Start black burst to keep SDI outputs clean when idle
  blackBurst = new BlackBurst(resolution.width, resolution.height);
  blackBurst.start(frameRate, (buffer, size) => outputManager.pushFrame(buffer, size));

  // NOTE: Don't route pgmCapture frames at startup — only black burst
  // provides frames when idle. Capture frames are routed after first TAKE.

  // Engine state changes → broadcast to WS clients and control window
  engine.on('state', (snapshot) => {
    wsServer?.broadcastState(snapshot);
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('playout:state', snapshot);
    }
  });

  // Handle engine take/clear → swap capture target
  engine.on('take', () => {
    // First: set up new capture on the swapped PGM window
    // (attach before stopping black burst to avoid frame gap)
    pgmCapture.destroy();
    pgmCapture = new FrameCapture(frameRate);
    const newPgm = engine.getPgmWindow();
    if (newPgm) pgmCapture.attach(newPgm);

    pgmCapture.on('frame', (frame) => {
      outputManager.pushFrame(frame.buffer, { width: frame.width, height: frame.height });
    });
    pgmCapture.on('stats', (stats) => {
      wsServer?.broadcastStats(stats);
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('playout:frameStats', stats);
      }
    });

    // Then: stop black burst (capture is already providing frames)
    blackBurst.stop();
  });

  engine.on('clear', () => {
    // Restart black burst to keep SDI outputs clean
    blackBurst.start(frameRate, (buffer, size) => outputManager.pushFrame(buffer, size));
  });

  engine.on('freeze', (frozen: boolean) => {
    pgmCapture.setFrozen(frozen);
  });

  // Start WebSocket server
  const { wsPort, wsAuthToken } = getConfig();
  wsServer = new WebSocketServer(engine, wsPort);
  if (wsAuthToken) {
    wsServer.setAuthToken(wsAuthToken);
  }
  wsServer.start();

  // Forward client connection events to control window
  wsServer.on('clientChange', (info) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('playout:connection', info);
    }
  });

  // ── As-Run Log (broadcast compliance) ──
  asRunLog = new AsRunLog();
  wsServer.setAsRunLog(asRunLog);

  engine.on('take', () => {
    const snap = engine.getSnapshot();
    asRunLog.write({
      event: 'take',
      templateId: snap.pgmTemplate?.templateId,
      variables: snap.pgmTemplate?.variables,
    });
  });

  engine.on('clear', () => {
    asRunLog.write({ event: 'clear' });
  });

  engine.on('freeze', (frozen: boolean) => {
    asRunLog.write({ event: frozen ? 'freeze' : 'unfreeze' });
  });

  // ── Template Crash Recovery ──
  function setupCrashRecovery(win: BrowserWindow, label: string): void {
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[Playout] ${label} renderer crashed:`, details.reason);
      asRunLog.write({ event: 'crash-recovery', details: `${label} crash: ${details.reason}` });

      // Reload the template host page
      if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/template/index.html`);
      } else {
        win.loadFile(path.join(__dirname, '../renderer/template/index.html'));
      }

      // If PGM crashed, restart black burst to avoid black output
      if (label === 'PGM' && engine.getState() === 'on-air') {
        engine.clear().catch(() => {});
      }

      // Notify WS clients
      wsServer?.broadcastState(engine.getSnapshot());
    });

    win.webContents.on('unresponsive', () => {
      console.warn(`[Playout] ${label} renderer unresponsive`);
      asRunLog.write({ event: 'error', details: `${label} unresponsive` });
    });

    win.webContents.on('responsive', () => {
      console.log(`[Playout] ${label} renderer responsive again`);
    });
  }

  setupCrashRecovery(pvwWindow, 'PVW');
  setupCrashRecovery(pgmWindow, 'PGM');

  // ── PVW/PGM Thumbnail Capture for Control Window ──
  pvwThumbnailTimer = setInterval(async () => {
    if (!controlWindow || controlWindow.isDestroyed()) return;

    try {
      // PVW thumbnail
      if (pvwWindow && !pvwWindow.isDestroyed()) {
        // capturePage returns NativeImage, we get a small JPEG
        const pvwImg = await pvwWindow.webContents.capturePage();
        const pvwJpeg = pvwImg.resize({ width: 384 }).toJPEG(60);
        controlWindow.webContents.send('playout:pvwThumbnail', pvwJpeg.buffer);
      }

      // PGM thumbnail
      const pgmWin = engine.getPgmWindow();
      if (pgmWin && !pgmWin.isDestroyed()) {
        const pgmImg = await pgmWin.webContents.capturePage();
        const pgmJpeg = pgmImg.resize({ width: 384 }).toJPEG(60);
        controlWindow.webContents.send('playout:pgmThumbnail', pgmJpeg.buffer);
      }
    } catch {
      // Ignore capture errors (window closing, etc.)
    }
  }, 250); // 4 fps thumbnails

  // Register IPC handlers
  registerIpcHandlers();

  // Create control window
  createControlWindow();

  // Auto-update: check GitHub Releases for newer version
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('[Playout] Auto-update check failed:', err);
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open. On Windows/Linux, quit.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pvwThumbnailTimer) clearInterval(pvwThumbnailTimer);
  blackBurst?.stop();
  wsServer?.stop();
  pgmCapture?.destroy();
  outputManager?.destroy();
  asRunLog?.destroy();
});

// ── Window Creation ──

function createOffscreenWindow(width: number, height: number, frameRate: number): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
    transparent: true,
  });

  win.webContents.setFrameRate(frameRate);

  // Load the blank template host page
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/template/index.html`);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/template/index.html'));
  }

  return win;
}

function createControlWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js');

  controlWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Veles Playout',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev mode, load from Vite dev server; in prod, load built file
  if (process.env.ELECTRON_RENDERER_URL) {
    controlWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/control/index.html`);
  } else {
    controlWindow.loadFile(path.join(__dirname, '../renderer/control/index.html'));
  }

  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

// ── IPC Handlers ──

function registerIpcHandlers(): void {
  ipcMain.handle('playout:getState', () => {
    return engine.getSnapshot();
  });

  ipcMain.handle('playout:getConfig', () => {
    return getConfig();
  });

  ipcMain.handle('playout:setConfig', (_event, key: string, value: unknown) => {
    setConfig(key as keyof ReturnType<typeof getConfig>, value as never);
  });

  ipcMain.handle('playout:getDisplays', () => {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label,
      bounds: d.bounds,
      size: d.size,
      scaleFactor: d.scaleFactor,
    }));
  });

  ipcMain.handle('playout:getSdiDevices', async () => {
    try {
      const macadam = require('macadam');
      return await macadam.getDeviceInfo();
    } catch {
      return [];
    }
  });

  ipcMain.handle('playout:setOutput', async (_event, outputConfig: unknown) => {
    // Dynamically enable/disable outputs based on config
    const cfg = outputConfig as Record<string, unknown>;

    if (cfg.sdi !== undefined) {
      setConfig('sdi', cfg.sdi as typeof getConfig extends () => infer C ? C['sdi'] : never);
    }
    if (cfg.ndi !== undefined) {
      setConfig('ndi', cfg.ndi as typeof getConfig extends () => infer C ? C['ndi'] : never);
    }
    if (cfg.rgbMonitor !== undefined) {
      setConfig('rgbMonitor', cfg.rgbMonitor as number);
    }
    if (cfg.alphaMonitor !== undefined) {
      setConfig('alphaMonitor', cfg.alphaMonitor as number);
    }
  });

  ipcMain.handle('playout:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('playout:loadTestSignal', async (_event, pattern: string, alpha?: boolean) => {
    const html = generateTestSignal(pattern as any, alpha);
    await engine.load({
      templateHtml: html,
      templateCss: '',
      variables: {},
      templateId: `test-signal:${pattern}`,
    });
  });

  ipcMain.handle('playout:getHardware', () => {
    return detectHardware();
  });

  // Transport controls
  ipcMain.handle('playout:take', () => {
    return engine.take();
  });

  ipcMain.handle('playout:clear', () => {
    return engine.clear();
  });

  ipcMain.handle('playout:play', () => {
    return engine.play();
  });

  ipcMain.handle('playout:stop', () => {
    return engine.stop();
  });

  ipcMain.handle('playout:freeze', () => {
    return engine.freeze();
  });
}
