/**
 * Window Output — fullscreen template rendering on selected monitors.
 *
 * RGB window renders the template DIRECTLY (like PVW/PGM offscreen windows).
 * No capture→IPC pipeline — native GPU-accelerated rendering at display
 * refresh rate (60fps+). Engine commands are mirrored via executeJavaScript.
 *
 * Alpha window still uses IPC for alpha-as-luma frames (extracted by
 * OutputManager from the capture pipeline). Only needed for broadcast
 * monitoring — not required for standard output.
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import type { OutputDriver, Size } from './manager';
import type { TemplatePayload } from '../engine';

export class WindowOutput implements OutputDriver {
  readonly name = 'window';

  private rgbWindow: BrowserWindow | null = null;
  private alphaWindow: BrowserWindow | null = null;
  private rgbReady = false;
  private alphaReady = false;

  /** Only extract alpha when alpha window is actually open */
  get needsKeyFrame(): boolean {
    return this.alphaReady && this.alphaWindow !== null && !this.alphaWindow.isDestroyed();
  }

  // ── RGB Output: Direct Template Rendering ──

  /** Open RGB output window that renders templates directly */
  openRgb(monitorIndex: number = -1): Promise<void> {
    if (this.rgbWindow && !this.rgbWindow.isDestroyed()) {
      this.rgbWindow.focus();
      return Promise.resolve();
    }

    const displays = screen.getAllDisplays();
    const display = monitorIndex >= 0 && monitorIndex < displays.length
      ? displays[monitorIndex]
      : displays[0];

    return new Promise((resolve) => {
      this.rgbWindow = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        fullscreen: true,
        frame: false,
        title: 'Veles RGB Output',
        backgroundColor: '#000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          // No preload needed — we use executeJavaScript for commands
        },
      });

      // Load the same template host page used by PVW/PGM
      if (process.env.ELECTRON_RENDERER_URL) {
        this.rgbWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/template/index.html`);
      } else {
        this.rgbWindow.loadFile(path.join(__dirname, '../renderer/template/index.html'));
      }

      this.rgbWindow.webContents.on('did-finish-load', () => {
        this.rgbReady = true;
        resolve();
      });

      this.rgbWindow.on('closed', () => {
        this.rgbWindow = null;
        this.rgbReady = false;
      });
    });
  }

  /** Load a template into the RGB output window (mirrors engine.load) */
  async loadTemplate(payload: TemplatePayload): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(
      `window.__loadTemplate(${JSON.stringify(payload)})`
    );
  }

  /** Play animation on the RGB output window (mirrors engine.take) */
  async rgbPlay(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__play()`);
  }

  /** Stop animation on the RGB output window */
  async rgbStop(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__stop()`);
  }

  /** Clear the RGB output window (mirrors engine.clear) */
  async rgbClear(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__clear()`);
  }

  /** Update fields on the RGB output window (mirrors engine.updatePgm) */
  async rgbUpdateFields(variables: Record<string, string>): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(
      `window.__updateFields(${JSON.stringify(variables)})`
    );
  }

  /** Advance multi-step graphics on RGB output (mirrors engine.next) */
  async rgbNext(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__next()`);
  }

  // ── Alpha Output: IPC-based (for broadcast monitoring) ──

  /** Open Alpha output window on specified monitor (uses IPC frame delivery) */
  openAlpha(monitorIndex: number = -1): void {
    if (this.alphaWindow && !this.alphaWindow.isDestroyed()) {
      this.alphaWindow.focus();
      return;
    }

    const displays = screen.getAllDisplays();
    const display = monitorIndex >= 0 && monitorIndex < displays.length
      ? displays[monitorIndex]
      : displays[0];

    this.alphaWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: true,
      frame: false,
      title: 'Veles Alpha Output',
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../preload/output.js'),
      },
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      this.alphaWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/output/alpha.html`);
    } else {
      this.alphaWindow.loadFile(path.join(__dirname, '../renderer/output/alpha.html'));
    }

    this.alphaWindow.webContents.on('did-finish-load', () => {
      this.alphaReady = true;
    });

    this.alphaWindow.on('closed', () => {
      this.alphaWindow = null;
      this.alphaReady = false;
    });
  }

  closeRgb(): void {
    if (this.rgbWindow && !this.rgbWindow.isDestroyed()) {
      this.rgbWindow.close();
    }
    this.rgbWindow = null;
    this.rgbReady = false;
  }

  closeAlpha(): void {
    if (this.alphaWindow && !this.alphaWindow.isDestroyed()) {
      this.alphaWindow.close();
    }
    this.alphaWindow = null;
    this.alphaReady = false;
  }

  isRgbOpen(): boolean {
    return this.rgbWindow !== null && !this.rgbWindow.isDestroyed();
  }

  isAlphaOpen(): boolean {
    return this.alphaWindow !== null && !this.alphaWindow.isDestroyed();
  }

  /** No-op: RGB renders directly, doesn't need captured frames */
  pushFrame(_bgra: Buffer, _size: Size): void {
    // RGB window renders templates natively — no IPC needed
  }

  /** Push alpha-as-luma key frame to Alpha window via IPC */
  pushKeyFrame(key: Buffer, size: Size): void {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;

    this.alphaWindow.webContents.send('output:frame', {
      buffer: key.buffer,
      width: size.width,
      height: size.height,
    });
  }

  destroy(): void {
    this.closeRgb();
    this.closeAlpha();
  }
}
