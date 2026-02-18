/**
 * Program (PGM) thumbnail panel with red tally border when on-air.
 */

import React from 'react'
import type { EngineState } from '../hooks/usePlayoutState'

interface ProgramPanelProps {
  engineState: EngineState
  thumbUrl: string
}

export function ProgramPanel({ engineState, thumbUrl }: ProgramPanelProps) {
  const isLive = engineState.state === 'on-air' || engineState.state === 'frozen'
  const isFrozen = engineState.state === 'frozen'

  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: `2px solid ${isLive ? 'var(--red)' : 'var(--border)'}`,
      overflow: 'hidden',
      boxShadow: isLive ? '0 0 12px rgba(220, 38, 38, 0.2)' : 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 12px',
        borderBottom: `1px solid ${isLive ? 'var(--red)' : 'var(--border)'}`,
        fontSize: '11px', fontWeight: 600,
        color: isLive ? 'var(--red)' : 'var(--text-primary)',
        background: isLive ? 'rgba(220, 38, 38, 0.08)' : 'transparent',
      }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: engineState.pgmReady ? 'var(--red)' : 'var(--text-muted)',
          animation: isLive && !isFrozen ? 'pulse 1.5s infinite' : 'none',
        }} />
        PROGRAM (PGM)
        {isLive && (
          <span style={{
            marginLeft: '6px',
            padding: '1px 8px',
            background: isFrozen ? 'rgba(245, 158, 11, 0.2)' : 'rgba(220, 38, 38, 0.2)',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 700,
            color: isFrozen ? 'var(--amber)' : 'var(--red)',
            letterSpacing: '1px',
          }}>
            {isFrozen ? 'FROZEN' : 'LIVE'}
          </span>
        )}
      </div>
      <div style={{
        aspectRatio: '16/9', background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="PGM" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {engineState.pgmReady ? 'On air' : 'No output'}
          </span>
        )}
      </div>
    </div>
  )
}
