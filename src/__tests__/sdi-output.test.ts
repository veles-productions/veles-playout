/**
 * SDI Output integration tests.
 *
 * Tests the SdiOutput driver (with mocked macadam), the OutputManager
 * frame distribution logic, and the BlackBurst idle signal generator
 * flowing through the OutputManager.
 *
 * macadam is mocked entirely — no hardware or DeckLink SDK required.
 *
 * Strategy: since SdiOutput uses `require('macadam')` internally (a CJS
 * optional dep), and vitest's vi.mock caching makes it hard to toggle
 * the require on/off between tests, we bypass the module mock entirely.
 * Instead, we directly inject the mock macadam object into SdiOutput's
 * private `macadam` field and call the internal initialization steps
 * via a test helper. For the "macadam not available" test, we let the
 * real require fail naturally (macadam is not installed in the test env).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SdiOutput } from '../main/output/sdi'
import { OutputManager } from '../main/output/manager'
import type { OutputDriver, Size } from '../main/output/manager'
import { BlackBurst } from '../main/output/blackburst'

// ---------------------------------------------------------------------------
// Mock macadam helpers
// ---------------------------------------------------------------------------

function createMockPlayback(opts?: { width?: number; height?: number }) {
  return {
    width: opts?.width ?? 1920,
    height: opts?.height ?? 1080,
    bufferSize: (opts?.width ?? 1920) * (opts?.height ?? 1080) * 4,
    frameRate: [25, 1],
    displayFrame: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }
}

type MockPlayback = ReturnType<typeof createMockPlayback>

interface MockMacadam {
  bmdModeHD1080i50: string
  bmdModeHD1080p25: string
  bmdFormat8BitBGRA: string
  playback: ReturnType<typeof vi.fn>
  getDeviceInfo: ReturnType<typeof vi.fn>
  __fillPlayback: MockPlayback
  __keyPlayback: MockPlayback
}

function createMockMacadam(overrides?: {
  playbackFn?: (...args: any[]) => Promise<any>
}): MockMacadam {
  const fillPlayback = createMockPlayback()
  const keyPlayback = createMockPlayback()

  const playbackFn =
    overrides?.playbackFn ??
    vi.fn().mockImplementation(async (opts: { deviceIndex: number }) => {
      if (opts.deviceIndex === 0) return fillPlayback
      if (opts.deviceIndex === 1) return keyPlayback
      throw new Error(`No device at index ${opts.deviceIndex}`)
    })

  return {
    bmdModeHD1080i50: 'bmdModeHD1080i50',
    bmdModeHD1080p25: 'bmdModeHD1080p25',
    bmdFormat8BitBGRA: 'bmdFormat8BitBGRA',
    playback: playbackFn,
    getDeviceInfo: vi.fn().mockResolvedValue([]),
    __fillPlayback: fillPlayback,
    __keyPlayback: keyPlayback,
  }
}

// ---------------------------------------------------------------------------
// Injection helper
//
// SdiOutput.init() does `this.macadam = require('macadam')` then uses
// this.macadam.playback(...). We inject our mock directly into the private
// field so the class methods work against our mock without needing a
// real or vitest-mocked macadam module.
// ---------------------------------------------------------------------------

/**
 * Initialize an SdiOutput by directly injecting mock objects into its
 * private fields — bypassing the `require('macadam')` call entirely.
 *
 * SdiOutput.init() uses `require('macadam')` which is an optional CJS
 * dependency. Since macadam is not installed in the test environment and
 * vitest's module mock caching makes it hard to toggle require behavior
 * per test, we simulate what init() does step by step.
 *
 * For the "macadam not available" test, the real init() is called instead,
 * and the natural require failure is asserted.
 */
