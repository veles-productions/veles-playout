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
  Menu,
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
import { HealthServer } from './health';

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
let healthServer: HealthServer | null = null;
let pvwThumbnailTimer: ReturnType<typeof setInterval> | null = null;

// MIX transition state
let mixCapture: FrameCapture | null = null;
let mixOutgoingFrame: Buffer | null = null;
let mixBlendBuffer: Buffer | null = null;

/**
 * Blend two BGRA frame buffers with a crossfade factor (0 = all src, 1 = all dst).
 * Uses integer math (multiply + shift) for speed — processes ~8MB at 25fps.
 */
function blendFrames(src: Buffer, dst: Buffer, factor: number, out: Buffer): void {
  const f = (factor * 256) | 0;
  const inv = 256 - f;
  const len = out.length;
  // 4-way unroll (one BGRA pixel per iteration)
  let i = 0;
  for (; i < len - 3; i += 4) {
    out[i]     = (src[i]     * inv + dst[i]     * f) >> 8;
    out[i + 1] = (src[i + 1] * inv + dst[i + 1] * f) >> 8;
    out[i + 2] = (src[i + 2] * inv + dst[i + 2] * f) >> 8;
    out[i + 3] = (src[i + 3] * inv + dst[i + 3] * f) >> 8;
  }
  for (; i < len; i++) {
    out[i] = (src[i] * inv + dst[i] * f) >> 8;
  }
}

