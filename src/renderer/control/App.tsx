/**
 * Veles Playout — Control Window Dashboard
 *
 * Panel-based layout for professional broadcast operation.
 * Left column: PVW + PGM thumbnails stacked
 * Right column: Transport + Test Signals + Output + Connection + Hardware
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { usePlayoutState } from './hooks/usePlayoutState'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { StatusPanel } from './panels/StatusPanel'
import { PreviewPanel } from './panels/PreviewPanel'
import { ProgramPanel } from './panels/ProgramPanel'
import { TransportPanel } from './panels/TransportPanel'
import { TestSignalPanel } from './panels/TestSignalPanel'
import { OutputPanel } from './panels/OutputPanel'
import { ConnectionPanel } from './panels/ConnectionPanel'
import { HardwarePanel } from './panels/HardwarePanel'

// ── Declare window API (exposed via preload) ──

declare global {
  interface Window {
    playoutAPI: {
      getState(): Promise<unknown>
      getConfig(): Promise<unknown>
      setConfig(key: string, value: unknown): Promise<void>
      getDisplays(): Promise<unknown[]>
      getSdiDevices(): Promise<unknown[]>
      setOutput(config: unknown): Promise<void>
      getVersion(): Promise<string>
      loadTestSignal(pattern: string, alpha?: boolean): Promise<void>
      getHardware(): Promise<unknown>
      take(): Promise<void>
      clear(): Promise<void>
      play(): Promise<void>
      stop(): Promise<void>
      freeze(): Promise<void>
      next(): Promise<void>
      onStateChange(cb: (state: unknown) => void): () => void
      onFrameStats(cb: (stats: unknown) => void): () => void
      onConnection(cb: (info: unknown) => void): () => void
      onError(cb: (error: string) => void): () => void
      onPvwThumbnail(cb: (buffer: ArrayBuffer) => void): () => void
      onPgmThumbnail(cb: (buffer: ArrayBuffer) => void): () => void
    }
  }
}

function App() {
  const state = usePlayoutState()
  useKeyboardShortcuts()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Status Bar */}
      <StatusPanel
        engineState={state.engineState}
        stats={state.stats}
        targetFps={state.config?.frameRate ?? 25}
      />

      {/* Main Content — 2-column layout */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto auto 1fr',
        gap: '12px',
        alignContent: 'start',
      }}>
        {/* Left: PVW + PGM */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <PreviewPanel engineState={state.engineState} thumbUrl={state.pvwThumbUrl} />
          <ProgramPanel engineState={state.engineState} thumbUrl={state.pgmThumbUrl} />
        </div>

        {/* Right: Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <TransportPanel engineState={state.engineState} />
          <TestSignalPanel />
          <ConnectionPanel
            clientCount={state.clientCount}
            wsPort={state.config?.wsPort ?? 9900}
          />
        </div>

        {/* Full-width: Output + Hardware */}
        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
          <OutputPanel
            config={state.config}
            displays={state.displays}
            hardware={state.hardware}
            onConfigChange={state.handleConfigChange}
          />
          <HardwarePanel />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 20px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10px',
        color: 'var(--text-muted)',
      }}>
        <span>Veles Playout v{state.version}</span>
        <span>{state.config?.resolution.width}x{state.config?.resolution.height} @ {state.config?.frameRate}fps</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ── Mount ──

const container = document.getElementById('app')
if (container) {
  const root = createRoot(container)
  root.render(<App />)
}
