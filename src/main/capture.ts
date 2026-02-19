/**
 * Frame capture from offscreen BrowserWindow paint events.
 *
 * Captures raw BGRA buffers at target frame rate.
 * No PNG encoding — direct uncompressed pixel data.
 *
 * Each 1920x1080 frame = 8,294,400 bytes (1920 * 1080 * 4).
 *
 * Architecture: Producer-Consumer with decoupled timing.
 *
 * PRODUCER (paint callback):
 *   Chromium fires paint events at up to 50fps (2x invalidation rate).
 *   The callback does ONLY a memcpy into a pre-allocated buffer (~2ms).
 *   No emission, no IPC, no heavy work — returns immediately so the
 *   compositor can start the next frame.
 *
 * CONSUMER (output timer):
 *   A fixed-rate setInterval fires at exactly target FPS (25fps = 40ms).
 *   Reads the latest captured frame and emits it to downstream outputs.
 *   The downstream work (alpha extraction, IPC sends to output windows)
 *   happens here, completely decoupled from the compositor.
 *
 * This ensures exactly 25fps output regardless of compositor timing,
 * with minimal latency (max 10ms between capture and output at 2x invalidation).
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
  private outputInterval: ReturnType<typeof setInterval> | null = null;
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

    // ── PRODUCER: Fast paint callback (~2ms) ──
    this.paintHandler = (_event, _dirty, image) => {
      // Frozen: don't update buffer, output timer re-emits lastFrame
      if (this.frozen) return;

      const size = image.getSize();
      const bitmap = image.getBitmap();

      if (!bitmap || bitmap.length === 0) {
        this.droppedFrames++;
        return;
      }

      // Pre-allocated buffer: avoids 200MB/s GC pressure from Buffer.from()
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

      // Thumbnail from paint event NativeImage (every Nth frame, ~0.5ms)
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

    // ── CONSUMER: Fixed-rate output timer at target FPS ──
    // Reads the latest captured frame and emits it downstream.
    // Downstream work (alpha extraction, IPC to output windows) runs here,
    // completely decoupled from the compositor's paint events.
    // setInterval(40ms) delivers exactly 25fps as long as the emit callback
    // completes within 40ms (alpha extraction + IPC ≈ 12ms, well within budget).
    const frameMs = Math.round(1000 / this.targetFps);
    this.outputInterval = setInterval(() => {
      if (this.lastFrame) {
        this.frameCount++;
        this.statsFrameCount++;
        this.emit('frame', this.lastFrame);
      }
    }, frameMs);

    // ── Invalidation at 2x target FPS ──
    // Forces the compositor to repaint for static content.
    // At 2x rate, the latest frame is at most 10ms stale when the
    // output timer reads it (vs 40ms at 1x rate).
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

    if (this.outputInterval) {
      clearInterval(this.outputInterval);
      this.outputInterval = null;
    }
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
