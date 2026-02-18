/**
 * Output configuration panel — SDI, NDI, RGB/Alpha window settings.
 */

import React from 'react'
import type { PlayoutConfig, DisplayInfo, HardwareInfo } from '../hooks/usePlayoutState'

interface OutputPanelProps {
  config: PlayoutConfig | null
  displays: DisplayInfo[]
  hardware: HardwareInfo | null
  onConfigChange: (key: string, value: unknown) => void
}

export function OutputPanel({ config, displays, hardware, onConfigChange }: OutputPanelProps) {
  if (!config) return null

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '4px 6px', fontSize: '10px',
    border: '1px solid var(--border)', borderRadius: '4px',
    background: 'var(--bg-surface-1)', color: 'var(--text-primary)', marginTop: '4px',
  }

  const sdiDevices = hardware?.sdi?.devices ?? []

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        Output
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {/* SDI */}
        <div style={{ padding: '8px', background: 'var(--bg-surface-0)', borderRadius: '6px', border: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            <input type="checkbox" checked={config.sdi.enabled}
              onChange={(e) => onConfigChange('sdi', { ...config.sdi, enabled: e.target.checked })}
              style={{ accentColor: 'var(--green)' }} />
            SDI (DeckLink)
          </label>
          {config.sdi.enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>
                <label style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Fill</label>
                <select value={config.sdi.fillDevice}
                  onChange={(e) => onConfigChange('sdi', { ...config.sdi, fillDevice: Number(e.target.value) })}
                  style={selectStyle}>
                  {sdiDevices.length === 0
                    ? <option value={config.sdi.fillDevice}>Device {config.sdi.fillDevice}</option>
                    : sdiDevices.map((d) => <option key={d.index} value={d.index}>{d.displayName}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Key</label>
                <select value={config.sdi.keyDevice}
                  onChange={(e) => onConfigChange('sdi', { ...config.sdi, keyDevice: Number(e.target.value) })}
                  style={selectStyle}>
                  {sdiDevices.length === 0
                    ? <option value={config.sdi.keyDevice}>Device {config.sdi.keyDevice}</option>
                    : sdiDevices.map((d) => <option key={d.index} value={d.index}>{d.displayName}</option>)}
                </select>
              </div>
            </div>
          )}
          {!config.sdi.enabled && <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Disabled</span>}
        </div>

        {/* NDI */}
        <div style={{ padding: '8px', background: 'var(--bg-surface-0)', borderRadius: '6px', border: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            <input type="checkbox" checked={config.ndi.enabled}
              onChange={(e) => onConfigChange('ndi', { ...config.ndi, enabled: e.target.checked })}
              style={{ accentColor: 'var(--green)' }} />
            NDI
          </label>
          {config.ndi.enabled && (
            <div>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Sender Name</label>
              <input type="text" value={config.ndi.senderName}
                onChange={(e) => onConfigChange('ndi', { ...config.ndi, senderName: e.target.value })}
                style={{ ...selectStyle, padding: '4px 8px' }} />
            </div>
          )}
          {!config.ndi.enabled && <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Disabled</span>}
        </div>

        {/* RGB Window */}
        <div style={{ padding: '8px', background: 'var(--bg-surface-0)', borderRadius: '6px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: config.rgbMonitor >= 0 ? 'var(--green)' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>RGB Window</span>
          </div>
          <select value={config.rgbMonitor}
            onChange={(e) => onConfigChange('rgbMonitor', Number(e.target.value))}
            style={selectStyle}>
            <option value={-1}>Not assigned</option>
            {displays.map((d, i) => <option key={d.id} value={i}>{d.label || `Display ${i}`} ({d.size.width}x{d.size.height})</option>)}
          </select>
        </div>

        {/* Alpha Window */}
        <div style={{ padding: '8px', background: 'var(--bg-surface-0)', borderRadius: '6px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: config.alphaMonitor >= 0 ? 'var(--green)' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Alpha Window</span>
          </div>
          <select value={config.alphaMonitor}
            onChange={(e) => onConfigChange('alphaMonitor', Number(e.target.value))}
            style={selectStyle}>
            <option value={-1}>Not assigned</option>
            {displays.map((d, i) => <option key={d.id} value={i}>{d.label || `Display ${i}`} ({d.size.width}x{d.size.height})</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
