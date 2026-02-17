/**
 * Window Output — fullscreen RGB and Alpha windows on selected monitors.
 *
 * Replaces the browser popup approach from veles-studio.
 * Uses BrowserWindow + IPC to send raw BGRA buffers to canvas renderers.
 */

import { BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';
import type { OutputDriver, Size } from './manager';

export class WindowOutput implements OutputDriver {
  readonly name = 'window';

  private rgbWindow: BrowserWindow | null = null;
  private alphaWindow: BrowserWindow | null = null;
  private rgbReady = false;
  private alphaReady = false;

  /** Open RGB output window on specified monitor */
  openRgb(monitorIndex: number = -1): void {
    if (this.rgbWindow && !this.rgbWindow.isDestroyed()) {
      this.rgbWindow.focus();
      return;
    }

    const displays = screen.getAllDisplays();
    const display = monitorIndex >= 0 && monitorIndex < displays.length
      ? displays[monitorIndex]
      : displays[0];

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
        preload: path.join(__dirname, '../../preload/output.js'),
      },
    });

    const rgbHtml = path.join(__dirname, '../../renderer/output/rgb.html');
    this.rgbWindow.loadFile(rgbHtml);

    this.rgbWindow.webContents.on('did-finish-load', () => {
      this.rgbReady = true;
    });

    this.rgbWindow.on('closed', () => {
      this.rgbWindow = null;
      this.rgbReady = false;
    });
  }

  /** Open Alpha output window on specified monitor */
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
        preload: path.join(__dirname, '../../preload/output.js'),
      },
    });

    const alphaHtml = path.join(__dirname, '../../renderer/output/alpha.html');
    this.alphaWindow.loadFile(alphaHtml);

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

  /** Push fill frame (BGRA) to RGB window */
  pushFrame(bgra: Buffer, size: Size): void {
    if (!this.rgbReady || !this.rgbWindow || this.rgbWindow.isDestroyed()) return;

    // Send as shared buffer via IPC (zero-copy where possible)
    this.rgbWindow.webContents.send('output:frame', {
      buffer: bgra.buffer,
      width: size.width,
      height: size.height,
    });
  }

  /** Push key frame (alpha as luma) to Alpha window */
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
