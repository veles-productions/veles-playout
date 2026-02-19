/**
 * Central hook for playout state subscription.
 * Aggregates engine state, frame stats, thumbnails, config, and hardware.
 */

import { useState, useEffect, useCallback } from 'react'

export interface EngineState {
  state: 'idle' | 'pvw-loaded' | 'on-air' | 'frozen'
  pvwTemplate: unknown
  pgmTemplate: unknown
  pvwReady: boolean
  pgmReady: boolean
  mixing?: boolean
}

export interface FrameStats {
  fps: number
  dropped: number
  totalFrames: number
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  size: { width: number; height: number }
}

export interface PlayoutConfig {
  wsPort: number
  frameRate: number
  resolution: { width: number; height: number }
  rgbMonitor: number
  alphaMonitor: number
  sdi: { enabled: boolean; fillDevice: number; keyDevice: number; displayMode: string }
  ndi: { enabled: boolean; senderName: string }
}

export interface HardwareInfo {
  sdi: { available: boolean; devices: Array<{ index: number; modelName: string; displayName: string }> }
  ndi: { available: boolean }
  displays: Array<{ id: number; label: string; width: number; height: number }>
}

export interface PlayoutState {
  engineState: EngineState
  stats: FrameStats
  config: PlayoutConfig | null
  displays: DisplayInfo[]
  hardware: HardwareInfo | null
  version: string
  clientCount: number
  pvwThumbUrl: string
  pgmThumbUrl: string
}

export function usePlayoutState(): PlayoutState & {
  handleConfigChange: (key: string, value: unknown) => Promise<void>
} {
  const [engineState, setEngineState] = useState<EngineState>({
    state: 'idle',
    pvwTemplate: null,
    pgmTemplate: null,
    pvwReady: false,
    pgmReady: false,
  })
  const [stats, setStats] = useState<FrameStats>({ fps: 0, dropped: 0, totalFrames: 0 })
  const [config, setConfig] = useState<PlayoutConfig | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [version, setVersion] = useState('')
  const [clientCount, setClientCount] = useState(0)
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [pvwThumbUrl, setPvwThumbUrl] = useState('')
  const [pgmThumbUrl, setPgmThumbUrl] = useState('')

  const handleConfigChange = useCallback(async (key: string, value: unknown) => {
    try {
      // Output-related keys need to go through setOutput to open/close windows
      const outputKeys = ['rgbMonitor', 'alphaMonitor', 'sdi', 'ndi']
      if (outputKeys.includes(key)) {
        await window.playoutAPI.setOutput({ [key]: value })
      } else {
        await window.playoutAPI.setConfig(key, value)
      }
      const updated = await window.playoutAPI.getConfig()
      setConfig(updated as PlayoutConfig)
    } catch (err) {
      console.error('[Config] Update failed:', err)
    }
  }, [])

  useEffect(() => {
    const api = window.playoutAPI
    if (!api) return

    api.getState().then((s) => setEngineState(s as EngineState))
    api.getConfig().then((c) => setConfig(c as PlayoutConfig))
    api.getDisplays().then((d) => setDisplays(d as DisplayInfo[]))
    api.getVersion().then(setVersion)
    api.getHardware().then((h) => setHardware(h as HardwareInfo)).catch(() => {})

    const unsubState = api.onStateChange((s) => setEngineState(s as EngineState))
    const unsubStats = api.onFrameStats((s) => setStats(s as FrameStats))
    const unsubConn = api.onConnection((info: any) => {
      setClientCount(info.totalClients ?? 0)
    })

    const unsubPvw = api.onPvwThumbnail((buffer: ArrayBuffer) => {
      const blob = new Blob([buffer], { type: 'image/jpeg' })
      const url = URL.createObjectURL(blob)
      setPvwThumbUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
    })
    const unsubPgm = api.onPgmThumbnail((buffer: ArrayBuffer) => {
      const blob = new Blob([buffer], { type: 'image/jpeg' })
      const url = URL.createObjectURL(blob)
      setPgmThumbUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
    })

    return () => {
      unsubState()
      unsubStats()
      unsubConn()
      unsubPvw()
      unsubPgm()
    }
  }, [])

  return {
    engineState,
    stats,
    config,
    displays,
    hardware,
    version,
    clientCount,
    pvwThumbUrl,
    pgmThumbUrl,
    handleConfigChange,
  }
}