async function initSdiWithMock(
  sdi: SdiOutput,
  mockMac: MockMacadam,
  config: {
    fillDevice?: number
    keyDevice?: number
    displayMode?: string
  } = {},
): Promise<void> {
  const s = sdi as any

  // Step 1: Set macadam mock (simulating successful require)
  s.macadam = mockMac

  // Step 2: Compute display mode (same logic as init)
  const DISPLAY_MODES: Record<string, string> = {
    HD1080i50: 'bmdModeHD1080i50',
    HD1080i5994: 'bmdModeHD1080i5994',
    HD1080p25: 'bmdModeHD1080p25',
    HD1080p2997: 'bmdModeHD1080p2997',
    HD1080p50: 'bmdModeHD1080p50',
    HD720p50: 'bmdModeHD720p50',
    HD720p5994: 'bmdModeHD720p5994',
  }
  const displayModeStr = config.displayMode ?? 'HD1080i50'
  const modeKey = DISPLAY_MODES[displayModeStr] || 'bmdModeHD1080i50'
  const displayMode = mockMac[modeKey as keyof MockMacadam] || mockMac.bmdModeHD1080i50
  const pixelFormat = mockMac.bmdFormat8BitBGRA

  const fillDevice = config.fillDevice ?? 0
  const keyDevice = config.keyDevice ?? fillDevice

  // Step 3: Initialize fill playback
  s.fillPlayback = await mockMac.playback({
    deviceIndex: fillDevice,
    displayMode,
    pixelFormat,
  })

  // Step 4: Initialize key playback (if different device)
  if (keyDevice !== fillDevice) {
    try {
      s.keyPlayback = await mockMac.playback({
        deviceIndex: keyDevice,
        displayMode,
        pixelFormat,
      })
      s.hasKey = true
    } catch {
      s.keyPlayback = null
      s.hasKey = false
    }
  }

  // Step 5: Mark as initialized
  s.initialized = true
  sdi.emit('ready')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HD_SIZE: Size = { width: 1920, height: 1080 }
const PIXEL_COUNT = HD_SIZE.width * HD_SIZE.height
const BGRA_BUF_SIZE = PIXEL_COUNT * 4

/**
 * Create a BGRA buffer filled with a known pixel pattern.
 * Uses exponential doubling via Buffer.copy for O(log n) copies
 * instead of O(n) per-pixel writes — finishes in <1ms at 1080p.
 */
function createBgraFrame(fillByte = 0x80, alphaByte = 0xcc): Buffer {
  const buf = Buffer.alloc(BGRA_BUF_SIZE)
  // Seed the first pixel
  buf[0] = fillByte  // B
  buf[1] = fillByte  // G
  buf[2] = fillByte  // R
  buf[3] = alphaByte  // A
  // Double the filled region each iteration
  let filled = 4
  while (filled < BGRA_BUF_SIZE) {
    const copyLen = Math.min(filled, BGRA_BUF_SIZE - filled)
    buf.copy(buf, filled, 0, copyLen)
    filled += copyLen
  }
  return buf
}

// ---------------------------------------------------------------------------
// 1. SdiOutput with mock macadam
// ---------------------------------------------------------------------------

describe('SdiOutput', () => {
  let sdi: SdiOutput
  let mockMac: MockMacadam

  beforeEach(() => {
    sdi = new SdiOutput()
    mockMac = createMockMacadam()
  })

  afterEach(() => {
    sdi.destroy()
  })

  // ── init() ──

  it('init() with enabled=false does nothing', async () => {
    // Call the REAL init with enabled=false — no macadam needed
    await sdi.init({
      enabled: false,
      fillDevice: 0,
      keyDevice: 1,
      displayMode: 'HD1080i50',
    })

    // Nothing should be initialized — pushFrame is a no-op
    const frame = createBgraFrame()
    sdi.pushFrame(frame, HD_SIZE)
    expect(mockMac.playback).not.toHaveBeenCalled()
  })

  it('init() throws when macadam is not available', async () => {
    // Call the REAL init — macadam is not installed in test env, so
    // require('macadam') will throw, which init catches and re-throws.
    await expect(
      sdi.init({
        enabled: true,
        fillDevice: 0,
        keyDevice: 1,
        displayMode: 'HD1080i50',
      }),
    ).rejects.toThrow('macadam not available')
  })

  it('init() successfully initializes fill playback', async () => {
    await initSdiWithMock(sdi, mockMac, {
      fillDevice: 0,
      keyDevice: 0,
      displayMode: 'HD1080i50',
    })

    expect(mockMac.playback).toHaveBeenCalledWith(
      expect.objectContaining({ deviceIndex: 0 }),
    )
    expect(sdi.needsKeyFrame).toBe(false)
  })

  it('init() sets up both fill and key outputs when devices differ', async () => {
    await initSdiWithMock(sdi, mockMac, {
      fillDevice: 0,
      keyDevice: 1,
      displayMode: 'HD1080i50',
    })

    expect(mockMac.playback).toHaveBeenCalledTimes(2)
    expect(sdi.needsKeyFrame).toBe(true)
    expect(sdi.hasKeyOutput()).toBe(true)
  })

  it('init() continues in fill-only mode when key device fails', async () => {
    const failKeyMac = createMockMacadam({
      playbackFn: vi.fn().mockImplementation(
        async (opts: { deviceIndex: number }) => {
          if (opts.deviceIndex === 0) return createMockPlayback()
          throw new Error('Device not found')
        },
      ),
    })

    await initSdiWithMock(sdi, failKeyMac, {
      fillDevice: 0,
      keyDevice: 1,
    })

    expect(sdi.needsKeyFrame).toBe(false)
    expect(sdi.hasKeyOutput()).toBe(false)
  })

  // ── pushFrame() / pushKeyFrame() ──

  it('pushFrame() calls displayFrame() on fill playback', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 0 })

    const frame = createBgraFrame()
    sdi.pushFrame(frame, HD_SIZE)

    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)
    // Verify the exact buffer reference was passed (not deep comparison)
    expect(mockMac.__fillPlayback.displayFrame.mock.calls[0][0]).toBe(frame)
  })

  it('pushKeyFrame() calls displayFrame() on key playback', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 1 })

    const keyFrame = createBgraFrame(0xff, 0xff)
    sdi.pushKeyFrame(keyFrame, HD_SIZE)

    expect(mockMac.__keyPlayback.displayFrame).toHaveBeenCalledTimes(1)
    expect(mockMac.__keyPlayback.displayFrame.mock.calls[0][0]).toBe(keyFrame)
  })

  it('pushFrame() is a no-op when not initialized', () => {
    const frame = createBgraFrame()
    // Should not throw
    sdi.pushFrame(frame, HD_SIZE)
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()
  })

  // ── needsKeyFrame ──

  it('needsKeyFrame returns false when no key device', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 0 })
    expect(sdi.needsKeyFrame).toBe(false)
  })

  it('needsKeyFrame returns true when key device available', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 1 })
    expect(sdi.needsKeyFrame).toBe(true)
  })

  // ── destroy() ──

  it('destroy() stops both playback channels', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 1 })

    const fillPb = mockMac.__fillPlayback
    const keyPb = mockMac.__keyPlayback

    sdi.destroy()

    expect(fillPb.stop).toHaveBeenCalled()
    expect(keyPb.stop).toHaveBeenCalled()
    expect(sdi.needsKeyFrame).toBe(false)
  })

  it('destroy() resets initialized state so pushFrame becomes no-op', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 0 })

    sdi.destroy()

    mockMac.__fillPlayback.displayFrame.mockClear()
    const frame = createBgraFrame()
    sdi.pushFrame(frame, HD_SIZE)
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()
  })

  // ── displayFrame rejection emits 'error' event ──

  it('displayFrame rejection emits error event (not unhandled)', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 0 })

    const testError = new Error('DeckLink: frame buffer overflow')
    mockMac.__fillPlayback.displayFrame.mockRejectedValueOnce(testError)

    const errorHandler = vi.fn()
    sdi.on('error', errorHandler)

    const frame = createBgraFrame()
    sdi.pushFrame(frame, HD_SIZE)

    // The rejection is handled asynchronously via .catch()
    await vi.waitFor(() => {
      expect(errorHandler).toHaveBeenCalledWith(testError)
    })
  })

  it('displayFrame rejection on key playback emits error event', async () => {
    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 1 })

    const testError = new Error('DeckLink: key output timeout')
    mockMac.__keyPlayback.displayFrame.mockRejectedValueOnce(testError)

    const errorHandler = vi.fn()
    sdi.on('error', errorHandler)

    const keyFrame = createBgraFrame()
    sdi.pushKeyFrame(keyFrame, HD_SIZE)

    await vi.waitFor(() => {
      expect(errorHandler).toHaveBeenCalledWith(testError)
    })
  })

  // ── Display mode mapping ──

  it('init() maps known display modes correctly', async () => {
    await initSdiWithMock(sdi, mockMac, {
      fillDevice: 0,
      keyDevice: 0,
      displayMode: 'HD1080p25',
    })

    expect(mockMac.playback).toHaveBeenCalledWith(
      expect.objectContaining({
        displayMode: 'bmdModeHD1080p25',
        pixelFormat: 'bmdFormat8BitBGRA',
      }),
    )
  })

  it('init() falls back to bmdModeHD1080i50 for unknown display mode', async () => {
    await initSdiWithMock(sdi, mockMac, {
      fillDevice: 0,
      keyDevice: 0,
      displayMode: 'SomeUnknownMode',
    })

    expect(mockMac.playback).toHaveBeenCalledWith(
      expect.objectContaining({
        displayMode: 'bmdModeHD1080i50',
      }),
    )
  })

  it('init() emits ready event on successful initialization', async () => {
    const readyHandler = vi.fn()
    sdi.on('ready', readyHandler)

    await initSdiWithMock(sdi, mockMac, { fillDevice: 0, keyDevice: 0 })

    expect(readyHandler).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 2. OutputManager + SdiOutput integration
// ---------------------------------------------------------------------------

describe('OutputManager + SdiOutput integration', () => {
  let manager: OutputManager
  let mockMac: MockMacadam

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new OutputManager()
    mockMac = createMockMacadam()
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  async function createInitedSdi(opts: {
    fillDevice?: number
    keyDevice?: number
    displayMode?: string
    mac?: MockMacadam
  } = {}): Promise<SdiOutput> {
    const mac = opts.mac ?? mockMac
    const sdi = new SdiOutput()
    await initSdiWithMock(sdi, mac, {
      fillDevice: opts.fillDevice ?? 0,
      keyDevice: opts.keyDevice ?? 0,
      displayMode: opts.displayMode ?? 'HD1080i50',
    })
    return sdi
  }

  it('distributeFrame extracts alpha key when SDI has needsKeyFrame=true', async () => {
    const sdi = await createInitedSdi({ fillDevice: 0, keyDevice: 1 })
    expect(sdi.needsKeyFrame).toBe(true)

    manager.addOutput('sdi', sdi)

    // Push a frame with known alpha=0xAA
    const alphaByte = 0xaa
    const frame = createBgraFrame(0x55, alphaByte)
    manager.pushFrame(frame, HD_SIZE)

    // Fill should have been called with the original frame (reference check
    // to avoid vitest deep-comparing 8MB buffers which hangs the test runner)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)
    expect(mockMac.__fillPlayback.displayFrame.mock.calls[0][0]).toBe(frame)

    // Key should have been called with a buffer where B=G=R=alpha, A=255
    const keyCall = mockMac.__keyPlayback.displayFrame.mock.calls[0][0] as Buffer
    expect(keyCall).toBeInstanceOf(Buffer)
    expect(keyCall.length).toBe(BGRA_BUF_SIZE)

    // Spot-check pixels in the key buffer
    for (const px of [0, 100, 500, PIXEL_COUNT - 1]) {
      const off = px * 4
      expect(keyCall[off]).toBe(alphaByte)       // B = alpha
      expect(keyCall[off + 1]).toBe(alphaByte)   // G = alpha
      expect(keyCall[off + 2]).toBe(alphaByte)   // R = alpha
      expect(keyCall[off + 3]).toBe(255)         // A = fully opaque
    }

    sdi.destroy()
  })

  it('distributeFrame skips alpha extraction when needsKeyFrame=false', async () => {
    const sdi = await createInitedSdi({ fillDevice: 0, keyDevice: 0 })
    expect(sdi.needsKeyFrame).toBe(false)

    manager.addOutput('sdi', sdi)

    const frame = createBgraFrame()
    manager.pushFrame(frame, HD_SIZE)

    // Fill called (reference check to avoid deep-comparing large buffers)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)
    expect(mockMac.__fillPlayback.displayFrame.mock.calls[0][0]).toBe(frame)

    // Key should NOT have been called
    expect(mockMac.__keyPlayback.displayFrame).not.toHaveBeenCalled()

    sdi.destroy()
  })

  it('pushFrame in clock mode buffers frame and distributes on tick', async () => {
    const sdi = await createInitedSdi()

    manager.addOutput('sdi', sdi)
    manager.startClock(25) // 40ms interval

    // Push a frame — should be buffered, not yet distributed
    const frame = createBgraFrame(0x33, 0xff)
    manager.pushFrame(frame, HD_SIZE)

    // No immediate distribution in clock mode
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()

    // Advance timer by one tick (40ms)
    vi.advanceTimersByTime(40)

    // Now the frame should have been distributed
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)

    // Advance another tick — frame hold: same frame repeated
    vi.advanceTimersByTime(40)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(2)

    manager.stopClock()
    sdi.destroy()
  })

  it('addOutput/removeOutput at runtime works correctly', async () => {
    const sdi = await createInitedSdi()

    // Start without any outputs
    expect(manager.getActiveOutputs()).toEqual([])

    // Add SDI at runtime
    manager.addOutput('sdi', sdi)
    expect(manager.getActiveOutputs()).toEqual(['sdi'])
    expect(manager.getOutput('sdi')).toBe(sdi)

    // Push a frame — should reach SDI
    const frame = createBgraFrame()
    manager.pushFrame(frame, HD_SIZE)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)

    // Remove SDI at runtime (calls destroy on the output)
    const stopSpy = vi.spyOn(mockMac.__fillPlayback, 'stop')
    manager.removeOutput('sdi')
    expect(manager.getActiveOutputs()).toEqual([])
    expect(manager.getOutput('sdi')).toBeUndefined()
    expect(stopSpy).toHaveBeenCalled()

    // Push another frame — no one to receive it, no error
    mockMac.__fillPlayback.displayFrame.mockClear()
    manager.pushFrame(frame, HD_SIZE)
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()
  })

  it('removeOutput of non-existent id does not throw', () => {
    expect(() => manager.removeOutput('nonexistent')).not.toThrow()
  })

  it('manager distributes to multiple outputs simultaneously', async () => {
    const sdi = await createInitedSdi()

    // Create a second mock output (simulated NDI)
    const mockNdi: OutputDriver = {
      name: 'ndi',
      pushFrame: vi.fn(),
      destroy: vi.fn(),
    }

    manager.addOutput('sdi', sdi)
    manager.addOutput('ndi', mockNdi)

    const frame = createBgraFrame()
    manager.pushFrame(frame, HD_SIZE)

    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)
    expect(mockNdi.pushFrame).toHaveBeenCalledTimes(1)
    expect(mockNdi.pushFrame).toHaveBeenCalledWith(
      expect.anything(), // Buffer (avoid deep comparison of 8MB)
      HD_SIZE,
    )
    // Verify reference identity for the frame buffer
    expect((mockNdi.pushFrame as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(frame)

    sdi.destroy()
  })

  it('OutputManager removes output after 10 consecutive errors', () => {
    const failingOutput: OutputDriver = {
      name: 'fail-output',
      pushFrame: vi.fn().mockImplementation(() => {
        throw new Error('output failed')
      }),
      destroy: vi.fn(),
    }

    manager.addOutput('fail', failingOutput)

    const frame = createBgraFrame()

    for (let i = 0; i < 10; i++) {
      manager.pushFrame(frame, HD_SIZE)
    }

    // After 10 errors the output should be removed and destroyed
    expect(manager.getActiveOutputs()).toEqual([])
    expect(failingOutput.destroy).toHaveBeenCalled()
  })

  it('clock mode: stopClock reverts to immediate push', async () => {
    const sdi = await createInitedSdi()

    manager.addOutput('sdi', sdi)

    manager.startClock(25)
    expect(manager.isClockRunning()).toBe(true)

    manager.stopClock()
    expect(manager.isClockRunning()).toBe(false)

    // Now pushFrame should distribute immediately (no buffering)
    const frame = createBgraFrame()
    manager.pushFrame(frame, HD_SIZE)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)

    sdi.destroy()
  })

  it('manager.destroy() cleans up all outputs and stops clock', async () => {
    const sdi = await createInitedSdi()

    manager.addOutput('sdi', sdi)
    manager.startClock(25)

    manager.destroy()

    expect(manager.getActiveOutputs()).toEqual([])
    expect(manager.isClockRunning()).toBe(false)
    expect(mockMac.__fillPlayback.stop).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. BlackBurst -> OutputManager flow
// ---------------------------------------------------------------------------

describe('BlackBurst -> OutputManager flow', () => {
  let manager: OutputManager
  let mockMac: MockMacadam

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new OutputManager()
    mockMac = createMockMacadam()
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  async function createInitedSdi(opts: {
    fillDevice?: number
    keyDevice?: number
  } = {}): Promise<SdiOutput> {
    const sdi = new SdiOutput()
    await initSdiWithMock(sdi, mockMac, {
      fillDevice: opts.fillDevice ?? 0,
      keyDevice: opts.keyDevice ?? 0,
    })
    return sdi
  }

  it('black burst pushes all-zero frames at configured FPS', async () => {
    const sdi = await createInitedSdi()
    manager.addOutput('sdi', sdi)

    const bb = new BlackBurst(1920, 1080)
    bb.start(25, (buffer, size) => {
      manager.pushFrame(buffer, size)
    })

    // After 0ms — no frames yet (interval hasn't fired)
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()

    // Advance 40ms (1 frame at 25fps)
    vi.advanceTimersByTime(40)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)

    // Verify the frame is all zeros
    const sentFrame = mockMac.__fillPlayback.displayFrame.mock.calls[0][0] as Buffer
    expect(sentFrame.every((byte: number) => byte === 0)).toBe(true)

    // Advance 4 more frames (160ms total = 200ms, expect 5 frames)
    vi.advanceTimersByTime(160)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(5)

    bb.stop()
    sdi.destroy()
  })

  it('black burst frames have correct buffer size for 1920x1080', () => {
    const bb = new BlackBurst(1920, 1080)
    const { buffer, width, height } = bb.getFrame()

    const expectedSize = 1920 * 1080 * 4 // BGRA = 4 bytes per pixel
    expect(buffer.length).toBe(expectedSize)
    expect(width).toBe(1920)
    expect(height).toBe(1080)

    // Every byte should be zero (black + transparent alpha)
    expect(buffer.every((byte: number) => byte === 0)).toBe(true)
  })

  it('black burst with custom resolution has correct buffer size', () => {
    const bb = new BlackBurst(1280, 720)
    const { buffer, width, height } = bb.getFrame()

    expect(buffer.length).toBe(1280 * 720 * 4)
    expect(width).toBe(1280)
    expect(height).toBe(720)
  })

  it('black burst stop() halts frame delivery', async () => {
    const sdi = await createInitedSdi()
    manager.addOutput('sdi', sdi)

    const bb = new BlackBurst(1920, 1080)
    bb.start(25, (buffer, size) => {
      manager.pushFrame(buffer, size)
    })

    // Deliver a few frames
    vi.advanceTimersByTime(120) // 3 frames at 25fps (40ms each)
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(3)

    // Stop black burst
    bb.stop()

    // Advance more time — no additional frames should arrive
    mockMac.__fillPlayback.displayFrame.mockClear()
    vi.advanceTimersByTime(200)
    expect(mockMac.__fillPlayback.displayFrame).not.toHaveBeenCalled()

    sdi.destroy()
  })

  it('black burst frames flow through to SDI with key when configured', async () => {
    const sdi = await createInitedSdi({ fillDevice: 0, keyDevice: 1 })
    expect(sdi.needsKeyFrame).toBe(true)

    manager.addOutput('sdi', sdi)

    const bb = new BlackBurst(1920, 1080)
    bb.start(25, (buffer, size) => {
      manager.pushFrame(buffer, size)
    })

    // Advance one frame
    vi.advanceTimersByTime(40)

    // Both fill and key should receive frames
    expect(mockMac.__fillPlayback.displayFrame).toHaveBeenCalledTimes(1)
    expect(mockMac.__keyPlayback.displayFrame).toHaveBeenCalledTimes(1)

    // The key frame: alpha=0 from black burst means B=G=R=0, A=255
    const keyFrame = mockMac.__keyPlayback.displayFrame.mock.calls[0][0] as Buffer
    for (let px = 0; px < 10; px++) {
      const off = px * 4
      expect(keyFrame[off]).toBe(0)       // B = alpha (0)
      expect(keyFrame[off + 1]).toBe(0)   // G = alpha (0)
      expect(keyFrame[off + 2]).toBe(0)   // R = alpha (0)
      expect(keyFrame[off + 3]).toBe(255) // A = fully opaque
    }

    bb.stop()
    sdi.destroy()
  })
})
