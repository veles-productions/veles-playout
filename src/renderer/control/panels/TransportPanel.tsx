/**
 * Transport controls panel — TAKE, NEXT, CLEAR, FREEZE, PLAY, STOP + panic button.
 * Shows F-key labels on buttons.
 */

import React, { useState, useCallback } from 'react'
import type { EngineState } from '../hooks/usePlayoutState'

interface TransportPanelProps {
  engineState: EngineState
}

interface TransportButton {
  id: string
  label: string
  fKey: string
  color: string
  bg: string
  disabled: boolean
  large?: boolean
  danger?: boolean
  fn: () => Promise<void>
}

export function TransportPanel({ engineState }: TransportPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)

  const exec = useCallback(async (action: string, fn: () => Promise<void>) => {
    setBusy(action)
    try { await fn() } catch (err) { console.error(`[Transport] ${action}:`, err) }
    setBusy(null)
  }, [])

  const isIdle = engineState.state === 'idle'
  const isLive = engineState.state === 'on-air' || engineState.state === 'frozen'
  const isFrozen = engineState.state === 'frozen'

  const buttons: TransportButton[] = [
    {
      id: 'play', label: 'PLAY', fKey: '',
      color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)',
      disabled: isIdle,
      fn: () => window.playoutAPI.play(),
    },
    {
      id: 'stop', label: 'STOP', fKey: '',
      color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)',
      disabled: isIdle,
      fn: () => window.playoutAPI.stop(),
    },
    {
      id: 'take', label: 'TAKE', fKey: 'Space / F1',
      color: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)',
      disabled: isIdle, large: true,
      fn: () => window.playoutAPI.take(),
    },
    {
      id: 'next', label: 'NEXT', fKey: 'F2',
      color: '#4d65ff', bg: 'rgba(77, 101, 255, 0.15)',
      disabled: !isLive,
      fn: () => window.playoutAPI.next(),
    },
    {
      id: 'freeze', label: isFrozen ? 'UNFREEZE' : 'FREEZE', fKey: 'F',
      color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)',
      disabled: !isLive,
      fn: () => window.playoutAPI.freeze(),
    },
    {
      id: 'clear', label: 'CLEAR', fKey: 'Esc / F5',
      color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)',
      disabled: isIdle,
      fn: () => window.playoutAPI.clear(),
    },
  ]

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Transport
        </h3>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
          Press ? for all shortcuts
        </span>
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch', flexWrap: 'wrap' }}>
        {buttons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => exec(btn.id, btn.fn)}
            disabled={btn.disabled || busy !== null}
            style={{
              flex: btn.large ? '1.5 1 0' : '1 1 0',
              minWidth: btn.large ? '120px' : '70px',
              padding: btn.large ? '14px 8px' : '10px 8px',
              fontSize: btn.large ? '14px' : '11px',
              fontWeight: 700,
              letterSpacing: '1px',
              border: `2px solid ${btn.disabled ? 'var(--border)' : btn.color}`,
              borderRadius: '6px',
              background: btn.disabled ? 'var(--bg-surface-0)' : btn.bg,
              color: btn.disabled ? 'var(--text-muted)' : btn.color,
              cursor: btn.disabled || busy !== null ? 'not-allowed' : 'pointer',
              opacity: btn.disabled ? 0.4 : busy === btn.id ? 0.7 : 1,
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            <span>{busy === btn.id ? '...' : btn.label}</span>
            {btn.fKey && (
              <span style={{ fontSize: '8px', fontWeight: 400, opacity: 0.6 }}>
                [{btn.fKey}]
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panic button */}
      <button
        onClick={() => exec('panic', () => window.playoutAPI.clear())}
        disabled={isIdle}
        style={{
          width: '100%',
          marginTop: '8px',
          padding: '8px',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '2px',
          border: `2px solid ${isIdle ? 'var(--border)' : '#dc2626'}`,
          borderRadius: '6px',
          background: isIdle ? 'var(--bg-surface-0)' : 'rgba(220, 38, 38, 0.2)',
          color: isIdle ? 'var(--text-muted)' : '#dc2626',
          cursor: isIdle ? 'not-allowed' : 'pointer',
          opacity: isIdle ? 0.3 : 1,
        }}
      >
        PANIC — CLEAR ALL [F12]
      </button>
    </div>
  )
}