/** Clean up mix transition state */
function cleanupMix(): void {
  if (mixCapture) {
    mixCapture.destroy();
    mixCapture = null;
  }
  mixOutgoingFrame = null;
  mixBlendBuffer = null;
}

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

  // Remove default menu bar (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null);

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

  // ── MIX Transition — Dual-capture BGRA frame blending ──
  engine.on('mixStart', ({ duration, outgoing, incoming }: {
    duration: number;
    outgoing: BrowserWindow;
    incoming: BrowserWindow;
  }) => {
    // Pre-allocate blend buffer (reused every frame)
    const { width, height } = resolution;
    mixBlendBuffer = Buffer.allocUnsafe(width * height * 4);

    // Redirect existing pgmCapture to store outgoing frames (don't push to output).
    // Must copy because FrameCapture pre-allocates and reuses its buffer.
    pgmCapture.removeAllListeners('frame');
    pgmCapture.removeAllListeners('stats');
    pgmCapture.on('frame', (frame) => {
      if (!mixOutgoingFrame || mixOutgoingFrame.length !== frame.buffer.length) {
        mixOutgoingFrame = Buffer.allocUnsafe(frame.buffer.length);
      }
      frame.buffer.copy(mixOutgoingFrame);
    });

    // Set up capture on the incoming (PVW) window
    mixCapture = new FrameCapture(frameRate);
    mixCapture.attach(incoming);

    const mixStartTime = Date.now();

    mixCapture.on('frame', (frame) => {
      const elapsed = Date.now() - mixStartTime;
      const factor = Math.min(elapsed / duration, 1);

      if (mixOutgoingFrame && mixBlendBuffer) {
        blendFrames(mixOutgoingFrame, frame.buffer, factor, mixBlendBuffer);
        outputManager.pushFrame(mixBlendBuffer, { width: frame.width, height: frame.height });
      } else {
        // No outgoing frame yet — show incoming directly
        outputManager.pushFrame(frame.buffer, { width: frame.width, height: frame.height });
      }
    });

    mixCapture.on('stats', (stats) => {
      wsServer?.broadcastStats(stats);
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('playout:frameStats', stats);
      }
    });

    // Stop black burst during mix
    blackBurst.stop();
  });

  engine.on('mixCancel', () => {
    cleanupMix();
  });

  // Handle engine take/clear → swap capture target
  engine.on('take', () => {
    // Clean up any active mix transition
    cleanupMix();

    // Set up new capture on the swapped PGM window
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
    pgmCapture.on('thumbnail', (jpegBuffer: ArrayBuffer) => {
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('playout:pgmThumbnail', jpegBuffer);
      }
    });

    // Stop black burst (capture is already providing frames)
    blackBurst.stop();
  });

  engine.on('clear', () => {
    // Clean up any active mix transition
    cleanupMix();
    // Restart black burst to keep SDI outputs clean
    blackBurst.start(frameRate, (buffer, size) => outputManager.pushFrame(buffer, size));
  });

  engine.on('freeze', (frozen: boolean) => {
    pgmCapture.setFrozen(frozen);
  });

  // ── Window Output: Direct Template Rendering ──
  // Both RGB and Alpha output windows render templates natively (no IPC).
  // Mirror engine commands so output windows stay in sync with PGM.
  const getWinOutput = () => outputManager.getOutput('window') as WindowOutput | undefined;

  engine.on('load', (payload) => {
    const w = getWinOutput();
    if (!w) return;
    w.loadTemplate(payload).catch(() => {});
    w.alphaLoadTemplate(payload).catch(() => {});
  });

  engine.on('take', () => {
    const w = getWinOutput();
    if (!w) return;
    w.rgbPlay().catch(() => {});
    w.alphaPlay().catch(() => {});
  });

  engine.on('clear', () => {
    const w = getWinOutput();
    if (!w) return;
    w.rgbClear().catch(() => {});
    w.alphaClear().catch(() => {});
  });

  engine.on('updatePgm', (variables) => {
    const w = getWinOutput();
    if (!w) return;
    w.rgbUpdateFields(variables).catch(() => {});
    w.alphaUpdateFields(variables).catch(() => {});
  });

  engine.on('next', () => {
    const w = getWinOutput();
    if (!w) return;
    w.rgbNext().catch(() => {});
    w.alphaNext().catch(() => {});
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

  // ── HTTP Health Endpoint ──
  const { healthPort } = getConfig();
  if (healthPort > 0) {
    healthServer = new HealthServer(healthPort, {
      engine,
      capture: pgmCapture,
      wsServer,
    });
    healthServer.start();
  }

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

  // ── Thumbnail Pipeline (optimized) ──
  // PGM thumbnails: derived from paint event NativeImages in FrameCapture
  // (no capturePage() needed — avoids stealing compositor time from frame capture)
  pgmCapture.on('thumbnail', (jpegBuffer: ArrayBuffer) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('playout:pgmThumbnail', jpegBuffer);
    }
  });

  // PVW thumbnails: low-rate capturePage on non-critical preview window.
  // PVW is a different renderer process, so this doesn't compete with PGM capture.
  // 3fps is plenty for a dashboard preview thumbnail.
  pvwThumbnailTimer = setInterval(async () => {
    if (!controlWindow || controlWindow.isDestroyed()) return;
    try {
      const pvwWin = engine.getPvwWindow();
      if (pvwWin && !pvwWin.isDestroyed()) {
        const img = await pvwWin.webContents.capturePage();
        const jpeg = img.resize({ width: 384 }).toJPEG(70);
        controlWindow.webContents.send('playout:pvwThumbnail', jpeg.buffer);
      }
    } catch {
      // Ignore capture errors (window closing, etc.)
    }
  }, 333); // 3 fps PVW thumbnails (was 10fps capturePage on BOTH windows)

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
  healthServer?.stop();
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
    const winOutput = outputManager.getOutput('window') as WindowOutput | undefined;

    if (cfg.sdi !== undefined) {
      setConfig('sdi', cfg.sdi as typeof getConfig extends () => infer C ? C['sdi'] : never);
    }
    if (cfg.ndi !== undefined) {
      setConfig('ndi', cfg.ndi as typeof getConfig extends () => infer C ? C['ndi'] : never);
    }
    if (cfg.rgbMonitor !== undefined) {
      const monitor = cfg.rgbMonitor as number;
      setConfig('rgbMonitor', monitor);
      if (winOutput) {
        if (monitor >= 0) {
          // openRgb resolves when template host page is loaded
          winOutput.openRgb(monitor).then(async () => {
            // If already on-air, sync PGM template to the new window
            const snap = engine.getSnapshot();
            if ((snap.state === 'on-air' || snap.state === 'frozen') && snap.pgmTemplate) {
              await winOutput.loadTemplate(snap.pgmTemplate);
              await winOutput.rgbPlay();
            }
          }).catch(() => {});
        } else {
          winOutput.closeRgb();
        }
      }
    }
    if (cfg.alphaMonitor !== undefined) {
      const monitor = cfg.alphaMonitor as number;
      setConfig('alphaMonitor', monitor);
      if (winOutput) {
        if (monitor >= 0) {
          winOutput.openAlpha(monitor).then(async () => {
            // If already on-air, sync PGM template to the alpha window
            const snap = engine.getSnapshot();
            if ((snap.state === 'on-air' || snap.state === 'frozen') && snap.pgmTemplate) {
              await winOutput.alphaLoadTemplate(snap.pgmTemplate);
              await winOutput.alphaPlay();
            }
          }).catch(() => {});
        } else {
          winOutput.closeAlpha();
        }
      }
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

  ipcMain.handle('playout:next', () => {
    return engine.next();
  });
}
