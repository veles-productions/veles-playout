/**
 * Test signal panel — SMPTE, Bars, Grid, Ramp buttons + alpha toggle.
 */

import React, { useState, useCallback } from 'react'

export function TestSignalPanel() {
  const [alpha, setAlpha] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const patterns = [
    { id: 'smpte', label: 'SMPTE' },
    { id: 'bars', label: 'Bars' },
    { id: 'grid', label: 'Grid' },
    { id: 'ramp', label: 'Ramp' },
  ] as const

  const handleLoad = useCallback(async (pattern: string) => {
    setLoading(pattern)
    try { await window.playoutAPI.loadTestSignal(pattern, alpha) }
    catch (err) { console.error('[TestSignal]', err) }
    setLoading(null)
  }, [alpha])

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        Test Signals
      </h3>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        {patterns.map((p) => (
          <button
            key={p.id}
            onClick={() => handleLoad(p.id)}
            disabled={loading !== null}
            style={{
              flex: 1,
              padding: '8px 4px',
              fontSize: '11px',
              fontWeight: 600,
              border: '1px solid var(--border)',
              borderRadius: '6px',
              background: loading === p.id ? 'var(--bg-surface-2)' : 'var(--bg-surface-0)',
              color: 'var(--text-primary)',
              cursor: loading !== null ? 'wait' : 'pointer',
              opacity: loading !== null && loading !== p.id ? 0.5 : 1,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={alpha} onChange={(e) => setAlpha(e.target.checked)} style={{ accentColor: 'var(--green)' }} />
        Alpha variant (transparent bg)
      </label>
    </div>
  )
}
