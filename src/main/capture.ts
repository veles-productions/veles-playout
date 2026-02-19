/**
 * Frame capture from offscreen BrowserWindow paint events.
 *
 * Captures raw BGRA buffers at target frame rate for SDI/NDI output.
 * No PNG encoding — direct uncompressed pixel data.
 *
 * Each 1920x1080 frame = 8,294,400 bytes (1920 * 1080 * 4).
 *
 * Note: Window output (RGB monitors) does NOT use this pipeline.
 * Output windows render templates directly for native 60fps display.
 * This capture pipeline is for SDI/NDI hardware and thumbnails only.
 */

import { BrowserWindow, NativeImage } from 'electron';
import { EventEmitter } from 'events';

export interface FrameData {
  /** Raw BGRA pixel buffer */
  buffer: Buffer;
  /** Frame dimensions */
  width: number;
  height: number;
  /** Timestamp when frame was captured */
  timestamp: number;
}

export interface CaptureStats {
  fps: number;
  dropped: number;
  totalFrames: number;
}

export class FrameCapture extends EventEmitter {
  private targetFps: number;
  private frameCount = 0;
  private droppedFrames = 0;
  private lastStatsTime = Date.now();
  private statsFrameCount = 0;
  private currentFps = 0;
  private frozen = false;
  private lastFrame: FrameData | null = null;
  private frameBuffer: Buffer | null = null;
  private thumbnailCounter = 0;
  private thumbnailEvery: number;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private invalidateInterval: ReturnType<typeof setInterval> | null = null;
  private attachedWindow: BrowserWindow | null = null;
  private paintHandler: ((_event: Event, _dirty: Electron.Rectangle, image: NativeImage) => void) | null = null;

  constructor(targetFps: number = 25, thumbnailFps: number = 5) {
    super();
    this.targetFps = targetFps;
    this.thumbnailEvery = Math.max(1, Math.round(targetFps / thumbnailFps));
  }

  /**
   * Attach to a BrowserWindow's offscreen paint events.
   * The window must have `webPreferences: { offscreen: true }`.
   */
  attach(window: BrowserWindow): void {
    this.attachedWindow = window;
    window.webContents.setFrameRate(this.targetFps);

    this.paintHandler = (_event, _dirty, image) => {
      if (this.frozen && this.lastFrame) {
        this.emit('frame', this.lastFrame);
        return;
      }

      const size = image.getSize();
      const bitmap = image.getBitmap();

      if (!bitmap || bitmap.length === 0) {
        this.droppedFrames++;
        return;
      }

      // Pre-allocated buffer to reduce GC pressure (~200MB/s saved)
      if (!this.frameBuffer || this.frameBuffer.length !== bitmap.length) {
        this.frameBuffer = Buffer.allocUnsafe(bitmap.length);
      }
      bitmap.copy(this.frameBuffer);

      const frame: FrameData = {
        buffer: this.frameBuffer,
        width: size.width,
        height: size.height,
        timestamp: Date.now(),
      };

      this.lastFrame = frame;
      this.frameCount++;
      this.statsFrameCount++;
      this.emit('frame', frame);

      // Thumbnail from paint event NativeImage (every Nth frame)
      this.thumbnailCounter++;
      if (this.thumbnailCounter >= this.thumbnailEvery) {
        this.thumbnailCounter = 0;
        try {
          const thumb = image.resize({ width: 384 }).toJPEG(70);
          this.emit('thumbnail', thumb.buffer);
        } catch {
          // Ignore thumbnail errors
        }
      }
    };

    window.webContents.on('paint', this.paintHandler as any);

    // Force continuous repaint for static templates
    const invalidateMs = Math.round(1000 / this.targetFps);
    this.invalidateInterval = setInterval(() => {
      if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
        this.attachedWindow.webContents.invalidate();
      }
    }, invalidateMs);

    // Stats reporting every 1 second
    this.statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastStatsTime) / 1000;
      this.currentFps = Math.round(this.statsFrameCount / elapsed);
      this.statsFrameCount = 0;
      this.lastStatsTime = now;

      this.emit('stats', this.getStats());
    }, 1000);
  }

  /** Freeze/unfreeze frame output */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  /** Get last captured frame (useful for snapshots) */
  getLastFrame(): FrameData | null {
    return this.lastFrame;
  }

  getStats(): CaptureStats {
    return {
      fps: this.currentFps,
      dropped: this.droppedFrames,
      totalFrames: this.frameCount,
    };
  }

  destroy(): void {
    if (this.attachedWindow && this.paintHandler && !this.attachedWindow.isDestroyed()) {
      this.attachedWindow.webContents.removeListener('paint', this.paintHandler as any);
    }
    this.attachedWindow = null;
    this.paintHandler = null;
    this.frameBuffer = null;

    if (this.invalidateInterval) {
      clearInterval(this.invalidateInterval);
      this.invalidateInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.removeAllListeners();
  }
}
