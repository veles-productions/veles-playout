/**
 * Frame capture from offscreen BrowserWindow paint events.
 *
 * Captures raw BGRA buffers at target frame rate.
 * No PNG encoding — direct uncompressed pixel data.
 *
 * Each 1920x1080 frame = 8,294,400 bytes (1920 * 1080 * 4).
 *
 * Performance architecture:
 * - Paint callback does MINIMAL work (~2ms): just memcpy into pre-allocated buffer
 * - Heavy work (IPC sends to output windows) deferred to setImmediate
 * - This unblocks the compositor so it can start the next frame immediately
 * - Invalidation runs at 2x target FPS to compensate for timer jitter
 * - Thumbnails generated from paint event NativeImages (no capturePage overhead)
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
  private pendingEmit = false;
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
      // ── Frozen: re-emit last frame without updating buffer ──
      if (this.frozen) {
        if (this.lastFrame && !this.pendingEmit) {
          this.pendingEmit = true;
          setImmediate(() => {
            this.pendingEmit = false;
            if (this.lastFrame) this.emit('frame', this.lastFrame);
          });
        }
        return;
      }

      const size = image.getSize();
      const bitmap = image.getBitmap();

      if (!bitmap || bitmap.length === 0) {
        this.droppedFrames++;
        return;
      }

      // ── Fast path: copy bitmap into pre-allocated buffer (~1-2ms) ──
      // This is the ONLY heavy work in the paint callback.
      // Everything else is deferred to setImmediate to unblock the compositor.
      if (!this.frameBuffer || this.frameBuffer.length !== bitmap.length) {
        this.frameBuffer = Buffer.allocUnsafe(bitmap.length);
      }
      bitmap.copy(this.frameBuffer);

      this.lastFrame = {
        buffer: this.frameBuffer,
        width: size.width,
        height: size.height,
        timestamp: Date.now(),
      };

      this.frameCount++;
      this.statsFrameCount++;

      // ── Deferred frame emission ──
      // Paint events arrive in the Poll phase of Node's event loop.
      // setImmediate runs in the Check phase (same iteration, after Poll).
      // This means the compositor thread is unblocked as soon as the paint
      // callback returns (~2ms), and can start rendering the next frame.
      // The heavy downstream work (alpha extraction, IPC sends to output
      // windows) happens in the Check phase without delaying the compositor.
      if (!this.pendingEmit) {
        this.pendingEmit = true;
        setImmediate(() => {
          this.pendingEmit = false;
          if (this.lastFrame) {
            this.emit('frame', this.lastFrame);
          }
        });
      }

      // ── Thumbnail from paint event NativeImage ──
      // Much cheaper than capturePage() which triggers a full compositor pass.
      // resize(384) + toJPEG(70) takes ~0.5ms, runs at 5fps.
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

    // ── Invalidation at 2x target FPS ──
    // Electron offscreen rendering only fires paint events when content changes.
    // invalidate() forces the compositor to repaint. Running at 2x target rate
    // compensates for setInterval jitter on Windows (~4ms) and event loop
    // latency that could cause missed frames at exactly 1x rate.
    // The compositor respects setFrameRate() and won't exceed 25fps regardless.
    const invalidateMs = Math.round(1000 / (this.targetFps * 2));
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
