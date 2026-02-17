/**
 * SDI Output via Blackmagic DeckLink (macadam).
 *
 * Outputs fill (BGRA) and key (alpha as luma BGRA) on separate sub-devices.
 * DeckLink Duo/Quad shares hardware clock across sub-devices for genlock.
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

    try {
      // Initialize fill output
      this.fillPlayback = await this.macadam.playback({
        deviceIndex: config.fillDevice,
        displayMode,
        pixelFormat,
      });
      console.log(`[SDI] Fill output initialized on device ${config.fillDevice}`);

      // Initialize key output
      this.keyPlayback = await this.macadam.playback({
        deviceIndex: config.keyDevice,
        displayMode,
        pixelFormat,
      });
      console.log(`[SDI] Key output initialized on device ${config.keyDevice}`);

      this.initialized = true;
      this.emit('ready');
    } catch (err) {
      console.error('[SDI] Failed to initialize DeckLink playback:', err);
      this.destroy();
      throw err;
    }
  }

  /** Push fill frame (BGRA) to DeckLink */
  pushFrame(bgra: Buffer, size: Size): void {
    if (!this.initialized || !this.fillPlayback) return;

    try {
      this.fillPlayback.schedule({ video: bgra });
    } catch (err) {
      this.emit('error', err);
    }
  }

  /** Push key frame (alpha as luma BGRA) to DeckLink */
  pushKeyFrame(key: Buffer, size: Size): void {
    if (!this.initialized || !this.keyPlayback) return;

    try {
      this.keyPlayback.schedule({ video: key });
    } catch (err) {
      this.emit('error', err);
    }
  }

  /** Get available DeckLink devices */
  static async getDevices(): Promise<unknown[]> {
    try {
      const macadam = require('macadam');
      return await macadam.getDeviceInfo();
    } catch {
      return [];
    }
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
    this.removeAllListeners();
  }
}
