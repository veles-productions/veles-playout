/**
 * SDI Output via Blackmagic DeckLink (macadam).
 *
 * Outputs fill (BGRA) and optionally key (alpha as luma BGRA) on separate sub-devices.
 * DeckLink Duo/Quad shares hardware clock across sub-devices for genlock.
 *
 * Uses displayFrame() for synchronous real-time frame push — each frame is
 * displayed at the next hardware opportunity. No scheduler timeline or
 * pre-roll needed.
 *
 * macadam is an optional dependency — gracefully degrades if not installed.
 */

import type { OutputDriver, Size } from './manager';
import { EventEmitter } from 'events';

interface SdiConfig {
  enabled: boolean;
  fillDevice: number;
  keyDevice: number;
  displayMode: string;
}

// Display mode mappings
const DISPLAY_MODES: Record<string, string> = {
  'HD1080i50': 'bmdModeHD1080i50',
  'HD1080i5994': 'bmdModeHD1080i5994',
  'HD1080p25': 'bmdModeHD1080p25',
  'HD1080p2997': 'bmdModeHD1080p2997',
  'HD1080p50': 'bmdModeHD1080p50',
  'HD720p50': 'bmdModeHD720p50',
  'HD720p5994': 'bmdModeHD720p5994',
};

export class SdiOutput extends EventEmitter implements OutputDriver {
  readonly name = 'sdi';

  private macadam: any = null;
  private fillPlayback: any = null;
  private keyPlayback: any = null;
  private initialized = false;
  private hasKey = false;

  /** Whether this output needs key frames from the OutputManager */
  get needsKeyFrame(): boolean {
    return this.hasKey;
  }

  async init(config: SdiConfig): Promise<void> {
    if (!config.enabled) return;

    // Try to load macadam (optional dependency)
    try {
      this.macadam = require('macadam');
    } catch (err) {
      console.warn(
        '[SDI] macadam not available. DeckLink SDK may not be installed.',
        'SDI output disabled. Install DeckLink drivers and rebuild macadam.'
      );
      throw new Error('macadam not available');
    }

    const modeKey = DISPLAY_MODES[config.displayMode] || 'bmdModeHD1080i50';
    const displayMode = this.macadam[modeKey] || this.macadam.bmdModeHD1080i50;
    const pixelFormat = this.macadam.bmdFormat8BitBGRA;

    // Initialize fill output (required)
    try {
      this.fillPlayback = await this.macadam.playback({
        deviceIndex: config.fillDevice,
        displayMode,
        pixelFormat,
      });
      console.log(
        `[SDI] Fill output initialized on device ${config.fillDevice} (${config.displayMode})`,
        `— ${this.fillPlayback.width}x${this.fillPlayback.height}`,
        `bufferSize=${this.fillPlayback.bufferSize}`,
        `frameRate=${JSON.stringify(this.fillPlayback.frameRate)}`
      );
    } catch (err) {
      console.error('[SDI] Failed to initialize fill playback:', err);
      throw err;
    }

    // Initialize key output (optional — single-output cards like UltraStudio 4K Mini
    // may not have a second sub-device)
    if (config.keyDevice !== config.fillDevice) {
      try {
        this.keyPlayback = await this.macadam.playback({
          deviceIndex: config.keyDevice,
          displayMode,
          pixelFormat,
        });
        this.hasKey = true;
        console.log(`[SDI] Key output initialized on device ${config.keyDevice}`);
      } catch (err) {
        console.warn(
          `[SDI] Key output on device ${config.keyDevice} unavailable — running fill-only mode.`,
          'This is normal for single-output cards (e.g. UltraStudio 4K Mini).',
          err instanceof Error ? err.message : err
        );
        this.keyPlayback = null;
        this.hasKey = false;
      }
    }

    this.initialized = true;
    this.emit('ready');
  }

  /**
   * Push fill frame (BGRA) to DeckLink.
   * Uses displayFrame() for immediate synchronous display at the
   * next hardware opportunity.
   *
   * displayFrame() returns a Promise — we use .catch() instead of
   * try/catch to handle async rejections without blocking the frame loop.
   */
  pushFrame(bgra: Buffer, _size: Size): void {
    if (!this.initialized || !this.fillPlayback) return;

    this.fillPlayback.displayFrame(bgra).catch((err: Error) => {
      this.emit('error', err);
    });
  }

  /**
   * Push key frame (alpha as luma BGRA) to DeckLink.
   * Only called when hasKey is true (second SDI output available).
   */
  pushKeyFrame(key: Buffer, _size: Size): void {
    if (!this.initialized || !this.keyPlayback) return;

    this.keyPlayback.displayFrame(key).catch((err: Error) => {
      this.emit('error', err);
    });
  }

  /** Get available DeckLink devices */
  static async getDevices(): Promise<unknown[]> {
    try {
      const macadam = require('macadam');
      return await macadam.getDeviceInfo();
    } catch (err) {
      console.warn('[SDI] Device enumeration failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** Whether key output is active */
  hasKeyOutput(): boolean {
    return this.hasKey;
  }

  destroy(): void {
    if (this.fillPlayback) {
      try {
        this.fillPlayback.stop();
      } catch {
        // ignore
      }
      this.fillPlayback = null;
    }
    if (this.keyPlayback) {
      try {
        this.keyPlayback.stop();
      } catch {
        // ignore
      }
      this.keyPlayback = null;
    }
    this.initialized = false;
    this.hasKey = false;
    this.removeAllListeners();
  }
}
