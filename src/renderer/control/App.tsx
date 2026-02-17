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

interface HardwareInfo {
  sdi: { available: boolean; devices: Array<{ index: number; modelName: string; displayName: string }> };
  ndi: { available: boolean };
  displays: Array<{ id: number; label: string; width: number; height: number }>;
}

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
      loadTestSignal(pattern: string, alpha?: boolean): Promise<void>;
      getHardware(): Promise<HardwareInfo>;
      take(): Promise<void>;
      clear(): Promise<void>;
      play(): Promise<void>;
      stop(): Promise<void>;
      freeze(): Promise<void>;
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

function TransportControls({ engineState }: { engineState: EngineState }) {
  const [busy, setBusy] = useState<string | null>(null);

  const exec = useCallback(async (action: string, fn: () => Promise<void>) => {
    setBusy(action);
    try {
      await fn();
    } catch (err) {
      console.error(`[Transport] ${action} failed:`, err);
    }
    setBusy(null);
  }, []);

  const isIdle = engineState.state === 'idle';
  const isLive = engineState.state === 'on-air' || engineState.state === 'frozen';

  const buttons: Array<{
    id: string;
    label: string;
    color: string;
    bg: string;
    hoverBg: string;
    disabled: boolean;
    large?: boolean;
    fn: () => Promise<void>;
  }> = [
    {
      id: 'play',
      label: 'PLAY',
      color: '#22c55e',
      bg: 'rgba(34, 197, 94, 0.15)',
      hoverBg: 'rgba(34, 197, 94, 0.25)',
      disabled: isIdle,
      fn: () => window.playoutAPI.play(),
    },
    {
      id: 'stop',
      label: 'STOP',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)',
      hoverBg: 'rgba(245, 158, 11, 0.25)',
      disabled: isIdle,
      fn: () => window.playoutAPI.stop(),
    },
    {
      id: 'take',
      label: 'TAKE',
      color: '#dc2626',
      bg: 'rgba(220, 38, 38, 0.15)',
      hoverBg: 'rgba(220, 38, 38, 0.25)',
      disabled: isIdle,
      large: true,
      fn: () => window.playoutAPI.take(),
    },
    {
      id: 'clear',
      label: 'CLEAR',
      color: '#9ca3af',
      bg: 'rgba(156, 163, 175, 0.15)',
      hoverBg: 'rgba(156, 163, 175, 0.25)',
      disabled: isIdle,
      fn: () => window.playoutAPI.clear(),
    },
    {
      id: 'freeze',
      label: isLive && engineState.state === 'frozen' ? 'UNFREEZE' : 'FREEZE',
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.15)',
      hoverBg: 'rgba(59, 130, 246, 0.25)',
      disabled: !isLive,
      fn: () => window.playoutAPI.freeze(),
    },
  ];

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        Transport
      </h3>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        {buttons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => exec(btn.id, btn.fn)}
            disabled={btn.disabled || busy !== null}
            style={{
              flex: btn.large ? 1.5 : 1,
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
            }}
          >
            {busy === btn.id ? '...' : btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TestSignalPanel() {
  const [alpha, setAlpha] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const patterns = [
    { id: 'smpte', label: 'SMPTE' },
    { id: 'bars', label: 'Bars' },
    { id: 'grid', label: 'Grid' },
    { id: 'ramp', label: 'Ramp' },
  ] as const;

  const handleLoad = useCallback(async (pattern: string) => {
    setLoading(pattern);
    try {
      await window.playoutAPI.loadTestSignal(pattern, alpha);
    } catch (err) {
      console.error('[TestSignal] Load failed:', err);
    }
    setLoading(null);
  }, [alpha]);

  return (
    <div style={{
      padding: '16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        Test Signals
      </h3>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
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
        <input
          type="checkbox"
          checked={alpha}
          onChange={(e) => setAlpha(e.target.checked)}
          style={{ accentColor: 'var(--green)' }}
        />
        Alpha variant (transparent bg)
      </label>
    </div>
  );
}

function HardwarePanel() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const info = await window.playoutAPI.getHardware();
      setHw(info);
    } catch (err) {
      console.error('[Hardware] Scan failed:', err);
    }
    setScanning(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  return (
    <div style={{
      padding: '16px',
      background: 'var(--bg-surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Hardware
        </h3>
        <button
          onClick={scan}
          disabled={scanning}
          style={{
            padding: '4px 10px',
            fontSize: '10px',
            fontWeight: 600,
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg-surface-0)',
            color: 'var(--text-secondary)',
            cursor: scanning ? 'wait' : 'pointer',
          }}
        >
          {scanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {hw && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
          {/* SDI */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>SDI (DeckLink)</span>
            <span style={{ color: hw.sdi.available ? 'var(--green)' : 'var(--text-muted)' }}>
              {hw.sdi.available
                ? `${hw.sdi.devices.length} device${hw.sdi.devices.length !== 1 ? 's' : ''}`
                : 'Not available'}
            </span>
          </div>
          {hw.sdi.available && hw.sdi.devices.length > 0 && (
            <div style={{ paddingLeft: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {hw.sdi.devices.map((d) => (
                <div key={d.index}>{d.displayName} ({d.modelName})</div>
              ))}
            </div>
          )}

          {/* NDI */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>NDI Runtime</span>
            <span style={{ color: hw.ndi.available ? 'var(--green)' : 'var(--text-muted)' }}>
              {hw.ndi.available ? 'Available' : 'Not available'}
            </span>
          </div>

          {/* Displays */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Displays</span>
            <span>{hw.displays.length}</span>
          </div>
          {hw.displays.length > 0 && (
            <div style={{ paddingLeft: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {hw.displays.map((d) => (
                <div key={d.id}>{d.label} ({d.width}x{d.height})</div>
              ))}
            </div>
          )}
        </div>
      )}
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

        {/* Transport Controls */}
        <TransportControls engineState={engineState} />

        {/* Test Signals */}
        <TestSignalPanel />

        {/* Output Config + Connection */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
          <OutputConfig config={config} displays={displays} />
          <ConnectionInfo clientCount={clientCount} wsPort={config?.wsPort ?? 9900} />
        </div>

        {/* Hardware Info */}
        <HardwarePanel />
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
