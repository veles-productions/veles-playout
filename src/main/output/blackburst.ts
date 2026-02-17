/**
 * Black Burst Generator — outputs solid black frames as reference signal.
 *
 * When no template is on air, this keeps a clean black signal going
 * to downstream equipment (switchers, routers, monitors).
 *
 * Pre-allocates a single all-zero buffer and reuses it for every frame.
 */

export class BlackBurst {
  private buffer: Buffer;
  private width: number;
  private height: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onFrame: ((buffer: Buffer, size: { width: number; height: number }) => void) | null = null;

  constructor(width: number = 1920, height: number = 1080) {
    this.width = width;
    this.height = height;

    // Pre-allocate all-zero BGRA buffer (black with zero alpha)
    this.buffer = Buffer.alloc(width * height * 4, 0);
  }

  /**
   * Start generating black frames at the given frame rate.
   * @param fps Target frame rate (e.g., 25 for PAL)
   * @param onFrame Callback for each frame
   */
  start(
    fps: number,
    onFrame: (buffer: Buffer, size: { width: number; height: number }) => void,
  ): void {
    this.onFrame = onFrame;
    const interval = Math.round(1000 / fps);

    this.intervalId = setInterval(() => {
      if (this.onFrame) {
        this.onFrame(this.buffer, { width: this.width, height: this.height });
      }
    }, interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.onFrame = null;
  }

  /** Get a single black frame (for initialization / one-shot use) */
  getFrame(): { buffer: Buffer; width: number; height: number } {
    return {
      buffer: this.buffer,
      width: this.width,
      height: this.height,
    };
  }
}
