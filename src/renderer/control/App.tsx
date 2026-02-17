/**
 * Veles Playout — Control Window Dashboard
 *
 * Shows:
 * - On-air status indicator
 * - PVW/PGM preview thumbnails
 * - FPS and dropped frames
 * - WebSocket connection info
 * - Output configuration (SDI/NDI/Window)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// ── Types ──

interface EngineState {
  state: 'idle' | 'pvw-loaded' | 'on-air' | 'frozen';
  pvwTemplate: unknown;
  pgmTemplate: unknown;
  pvwReady: boolean;
  pgmReady: boolean;
}

interface FrameStats {
  fps: number;
  dropped: number;
  totalFrames: number;
}

interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
}

interface PlayoutConfig {
  wsPort: number;
  frameRate: number;
  resolution: { width: number; height: number };
  rgbMonitor: number;
  alphaMonitor: number;
  sdi: { enabled: boolean; fillDevice: number; keyDevice: number; displayMode: string };
  ndi: { enabled: boolean; senderName: string };
}

// ── Declare window API (exposed via preload) ──

declare global {
  interface Window {
    playoutAPI: {
      getState(): Promise<EngineState>;
      getConfig(): Promise<PlayoutConfig>;
      setConfig(key: string, value: unknown): Promise<void>;
      getDisplays(): Promise<DisplayInfo[]>;
      getSdiDevices(): Promise<unknown[]>;
      setOutput(config: unknown): Promise<void>;
      getVersion(): Promise<string>;
      onStateChange(cb: (state: EngineState) => void): () => void;
      onFrameStats(cb: (stats: FrameStats) => void): () => void;
      onConnection(cb: (info: unknown) => void): () => void;
      onError(cb: (error: string) => void): () => void;
    };
  }
}

// ── Components ──

function StatusBar({ engineState, stats }: { engineState: EngineState; stats: FrameStats }) {
  const isLive = engineState.state === 'on-air' || engineState.state === 'frozen';
  const isFrozen = engineState.state === 'frozen';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 20px',
      background: isLive ? 'rgba(220, 38, 38, 0.1)' : 'var(--bg-surface-1)',
      borderBottom: `2px solid ${isLive ? 'var(--red)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: isLive ? 'var(--red)' : 'var(--text-muted)',
          animation: isLive ? 'pulse 1.5s infinite' : 'none',
        }} />
        <span style={{
          fontSize: '18px',
          fontWeight: 'bold',
          letterSpacing: '2px',
          color: isLive ? 'var(--red)' : 'var(--text-secondary)',
        }}>
          {isLive ? (isFrozen ? 'FROZEN' : 'ON AIR') : engineState.state === 'pvw-loaded' ? 'PREVIEW' : 'STANDBY'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '12px' }}>
        <span style={{ color: stats.fps >= 24 ? 'var(--green)' : 'var(--amber)' }}>
          {stats.fps} FPS
        </span>
        <span style={{ color: stats.dropped > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>
          Dropped: {stats.dropped}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          Frames: {stats.totalFrames.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function OutputConfig({ config, displays }: { config: PlayoutConfig | null; displays: DisplayInfo[] }) {
  if (!config) return null;

  return (
    <div style={{
      padding: '16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        Output Configuration
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* SDI */}
        <div style={{
          padding: '10px',
          background: 'var(--bg-surface-0)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: config.sdi.enabled ? 'var(--green)' : 'var(--text-muted)',
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>SDI (DeckLink)</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {config.sdi.enabled ? `Fill: ${config.sdi.fillDevice}, Key: ${config.sdi.keyDevice}` : 'Not configured'}
          </span>
        </div>

        {/* NDI */}
        <div style={{
          padding: '10px',
          background: 'var(--bg-surface-0)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: config.ndi.enabled ? 'var(--green)' : 'var(--text-muted)',
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>NDI</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {config.ndi.enabled ? config.ndi.senderName : 'Not configured'}
          </span>
        </div>

        {/* RGB Window */}
        <div style={{
          padding: '10px',
          background: 'var(--bg-surface-0)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: config.rgbMonitor >= 0 ? 'var(--green)' : 'var(--text-muted)',
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>RGB Window</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {config.rgbMonitor >= 0
              ? `Monitor ${config.rgbMonitor}${displays[config.rgbMonitor] ? ` (${displays[config.rgbMonitor].label || displays[config.rgbMonitor].size.width + 'x' + displays[config.rgbMonitor].size.height})` : ''}`
              : 'Not assigned'}
          </span>
        </div>

        {/* Alpha Window */}
        <div style={{
          padding: '10px',
          background: 'var(--bg-surface-0)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: config.alphaMonitor >= 0 ? 'var(--green)' : 'var(--text-muted)',
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Alpha Window</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {config.alphaMonitor >= 0
              ? `Monitor ${config.alphaMonitor}`
              : 'Not assigned'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ConnectionInfo({ clientCount, wsPort }: { clientCount: number; wsPort: number }) {
  return (
    <div style={{
      padding: '16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        Connection
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>WebSocket Port</span>
          <span style={{ fontFamily: 'monospace' }}>{wsPort}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Connected Clients</span>
          <span style={{ color: clientCount > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
            {clientCount}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Address</span>
          <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>ws://localhost:{wsPort}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──

function App() {
  const [engineState, setEngineState] = useState<EngineState>({
    state: 'idle',
    pvwTemplate: null,
    pgmTemplate: null,
    pvwReady: false,
    pgmReady: false,
  });
  const [stats, setStats] = useState<FrameStats>({ fps: 0, dropped: 0, totalFrames: 0 });
  const [config, setConfig] = useState<PlayoutConfig | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [version, setVersion] = useState('');
  const [clientCount, setClientCount] = useState(0);

  useEffect(() => {
    const api = window.playoutAPI;
    if (!api) return;

    // Load initial state
    api.getState().then(setEngineState);
    api.getConfig().then(setConfig);
    api.getDisplays().then(setDisplays);
    api.getVersion().then(setVersion);

    // Subscribe to events
    const unsubState = api.onStateChange(setEngineState);
    const unsubStats = api.onFrameStats(setStats);
    const unsubConn = api.onConnection((info: any) => {
      setClientCount(info.totalClients ?? 0);
    });

    return () => {
      unsubState();
      unsubStats();
      unsubConn();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Status Bar */}
      <StatusBar engineState={engineState} stats={stats} />

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Preview Monitors (placeholder thumbnails) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* PVW */}
          <div style={{
            background: 'var(--bg-surface-1)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              fontSize: '11px', fontWeight: 600,
            }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: engineState.pvwReady ? 'var(--green)' : 'var(--text-muted)' }} />
              PREVIEW (PVW)
            </div>
            <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {engineState.pvwReady ? 'Template loaded' : 'No template'}
              </span>
            </div>
          </div>

          {/* PGM */}
          <div style={{
            background: 'var(--bg-surface-1)',
            borderRadius: '8px',
            border: `1px solid ${engineState.state === 'on-air' || engineState.state === 'frozen' ? 'var(--red)' : 'var(--border)'}`,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 12px',
              borderBottom: `1px solid ${engineState.state === 'on-air' || engineState.state === 'frozen' ? 'var(--red)' : 'var(--border)'}`,
              fontSize: '11px', fontWeight: 600,
              color: engineState.state === 'on-air' ? 'var(--red)' : 'var(--text-primary)',
            }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: engineState.pgmReady ? 'var(--red)' : 'var(--text-muted)',
              }} />
              PROGRAM (PGM)
              {(engineState.state === 'on-air' || engineState.state === 'frozen') && (
                <span style={{
                  marginLeft: '6px',
                  padding: '1px 6px',
                  background: 'rgba(220, 38, 38, 0.2)',
                  borderRadius: '4px',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: 'var(--red)',
                }}>
                  {engineState.state === 'frozen' ? 'FROZEN' : 'LIVE'}
                </span>
              )}
            </div>
            <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {engineState.pgmReady ? 'On air' : 'No output'}
              </span>
            </div>
          </div>
        </div>

        {/* Output Config + Connection */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
          <OutputConfig config={config} displays={displays} />
          <ConnectionInfo clientCount={clientCount} wsPort={config?.wsPort ?? 9900} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 20px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10px',
        color: 'var(--text-muted)',
      }}>
        <span>Veles Playout v{version}</span>
        <span>{config?.resolution.width}x{config?.resolution.height} @ {config?.frameRate}fps</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// ── Mount ──

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
