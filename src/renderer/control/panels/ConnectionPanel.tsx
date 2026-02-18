/**
 * Connection info panel — WS port, client count, address.
 */

import React from 'react'

interface ConnectionPanelProps {
  clientCount: number
  wsPort: number
}

export function ConnectionPanel({ clientCount, wsPort }: ConnectionPanelProps) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        Connection
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>WebSocket Port</span>
          <span style={{ fontFamily: 'monospace' }}>{wsPort}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Connected Clients</span>
          <span style={{ color: clientCount > 0 ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>
            {clientCount}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Address</span>
          <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>ws://localhost:{wsPort}</span>
        </div>
      </div>
    </div>
  )
}
