/**
 * Frame capture from offscreen BrowserWindow paint events.
 *
 * Captures raw BGRA buffers at target frame rate.
 * No PNG encoding — direct uncompressed pixel data.
 *
 * Each 1920x1080 frame = 8,294,400 bytes (1920 * 1080 * 4).
 *
 * Performance notes:
 * - Thumbnails are generated directly from paint event NativeImages
 *   (avoids expensive capturePage() which steals compositor time)
 * - Frame buffer is pre-allocated to reduce GC pressure (~200MB/s saved)
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
        // When frozen, re-emit the last frame instead of capturing new ones
        this.emit('frame', this.lastFrame);
        return;
      }

      const size = image.getSize();
      const bitmap = image.getBitmap();

      if (!bitmap || bitmap.length === 0) {
        this.droppedFrames++;
        return;
      }

      // Pre-allocate frame buffer to reduce GC pressure.
      // At 25fps × 8MB = 200MB/s of allocations saved.
      const needsNewBuffer = !this.frameBuffer || this.frameBuffer.length !== bitmap.length;
      if (needsNewBuffer) {
        this.frameBuffer = Buffer.allocUnsafe(bitmap.length);
      }
      bitmap.copy(this.frameBuffer!);

      const frame: FrameData = {
        buffer: this.frameBuffer!,
        width: size.width,
        height: size.height,
        timestamp: Date.now(),
      };

      this.lastFrame = frame;
      this.frameCount++;
      this.statsFrameCount++;
      this.emit('frame', frame);

      // Generate thumbnail directly from paint event NativeImage.
      // This avoids capturePage() which triggers a separate compositor pass
      // and steals GPU time from the actual frame capture (~150ms/s saved).
      this.thumbnailCounter++;
      if (this.thumbnailCounter >= this.thumbnailEvery) {
        this.thumbnailCounter = 0;
        try {
          const thumb = image.resize({ width: 384 }).toJPEG(70);
          this.emit('thumbnail', thumb.buffer);
        } catch {
          // Ignore thumbnail errors (window closing, etc.)
        }
      }
    };

    window.webContents.on('paint', this.paintHandler as any);

    // Force continuous repaint at target FPS for broadcast output.
    // Electron offscreen rendering only fires paint events when content changes.
    // Static templates (animation completed) would produce 0 fps without this.
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
    // Remove paint listener from the attached window to prevent ghost handlers
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
