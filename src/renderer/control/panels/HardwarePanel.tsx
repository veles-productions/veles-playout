/**
 * Hardware detection panel — SDI, NDI, displays.
 */

import React, { useState, useCallback, useEffect } from 'react'
import type { HardwareInfo } from '../hooks/usePlayoutState'

export function HardwarePanel() {
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const info = await window.playoutAPI.getHardware()
      setHw(info as HardwareInfo)
    } catch (err) {
      console.error('[Hardware]', err)
    }
    setScanning(false)
  }, [])

  useEffect(() => { scan() }, [scan])

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Hardware</h3>
        <button onClick={scan} disabled={scanning} style={{
          padding: '4px 10px', fontSize: '10px', fontWeight: 600,
          border: '1px solid var(--border)', borderRadius: '4px',
          background: 'var(--bg-surface-0)', color: 'var(--text-secondary)',
          cursor: scanning ? 'wait' : 'pointer',
        }}>
          {scanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {hw && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>SDI (DeckLink)</span>
            <span style={{ color: hw.sdi.available ? 'var(--green)' : 'var(--text-muted)' }}>
              {hw.sdi.available ? `${hw.sdi.devices.length} device${hw.sdi.devices.length !== 1 ? 's' : ''}` : 'Not available'}
            </span>
          </div>
          {hw.sdi.available && hw.sdi.devices.map((d) => (
            <div key={d.index} style={{ paddingLeft: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {d.displayName} ({d.modelName})
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>NDI Runtime</span>
            <span style={{ color: hw.ndi.available ? 'var(--green)' : 'var(--text-muted)' }}>
              {hw.ndi.available ? 'Available' : 'Not available'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Displays</span>
            <span>{hw.displays.length}</span>
          </div>
          {hw.displays.map((d) => (
            <div key={d.id} style={{ paddingLeft: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {d.label} ({d.width}x{d.height})
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
