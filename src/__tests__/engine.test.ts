/**
 * Engine state machine tests.
 *
 * Tests the PVW/PGM state machine: load, take, clear, freeze, mix transitions.
 * Mocks BrowserWindow + executeJavaScript.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { PlayoutEngine } from '../main/engine'
import type { TemplatePayload } from '../main/engine'

function createMockWindow() {
  const win = new (BrowserWindow as any)()
  // Ensure each mock window has its own webContents
  win.webContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    setFrameRate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  return win as unknown as BrowserWindow
}

const samplePayload: TemplatePayload = {
  templateHtml: '<div>Test</div>',
  templateCss: 'div { color: red; }',
  variables: { headline: 'Breaking News' },
  templateId: 'test-template-1',
}

describe('PlayoutEngine', () => {
  let engine: PlayoutEngine
  let pvwWindow: BrowserWindow
  let pgmWindow: BrowserWindow

  beforeEach(() => {
    engine = new PlayoutEngine()
    pvwWindow = createMockWindow()
    pgmWindow = createMockWindow()
    engine.setWindows(pvwWindow, pgmWindow)
  })

  // ── Initial state ──

  it('starts in idle state', () => {
    expect(engine.getState()).toBe('idle')
  })

  it('returns correct initial snapshot', () => {
    const snap = engine.getSnapshot()
    expect(snap).toEqual({
      state: 'idle',
      pvwTemplate: null,
      pgmTemplate: null,
      pvwReady: false,
      pgmReady: false,
      mixing: false,
    })
  })

  // ── Load ──

  it('transitions to pvw-loaded on load()', async () => {
    await engine.load(samplePayload)
    expect(engine.getState()).toBe('pvw-loaded')
  })

  it('calls executeJavaScript with __loadTemplate on load()', async () => {
    await engine.load(samplePayload)
    expect(pvwWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__loadTemplate')
    )
  })

  it('stores pvw template and sets pvwReady on load()', async () => {
    await engine.load(samplePayload)
    const snap = engine.getSnapshot()
    expect(snap.pvwTemplate).toEqual(samplePayload)
    expect(snap.pvwReady).toBe(true)
  })

  it('throws when loading without PVW window', async () => {
    engine.setWindows(null as any, pgmWindow)
    await expect(engine.load(samplePayload)).rejects.toThrow('PVW window not attached')
  })

  it('emits state event on load()', async () => {
    const handler = vi.fn()
    engine.on('state', handler)
    await engine.load(samplePayload)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ state: 'pvw-loaded' }))
  })

  // ── Take ──

  it('transitions to on-air on take()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    expect(engine.getState()).toBe('on-air')
  })

  it('swaps PVW/PGM window references on take()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    // After take, PGM should be what was PVW
    expect(engine.getPgmWindow()).toBe(pvwWindow)
    expect(engine.getPvwWindow()).toBe(pgmWindow)
  })

  it('calls __play on new PGM and __stop on old PGM', async () => {
    await engine.load(samplePayload)
    await engine.take()
    // __play on pvwWindow (now PGM)
    expect(pvwWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window.__play()')
    // __stop on pgmWindow (now PVW)
    expect(pgmWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window.__stop()')
  })

  it('emits take event', async () => {
    const handler = vi.fn()
    engine.on('take', handler)
    await engine.load(samplePayload)
    await engine.take()
    expect(handler).toHaveBeenCalled()
  })

  it('throws on take() without loaded template', async () => {
    await expect(engine.take()).rejects.toThrow('No template loaded in preview')
  })

  it('throws on take() without windows attached', async () => {
    engine.setWindows(null as any, null as any)
    await expect(engine.take()).rejects.toThrow('Windows not attached')
  })

  it('moves pgmTemplate to pgm slot on take()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    const snap = engine.getSnapshot()
    expect(snap.pgmTemplate).toEqual(samplePayload)
    expect(snap.pgmReady).toBe(true)
    expect(snap.pvwReady).toBe(false)
  })

  // ── Clear ──

  it('transitions to idle on clear()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    await engine.clear()
    expect(engine.getState()).toBe('idle')
  })

  it('calls __clear on PGM window', async () => {
    await engine.load(samplePayload)
    await engine.take()
    const pgm = engine.getPgmWindow()!
    await engine.clear()
    expect(pgm.webContents.executeJavaScript).toHaveBeenCalledWith('window.__clear()')
  })

  it('emits clear event', async () => {
    const handler = vi.fn()
    engine.on('clear', handler)
    await engine.load(samplePayload)
    await engine.take()
    await engine.clear()
    expect(handler).toHaveBeenCalled()
  })

  it('clears pgmTemplate on clear()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    await engine.clear()
    const snap = engine.getSnapshot()
    expect(snap.pgmTemplate).toBeNull()
    expect(snap.pgmReady).toBe(false)
  })

  // ── Freeze ──

  it('toggles between on-air and frozen on freeze()', async () => {
    await engine.load(samplePayload)
    await engine.take()
    expect(engine.getState()).toBe('on-air')

    engine.freeze()
    expect(engine.getState()).toBe('frozen')

    engine.freeze()
    expect(engine.getState()).toBe('on-air')
  })

  it('emits freeze event with frozen state', async () => {
    const handler = vi.fn()
    engine.on('freeze', handler)
    await engine.load(samplePayload)
    await engine.take()

    engine.freeze()
    expect(handler).toHaveBeenCalledWith(true)

    engine.freeze()
    expect(handler).toHaveBeenCalledWith(false)
  })

  it('does nothing on freeze() when idle', () => {
    engine.freeze()
    expect(engine.getState()).toBe('idle')
  })

  // ── Update ──

  it('updates PVW variables via __updateFields', async () => {
    await engine.load(samplePayload)
    const newVars = { headline: 'Updated' }
    await engine.update(newVars)
    expect(pvwWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__updateFields')
    )
    const snap = engine.getSnapshot()
    expect(snap.pvwTemplate?.variables).toEqual(newVars)
  })

  // ── updatePgm ──

  it('updatePgm() is no-op when idle', async () => {
    await engine.updatePgm({ headline: 'Test' })
    expect(pgmWindow.webContents.executeJavaScript).not.toHaveBeenCalledWith(
      expect.stringContaining('__updateFields')
    )
  })

  it('updatePgm() updates PGM variables when on-air', async () => {
    await engine.load(samplePayload)
    await engine.take()
    const pgm = engine.getPgmWindow()!
    const newVars = { headline: 'Live Update' }
    await engine.updatePgm(newVars)
    expect(pgm.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__updateFields')
    )
  })

  // ── Play / Stop ──

  it('play() calls __play on PVW window', async () => {
    await engine.load(samplePayload)
    await engine.play()
    expect(pvwWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window.__play()')
  })

  it('stop() calls __stop on PVW window', async () => {
    await engine.load(samplePayload)
    await engine.stop()
    expect(pvwWindow.webContents.executeJavaScript).toHaveBeenCalledWith('window.__stop()')
  })

  // ── MIX transition ──

  it('takeMix() sets mixing=true and emits mixStart', async () => {
    const handler = vi.fn()
    engine.on('mixStart', handler)

    await engine.load(samplePayload)
    // Don't await - it resolves after the timeout
    const mixPromise = engine.takeMix(100)

    // takeMix awaits play() first, so we need to wait a tick
    await vi.waitFor(() => {
      expect(engine.getSnapshot().mixing).toBe(true)
    })
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 100 })
    )

    await mixPromise
    expect(engine.getSnapshot().mixing).toBe(false)
    expect(engine.getState()).toBe('on-air')
  })

  it('takeMix() swaps windows after duration', async () => {
    await engine.load(samplePayload)
    await engine.takeMix(50)
    expect(engine.getPgmWindow()).toBe(pvwWindow)
    expect(engine.getPvwWindow()).toBe(pgmWindow)
  })

  it('takeMix() throws without loaded template', async () => {
    await expect(engine.takeMix(500)).rejects.toThrow('No template loaded in preview')
  })

  it('clear() during mix cancels the mix', async () => {
    const cancelHandler = vi.fn()
    engine.on('mixCancel', cancelHandler)

    await engine.load(samplePayload)
    engine.takeMix(5000) // Long mix, don't await

    // Wait for mix to start (after play() await resolves)
    await vi.waitFor(() => {
      expect(engine.getSnapshot().mixing).toBe(true)
    })

    // Clear during mix
    await engine.clear()
    expect(engine.getState()).toBe('idle')
    expect(engine.getSnapshot().mixing).toBe(false)
    expect(cancelHandler).toHaveBeenCalled()
  })

  it('take() during mix cancels the mix and hard cuts', async () => {
    await engine.load(samplePayload)
    engine.takeMix(5000) // Start a long mix, don't await

    // Wait for mix to start
    await vi.waitFor(() => {
      expect(engine.getSnapshot().mixing).toBe(true)
    })

    // take() should cancel the active mix and hard cut
    // pvwReady is still true since takeMix doesn't clear it until the timeout
    await engine.take()
    expect(engine.getState()).toBe('on-air')
    expect(engine.getSnapshot().mixing).toBe(false)
  })

  // ── Window getters ──

  it('getPgmWindow/getPvwWindow return correct windows', () => {
    expect(engine.getPgmWindow()).toBe(pgmWindow)
    expect(engine.getPvwWindow()).toBe(pvwWindow)
  })
})
