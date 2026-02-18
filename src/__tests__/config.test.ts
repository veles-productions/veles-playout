/**
 * Config tests.
 *
 * Tests persistent settings: defaults, get/set round-trips, resetConfig.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getConfig, setConfig, resetConfig } from '../main/config'

describe('Config', () => {
  beforeEach(() => {
    resetConfig()
  })

  it('returns correct defaults', () => {
    const cfg = getConfig()
    expect(cfg.apiUrl).toBe('http://localhost:8000')
    expect(cfg.wsPort).toBe(9900)
    expect(cfg.wsAuthToken).toBe('')
    expect(cfg.healthPort).toBe(9901)
    expect(cfg.frameRate).toBe(25)
    expect(cfg.resolution).toEqual({ width: 1920, height: 1080 })
    expect(cfg.rgbMonitor).toBe(-1)
    expect(cfg.alphaMonitor).toBe(-1)
    expect(cfg.sdi.enabled).toBe(false)
    expect(cfg.ndi.enabled).toBe(false)
    expect(cfg.ndi.senderName).toBe('Veles Playout')
    expect(cfg.cacheMaxBytes).toBe(500 * 1024 * 1024)
  })

  it('get/set round-trip for simple values', () => {
    setConfig('wsPort', 5555)
    expect(getConfig().wsPort).toBe(5555)

    setConfig('frameRate', 30)
    expect(getConfig().frameRate).toBe(30)
  })

  it('get/set round-trip for nested objects', () => {
    setConfig('sdi', {
      enabled: true,
      fillDevice: 0,
      keyDevice: 1,
      displayMode: 'HD1080p25',
    })
    const sdi = getConfig().sdi
    expect(sdi.enabled).toBe(true)
    expect(sdi.displayMode).toBe('HD1080p25')
  })

  it('get/set round-trip for resolution', () => {
    setConfig('resolution', { width: 3840, height: 2160 })
    expect(getConfig().resolution).toEqual({ width: 3840, height: 2160 })
  })

  it('resetConfig restores defaults', () => {
    setConfig('wsPort', 1234)
    setConfig('frameRate', 60)
    expect(getConfig().wsPort).toBe(1234)

    resetConfig()

    expect(getConfig().wsPort).toBe(9900)
    expect(getConfig().frameRate).toBe(25)
  })

  it('wsAuthToken defaults to empty string', () => {
    expect(getConfig().wsAuthToken).toBe('')
  })

  it('healthPort defaults to 9901', () => {
    expect(getConfig().healthPort).toBe(9901)
  })
})
