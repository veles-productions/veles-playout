/**
 * Preview (PVW) thumbnail panel.
 */

import React from 'react'
import type { EngineState } from '../hooks/usePlayoutState'

interface PreviewPanelProps {
  engineState: EngineState
  thumbUrl: string
}

export function PreviewPanel({ engineState, thumbUrl }: PreviewPanelProps) {
  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: '11px', fontWeight: 600,
      }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: engineState.pvwReady ? 'var(--green)' : 'var(--text-muted)',
        }} />
        PREVIEW (PVW)
      </div>
      <div style={{
        aspectRatio: '16/9', background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="PVW" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {engineState.pvwReady ? 'Template loaded' : 'No template'}
          </span>
        )}
      </div>
    </div>
  )
}
