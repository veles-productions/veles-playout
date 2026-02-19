/**
 * Window Output — fullscreen template rendering on selected monitors.
 *
 * Both RGB and Alpha windows render templates DIRECTLY (like PVW/PGM
 * offscreen windows). No capture→IPC pipeline — native GPU-accelerated
 * rendering at display refresh rate (60fps+). Engine commands are
 * mirrored via executeJavaScript.
 *
 * Alpha window shows the same template on a black background for key
 * monitoring. True alpha-as-luma extraction is only needed for SDI
 * downstream keyers (handled by OutputManager + SdiOutput).
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

  /** Window outputs render directly — no alpha extraction needed.
   *  Only SDI output needs key frames from the capture pipeline. */
  get needsKeyFrame(): boolean {
    return false;
  }

  // ── Shared: Open a direct-rendering output window ──

  private openOutputWindow(
    title: string,
    monitorIndex: number,
  ): Promise<BrowserWindow> {
    const displays = screen.getAllDisplays();
    const display = monitorIndex >= 0 && monitorIndex < displays.length
      ? displays[monitorIndex]
      : displays[0];

    return new Promise((resolve) => {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        fullscreen: true,
        frame: false,
        title,
        backgroundColor: '#000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      // Load the same template host page used by PVW/PGM
      if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/template/index.html`);
      } else {
        win.loadFile(path.join(__dirname, '../renderer/template/index.html'));
      }

      win.webContents.on('did-finish-load', () => resolve(win));
    });
  }

  // ── RGB Output ──

  /** Open RGB output window that renders templates directly */
  async openRgb(monitorIndex: number = -1): Promise<void> {
    if (this.rgbWindow && !this.rgbWindow.isDestroyed()) {
      this.rgbWindow.focus();
      return;
    }

    this.rgbWindow = await this.openOutputWindow('Veles RGB Output', monitorIndex);
    this.rgbReady = true;

    this.rgbWindow.on('closed', () => {
      this.rgbWindow = null;
      this.rgbReady = false;
    });
  }

  /** Load a template into the RGB output window */
  async loadTemplate(payload: TemplatePayload): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(
      `window.__loadTemplate(${JSON.stringify(payload)})`
    );
  }

  /** Play animation on the RGB output window */
  async rgbPlay(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__play()`);
  }

  /** Stop animation on the RGB output window */
  async rgbStop(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__stop()`);
  }

  /** Clear the RGB output window */
  async rgbClear(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__clear()`);
  }

  /** Update fields on the RGB output window */
  async rgbUpdateFields(variables: Record<string, string>): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(
      `window.__updateFields(${JSON.stringify(variables)})`
    );
  }

  /** Advance multi-step graphics on RGB output */
  async rgbNext(): Promise<void> {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;
    await this.rgbWindow.webContents.executeJavaScript(`window.__next()`);
  }

  // ── Alpha Output: Direct Template Rendering ──

  /** Open Alpha output window on specified monitor (direct rendering) */
  async openAlpha(monitorIndex: number = -1): Promise<void> {
    if (this.alphaWindow && !this.alphaWindow.isDestroyed()) {
      this.alphaWindow.focus();
      return;
    }

    this.alphaWindow = await this.openOutputWindow('Veles Alpha Output', monitorIndex);
    this.alphaReady = true;

    this.alphaWindow.on('closed', () => {
      this.alphaWindow = null;
      this.alphaReady = false;
    });
  }

  /** Load a template into the Alpha output window */
  async alphaLoadTemplate(payload: TemplatePayload): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(
      `window.__loadTemplate(${JSON.stringify(payload)})`
    );
  }

  /** Play animation on the Alpha output window */
  async alphaPlay(): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(`window.__play()`);
  }

  /** Stop animation on the Alpha output window */
  async alphaStop(): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(`window.__stop()`);
  }

  /** Clear the Alpha output window */
  async alphaClear(): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(`window.__clear()`);
  }

  /** Update fields on the Alpha output window */
  async alphaUpdateFields(variables: Record<string, string>): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(
      `window.__updateFields(${JSON.stringify(variables)})`
    );
  }

  /** Advance multi-step graphics on Alpha output */
  async alphaNext(): Promise<void> {
    if (!this.alphaReady || !this.alphaWindow || this.alphaWindow.isDestroyed()) return;
    await this.alphaWindow.webContents.executeJavaScript(`window.__next()`);
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

  /** No-op: Both windows render directly, no captured frames needed */
  pushFrame(_bgra: Buffer, _size: Size): void {
    // Output windows render templates natively — no IPC needed
  }

  /** No-op: Alpha window renders directly now */
  pushKeyFrame(_key: Buffer, _size: Size): void {
    // Alpha window renders templates natively — no IPC needed
  }

  destroy(): void {
    this.closeRgb();
    this.closeAlpha();
  }
}
