/**
 * NDI Output via grandiose.
 *
 * Sends BGRA frames with alpha channel preserved natively.
 * NDI supports alpha — receivers (vMix, TriCaster, OBS) can use it directly.
 * No separate key+fill needed unlike SDI.
 *
 * grandiose is an optional dependency — gracefully degrades if not installed.
 */

import type { OutputDriver, Size } from './manager';
import { EventEmitter } from 'events';

interface NdiConfig {
  enabled: boolean;
  senderName: string;
}

export class NdiOutput extends EventEmitter implements OutputDriver {
  readonly name = 'ndi';

  private grandiose: any = null;
  private sender: any = null;
  private initialized = false;
  private frameRateN = 25000;
  private frameRateD = 1000;

  async init(config: NdiConfig): Promise<void> {
    if (!config.enabled) return;

    // Try to load grandiose (optional dependency)
    try {
      this.grandiose = require('grandiose');
    } catch (err) {
      console.warn(
        '[NDI] grandiose not available. NDI Runtime may not be installed.',
        'NDI output disabled. Install NDI Runtime and rebuild grandiose.'
      );
      throw new Error('grandiose not available');
    }

    try {
      this.sender = await this.grandiose.send({
        name: config.senderName,
        clockVideo: true,
      });

      this.initialized = true;
      console.log(`[NDI] Sender initialized: "${config.senderName}"`);
      this.emit('ready');
    } catch (err) {
      console.error('[NDI] Failed to initialize sender:', err);
      this.destroy();
      throw err;
    }
  }

  /** Set frame rate for NDI metadata */
  setFrameRate(fps: number): void {
    this.frameRateN = fps * 1000;
    this.frameRateD = 1000;
  }

  /** Push BGRA frame with alpha preserved */
  pushFrame(bgra: Buffer, size: Size): void {
    if (!this.initialized || !this.sender) return;

    try {
      this.sender.video({
        xres: size.width,
        yres: size.height,
        fourCC: this.grandiose.FOURCC_BGRA,
        frameRateN: this.frameRateN,
        frameRateD: this.frameRateD,
        lineStrideBytes: size.width * 4,
        data: bgra,
      });
    } catch (err) {
      this.emit('error', err);
    }
  }

  /** NDI natively supports alpha — no separate key frame needed */
  // pushKeyFrame intentionally not implemented

  /** Find NDI sources on the network */
  static async findSources(timeout: number = 5000): Promise<unknown[]> {
    try {
      const grandiose = require('grandiose');
      const finder = await grandiose.find({ showLocalSources: true });
      await new Promise((resolve) => setTimeout(resolve, timeout));
      const sources = finder.sources();
      finder.destroy();
      return sources;
    } catch {
      return [];
    }
  }

  destroy(): void {
    if (this.sender) {
      try {
        this.sender.destroy();
      } catch {
        // ignore
      }
      this.sender = null;
    }
    this.initialized = false;
    this.removeAllListeners();
  }
}
