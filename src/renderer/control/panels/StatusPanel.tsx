/**
 * Status bar panel — engine state, FPS, frame counters.
 */

import React from 'react'
import type { EngineState, FrameStats } from '../hooks/usePlayoutState'

interface StatusPanelProps {
  engineState: EngineState
  stats: FrameStats
  targetFps: number
}

export function StatusPanel({ engineState, stats, targetFps }: StatusPanelProps) {
  const isLive = engineState.state === 'on-air' || engineState.state === 'frozen'
  const isFrozen = engineState.state === 'frozen'
  const isMixing = engineState.mixing

  const stateLabel = isLive
    ? isFrozen ? 'FROZEN' : isMixing ? 'MIX' : 'ON AIR'
    : engineState.state === 'pvw-loaded' ? 'PREVIEW' : 'STANDBY'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 20px',
      background: isLive ? 'rgba(220, 38, 38, 0.08)' : 'var(--bg-surface-1)',
      borderBottom: `2px solid ${isLive ? 'var(--red)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: isLive ? 'var(--red)' : 'var(--text-muted)',
          animation: isLive && !isFrozen ? 'pulse 1.5s infinite' : 'none',
          boxShadow: isLive ? '0 0 8px rgba(220, 38, 38, 0.5)' : 'none',
        }} />
        <span style={{
          fontSize: '18px',
          fontWeight: 'bold',
          letterSpacing: '2px',
          color: isLive ? 'var(--red)' : 'var(--text-secondary)',
        }}>
          {stateLabel}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '12px' }}>
        <span style={{
          color: stats.fps >= targetFps - 1 ? 'var(--green)' : stats.fps > 0 ? 'var(--amber)' : 'var(--text-muted)',
          fontFamily: 'monospace',
          fontWeight: 600,
        }}>
          {stats.fps}/{targetFps} FPS
        </span>
        <span style={{
          color: stats.dropped > 0 ? 'var(--amber)' : 'var(--text-muted)',
          fontFamily: 'monospace',
        }}>
          {stats.dropped} dropped
        </span>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          {stats.totalFrames.toLocaleString()} frames
        </span>
      </div>
    </div>
  )
}
