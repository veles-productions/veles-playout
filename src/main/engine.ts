/**
 * PVW / PGM state machine.
 *
 * States: idle → pvw-loaded → on-air → frozen
 * Commands: load, take, clear, freeze, play, stop, update
 *
 * "TAKE" swaps BrowserWindow references (PVW → PGM) for zero-latency switching.
 */

import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';

export type EngineState = 'idle' | 'pvw-loaded' | 'on-air' | 'frozen';

export interface TemplatePayload {
  templateHtml: string;
  templateCss?: string;
  variables?: Record<string, string>;
  isOGraf?: boolean;
  ografManifest?: Record<string, unknown>;
  templateId?: string;
}

export interface EngineSnapshot {
  state: EngineState;
  pvwTemplate: TemplatePayload | null;
  pgmTemplate: TemplatePayload | null;
  pvwReady: boolean;
  pgmReady: boolean;
  mixing: boolean;
}

export class PlayoutEngine extends EventEmitter {
  private state: EngineState = 'idle';
  private pvwWindow: BrowserWindow | null = null;
  private pgmWindow: BrowserWindow | null = null;
  private pvwTemplate: TemplatePayload | null = null;
  private pgmTemplate: TemplatePayload | null = null;
  private pvwReady = false;
  private pgmReady = false;
  private mixing = false;
  private mixTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
  }

  /** Attach the offscreen BrowserWindows created by index.ts */
  setWindows(pvw: BrowserWindow, pgm: BrowserWindow): void {
    this.pvwWindow = pvw;
    this.pgmWindow = pgm;
  }

  /** Get the current PGM window (for frame capture) */
  getPgmWindow(): BrowserWindow | null {
    return this.pgmWindow;
  }

  /** Get the current PVW window (for thumbnail capture) */
  getPvwWindow(): BrowserWindow | null {
    return this.pvwWindow;
  }

  getState(): EngineState {
    return this.state;
  }

  getSnapshot(): EngineSnapshot {
    return {
      state: this.state,
      pvwTemplate: this.pvwTemplate,
      pgmTemplate: this.pgmTemplate,
      pvwReady: this.pvwReady,
      pgmReady: this.pgmReady,
      mixing: this.mixing,
    };
  }

  /** Load a template into the preview window */
  async load(payload: TemplatePayload): Promise<void> {
    this.pvwTemplate = payload;
    this.pvwReady = false;

    if (!this.pvwWindow) throw new Error('PVW window not attached');

    // Inject template HTML into the offscreen window
    await this.pvwWindow.webContents.executeJavaScript(
      `window.__loadTemplate(${JSON.stringify(payload)})`
    );

    // Auto-play in preview so the template is visible in the PVW thumbnail.
    // Messages are buffered until the iframe loads, so this is safe to call
    // immediately after __loadTemplate.
    await this.pvwWindow.webContents.executeJavaScript(`window.__play()`);

    this.pvwReady = true;
    this.setState('pvw-loaded');
  }

  /** Update variables on the preview window */
  async update(variables: Record<string, string>): Promise<void> {
    if (!this.pvwWindow) return;
    if (this.pvwTemplate) {
      this.pvwTemplate.variables = variables;
    }
    await this.pvwWindow.webContents.executeJavaScript(
      `window.__updateFields(${JSON.stringify(variables)})`
    );
    this.emitState();
  }

  /** Update variables on the live PGM window (hot update) */
  async updatePgm(variables: Record<string, string>): Promise<void> {
    if (!this.pgmWindow || this.state === 'idle') return;
    if (this.pgmTemplate) {
      this.pgmTemplate.variables = variables;
    }
    await this.pgmWindow.webContents.executeJavaScript(
      `window.__updateFields(${JSON.stringify(variables)})`
    );
    this.emitState();
  }

  /** Trigger play animation on preview */
  async play(): Promise<void> {
    if (!this.pvwWindow) return;
    await this.pvwWindow.webContents.executeJavaScript(`window.__play()`);
  }

  /** Trigger stop animation on preview */
  async stop(): Promise<void> {
    if (!this.pvwWindow) return;
    await this.pvwWindow.webContents.executeJavaScript(`window.__stop()`);
  }

  /**
   * TAKE — swap PVW → PGM.
   *
   * Instead of re-rendering, we swap the window references.
   * The old PGM becomes the new PVW (cleared and ready for next load).
   * This gives us zero-latency transitions.
   */
  async take(): Promise<void> {
    if (!this.pvwWindow || !this.pgmWindow) {
      throw new Error('Windows not attached');
    }
    if (!this.pvwReady || !this.pvwTemplate) {
      throw new Error('No template loaded in preview');
    }

    // Cancel any in-progress mix transition
    if (this.mixTimeout) {
      clearTimeout(this.mixTimeout);
      this.mixTimeout = null;
      this.mixing = false;
    }

    // Swap references
    const oldPgm = this.pgmWindow;
    const oldPgmTemplate = this.pgmTemplate;

    this.pgmWindow = this.pvwWindow;
    this.pgmTemplate = this.pvwTemplate;
    this.pgmReady = true;

    // The old PGM becomes the new PVW
    this.pvwWindow = oldPgm;
    this.pvwTemplate = oldPgmTemplate;
    this.pvwReady = false;

    // Trigger play on the new PGM
    await this.pgmWindow.webContents.executeJavaScript(`window.__play()`);

    // Clear the old PGM (now PVW) — stop its animation
    try {
      await this.pvwWindow.webContents.executeJavaScript(`window.__stop()`);
    } catch {
      // may not have stop function if it was idle
    }

    this.setState('on-air');
    this.emit('take');
  }

  /**
   * MIX TAKE — crossfade from PGM to PVW over durationMs.
   *
   * Emits 'mixStart' so the capture pipeline can set up dual-window
   * frame blending. After the duration, completes the window swap
   * and emits 'take' like a normal transition.
   */
  async takeMix(durationMs: number): Promise<void> {
    if (!this.pvwWindow || !this.pgmWindow) {
      throw new Error('Windows not attached');
    }
    if (!this.pvwReady || !this.pvwTemplate) {
      throw new Error('No template loaded in preview');
    }

    // Cancel any existing mix
    if (this.mixTimeout) {
      clearTimeout(this.mixTimeout);
      this.mixTimeout = null;
    }

    this.mixing = true;

    // Start play on PVW (incoming content starts animating)
    await this.pvwWindow.webContents.executeJavaScript(`window.__play()`);

    // Notify capture pipeline to set up dual capture + blending
    this.emit('mixStart', {
      duration: durationMs,
      outgoing: this.pgmWindow,
      incoming: this.pvwWindow,
    });
    this.emitState();

    // After duration, complete the swap
    return new Promise((resolve) => {
      this.mixTimeout = setTimeout(async () => {
        this.mixing = false;
        this.mixTimeout = null;

        // Swap references (same as normal take, but play already triggered)
        const oldPgm = this.pgmWindow!;
        const oldPgmTemplate = this.pgmTemplate;

        this.pgmWindow = this.pvwWindow;
        this.pgmTemplate = this.pvwTemplate;
        this.pgmReady = true;

        this.pvwWindow = oldPgm;
        this.pvwTemplate = oldPgmTemplate;
        this.pvwReady = false;

        // Stop animation on old PGM (now PVW)
        try {
          await this.pvwWindow!.webContents.executeJavaScript(`window.__stop()`);
        } catch {
          // may not have stop function if it was idle
        }

        this.setState('on-air');
        this.emit('take');
        resolve();
      }, durationMs);
    });
  }

  /** Clear program — go to black */
  async clear(): Promise<void> {
    // Cancel any in-progress mix transition
    if (this.mixTimeout) {
      clearTimeout(this.mixTimeout);
      this.mixTimeout = null;
      this.mixing = false;
      this.emit('mixCancel');
    }

    if (this.pgmWindow) {
      try {
        await this.pgmWindow.webContents.executeJavaScript(`window.__clear()`);
      } catch {
        // ignore
      }
    }
    this.pgmTemplate = null;
    this.pgmReady = false;
    this.setState('idle');
    this.emit('clear');
  }

  /** Advance multi-step graphics (e.g. OGraf next action) on PGM */
  async next(): Promise<void> {
    if (!this.pgmWindow || (this.state !== 'on-air' && this.state !== 'frozen')) return;
    await this.pgmWindow.webContents.executeJavaScript(`window.__next()`);
    this.emit('next');
  }

  /** Toggle freeze on PGM output */
  freeze(): void {
    if (this.state === 'on-air') {
      this.setState('frozen');
    } else if (this.state === 'frozen') {
      this.setState('on-air');
    }
    this.emit('freeze', this.state === 'frozen');
  }

  private setState(newState: EngineState): void {
    this.state = newState;
    this.emitState();
  }

  private emitState(): void {
    this.emit('state', this.getSnapshot());
  }
}
