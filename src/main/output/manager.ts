/**
 * Output Manager — routes frames to all active outputs.
 *
 * Receives raw BGRA frames from FrameCapture, extracts alpha channel
 * as a separate luma key buffer, and distributes to:
 * - SDI (fill + key as separate signals)
 * - NDI (BGRA with alpha preserved natively)
 * - Window (RGB + Alpha as separate fullscreen windows)
 */

export interface Size {
  width: number;
  height: number;
}

export interface OutputDriver {
  readonly name: string;
  pushFrame(bgra: Buffer, size: Size): void;
  pushKeyFrame?(key: Buffer, size: Size): void;
  destroy(): void;
}

export class OutputManager {
  private outputs = new Map<string, OutputDriver>();
  private keyBuffer: Buffer | null = null;
  private errorCounts = new Map<string, number>();

  addOutput(id: string, output: OutputDriver): void {
    this.outputs.set(id, output);
  }

  removeOutput(id: string): void {
    const output = this.outputs.get(id);
    if (output) {
      output.destroy();
      this.outputs.delete(id);
    }
  }

  getOutput(id: string): OutputDriver | undefined {
    return this.outputs.get(id);
  }

  getActiveOutputs(): string[] {
    return Array.from(this.outputs.keys());
  }

  /**
   * Push a BGRA frame to all active outputs.
   * Extracts alpha channel as luma key for outputs that need it (SDI, window).
   */
  pushFrame(bgra: Buffer, size: Size): void {
    const pixelCount = size.width * size.height;

    // Extract alpha channel as luma key (only if any output needs it)
    let needsKey = false;
    for (const output of this.outputs.values()) {
      if (output.pushKeyFrame) {
        needsKey = true;
        break;
      }
    }

    if (needsKey) {
      // Reuse key buffer to avoid GC pressure (8MB/frame at 1080p)
      const keySize = pixelCount * 4;
      if (!this.keyBuffer || this.keyBuffer.length !== keySize) {
        this.keyBuffer = Buffer.alloc(keySize);
      }

      // Extract alpha byte from each pixel → grayscale BGRA key
      for (let i = 0; i < pixelCount; i++) {
        const alpha = bgra[i * 4 + 3];
        const offset = i * 4;
        this.keyBuffer[offset] = alpha;     // B
        this.keyBuffer[offset + 1] = alpha; // G
        this.keyBuffer[offset + 2] = alpha; // R
        this.keyBuffer[offset + 3] = 255;   // A (fully opaque)
      }
    }

    // Route to all outputs
    const toRemove: string[] = [];
    for (const [id, output] of this.outputs.entries()) {
      try {
        output.pushFrame(bgra, size);
        if (output.pushKeyFrame && this.keyBuffer) {
          output.pushKeyFrame(this.keyBuffer, size);
        }
      } catch (err) {
        const count = (this.errorCounts.get(id) ?? 0) + 1;
        this.errorCounts.set(id, count);
        if (count <= 3) {
          console.error(`[OutputManager] Error #${count} on ${output.name}:`, err);
        }
        if (count === 10) {
          console.error(`[OutputManager] Disabling ${output.name} after 10 errors`);
          toRemove.push(id);
        }
      }
    }
    // Remove failed outputs outside iteration
    for (const id of toRemove) {
      this.removeOutput(id);
      this.errorCounts.delete(id);
    }
  }

  destroy(): void {
    for (const output of this.outputs.values()) {
      try {
        output.destroy();
      } catch (err) {
        console.error(`[OutputManager] Error destroying ${output.name}:`, err);
      }
    }
    this.outputs.clear();
    this.keyBuffer = null;
  }
}
