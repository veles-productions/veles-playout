# Veles Playout

Standalone broadcast graphics renderer for the [Veles](https://github.com/veles-productions) TV automation platform. Renders HTML/CSS overlay templates via Chromium offscreen rendering and outputs uncompressed frames to DeckLink SDI, NDI, and fullscreen windows.

![Build](https://github.com/veles-productions/veles-playout/actions/workflows/build.yml/badge.svg)

## Download

Grab the latest release from [GitHub Releases](https://github.com/veles-productions/veles-playout/releases/latest):

| File | Description |
|------|-------------|
| `Veles-Playout-x.x.x-Setup.exe` | Windows installer (auto-updates) |
| `Veles-Playout-x.x.x-Portable.exe` | Portable — run from any folder |

**Requirements:** Windows 10/11 64-bit. Optional hardware for broadcast output:
- [Blackmagic Desktop Video](https://www.blackmagic-design.com/support/) drivers for DeckLink SDI
- [NDI Runtime](https://ndi.video/tools/) for NDI output

## Quick Start

1. **Launch** the app — the Control Window opens with status, monitors, and configuration panels
2. **Load a test signal** — click SMPTE in the Test Signals section
3. **Take to air** — press Space or click the red TAKE button. Status changes to ON AIR
4. **Clear** — press Escape or click CLEAR to go back to STANDBY

To connect from Veles Studio, open the Output page and enter `ws://localhost:9900` (or the playout machine's IP) in the Connectors Panel.

## Features

### Core Engine
- **PVW/PGM state machine** — industry-standard preview/program workflow with zero-latency TAKE (window-swap, no re-render)
- **MIX transition** — real-time BGRA frame crossfade between outgoing and incoming content, configurable duration (250ms–2s)
- **Transport controls** — PLAY, STOP, TAKE, CLEAR, FREEZE with keyboard shortcuts (Space, Escape, F)
- **Live hot-update** — update template variables on the live PGM output without re-taking (`updatePgm` command)

### Output
- **Multiple simultaneous outputs** — SDI (DeckLink fill+key), NDI, fullscreen window (RGB + Alpha)
- **Output resilience** — auto-disables failing outputs after 10 errors to protect the pipeline
- **Black burst** — clean black frames on SDI/NDI when idle (no garbage output)

### Templates
- **HTML/CSS rendering** — dynamic variables, CSS animations, transparent background
- **OGraf support** — [EBU Open Graphics](https://www.ebu.ch/groups/open-graphics) Web Components with dynamic resolution and frame rate
- **Built-in test signals** — SMPTE, Bars, Grid, Ramp patterns with optional alpha variants

### Broadcast Operations
- **As-run compliance log** — JSON Lines log (`as-run-YYYY-MM-DD.jsonl`) recording every take, clear, freeze, load, and crash event
- **Crash recovery** — automatic renderer restart on crash, PGM auto-clears to black burst, WS clients notified
- **HTTP health endpoint** — `/health` (JSON) and `/metrics` (Prometheus text format) on port 9901
- **Live PVW/PGM thumbnails** — 4fps JPEG thumbnails streamed to the control window

### Connectivity
- **WebSocket control** — JSON protocol on port 9900, accepts commands from Veles Studio or any client
- **WS authentication** — optional token-based auth via query parameter
- **Hardware detection** — auto-detects DeckLink devices, NDI runtime, and connected displays
- **Auto-updates** — checks GitHub Releases on launch, installs updates on quit

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         Control Window           │
                    │  Status · PVW/PGM Thumbnails     │
                    │  Transport · Test Signals · Config│
                    └────────────┬────────────────────┘
                                 │ IPC
                                 ▼
┌────────────┐    ┌──────────────────────────────┐    ┌──────────────┐
│ WS Client  │───▶│       Main Process            │───▶│ SDI Output   │
│ (Studio)   │    │                                │    │ (DeckLink)   │
│ port 9900  │◀───│  Engine ──▶ PVW BrowserWindow │    ├──────────────┤
└────────────┘    │    │         (offscreen)       │    │ NDI Output   │
                  │    │                           │───▶│ (grandiose)  │
┌────────────┐    │    └──▶ PGM BrowserWindow      │    ├──────────────┤
│ Health API │◀───│          (offscreen)           │    │ Window Output│
│ port 9901  │    │              │                 │───▶│ (fullscreen) │
└────────────┘    │              ▼                 │    │ RGB + Alpha  │
                  │    FrameCapture / MIX Blender  │    └──────────────┘
                  │      (paint → BGRA buffer)     │
                  │              │                 │
                  │              ▼                 │
                  │         As-Run Log             │
                  │    (as-run-YYYY-MM-DD.jsonl)    │
                  └──────────────────────────────────┘
```

**Engine states:** `idle` → `pvw-loaded` → `on-air` ⇆ `frozen`

**CUT:** Swaps PVW/PGM BrowserWindow references — zero-latency, no re-render.
**MIX:** Dual-capture both windows during transition, blend BGRA buffers per-pixel with integer math (multiply + shift, 4-way unrolled), push blended frames to outputs.

## WebSocket Protocol

Connect to `ws://localhost:9900`. With auth enabled: `ws://localhost:9900?token=YOUR_TOKEN`.

### Commands (client → playout)

```jsonc
// Load a template into preview
{ "type": "load", "payload": { "templateHtml": "<div>{{headline}}</div>", "templateCss": "div { color: white; }", "variables": { "headline": "Breaking News" } } }

// Load an OGraf template
{ "type": "load", "payload": { "templateHtml": "...", "isOGraf": true, "ografManifest": { ... }, "variables": { "headline": "Breaking" } } }

// Update variables on preview
{ "type": "update", "payload": { "variables": { "headline": "Updated" } } }

// Update variables on live PGM (hot update — no re-take needed)
{ "type": "updatePgm", "payload": { "variables": { "headline": "Live Edit" } } }

// Transport
{ "type": "take" }                                          // CUT transition
{ "type": "take", "payload": { "transition": "mix", "duration": 1000 } }  // MIX crossfade
{ "type": "clear" }      // Clear PGM (off-air)
{ "type": "play" }       // Play animation
{ "type": "stop" }       // Stop animation
{ "type": "freeze" }     // Toggle freeze on PGM

// Test signal
{ "type": "testSignal", "payload": { "pattern": "smpte", "alpha": false } }

// Query
{ "type": "status" }     // Get engine state
{ "type": "getInfo" }    // Get version, resolution, hardware info
```

### Events (playout → client)

```jsonc
{ "type": "state", "payload": { "state": "on-air", "pvwReady": true, "pgmReady": true, "mixing": false, ... } }
{ "type": "frameUpdate", "payload": { "fps": 25, "dropped": 0 } }
{ "type": "info", "payload": { "version": "0.1.1", "resolution": { "width": 1920, "height": 1080 }, ... } }
{ "type": "ack", "id": "cmd-123", "payload": { "success": true } }
{ "type": "error", "payload": { "message": "No template loaded in preview" } }
```

## Health & Monitoring

### HTTP Health Endpoint (port 9901)

```bash
# JSON health check
curl http://localhost:9901/health
# → { "status": "ok", "engine": "on-air", "fps": 25, "dropped": 0, "uptime": 3600, "clients": 2, "version": "0.1.1" }

# Prometheus metrics
curl http://localhost:9901/metrics
# → veles_playout_on_air 1
# → veles_playout_fps 25
# → veles_playout_dropped_frames_total 0
# → veles_playout_frames_total 90000
# → veles_playout_uptime_seconds 3600
# → veles_playout_ws_clients 2
```

Returns HTTP 503 when on-air but fps=0 (degraded).

### As-Run Log

Compliance log written to `%APPDATA%/veles-playout/as-run/as-run-YYYY-MM-DD.jsonl`:

```jsonl
{"timestamp":"2026-02-18T14:30:00.000Z","event":"load","templateId":"lower-third-1"}
{"timestamp":"2026-02-18T14:30:01.200Z","event":"take","templateId":"lower-third-1","variables":{"headline":"Breaking News"}}
{"timestamp":"2026-02-18T14:30:45.000Z","event":"clear"}
{"timestamp":"2026-02-18T14:31:00.000Z","event":"crash-recovery","details":"PGM crash: killed"}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | TAKE |
| Escape | CLEAR |
| F | FREEZE |

---

## Development

### Prerequisites

- Node.js 22+
- npm 10+

### Setup

```bash
git clone https://github.com/veles-productions/veles-playout.git
cd veles-playout
npm install
```

> `macadam` (SDI) and `grandiose` (NDI) are optional dependencies — they will fail to install if you don't have the hardware SDKs. The app works fine without them.

### Commands

```bash
npm run dev          # Development with hot reload
npm run build        # Compile TypeScript (electron-vite)
npm run dist         # Build + create Windows installer + portable
npm run dist:portable  # Build + portable exe only
npm run release      # Build + publish to GitHub Releases
npm test             # Run tests (vitest)
```

### Project Structure

```
src/
  main/                    # Electron main process (Node.js)
    index.ts               # App entry, window creation, IPC, lifecycle
    engine.ts              # PVW/PGM state machine (load/take/takeMix/clear/freeze)
    capture.ts             # Offscreen paint event → BGRA frame buffer
    ws-server.ts           # WebSocket control server (port 9900)
    config.ts              # Persistent settings (electron-store)
    hardware.ts            # SDI/NDI/display detection
    health.ts              # HTTP health + Prometheus metrics (port 9901)
    as-run-log.ts          # Broadcast compliance JSON Lines logger
    ipc.ts                 # IPC channel constants and message types
    template/
      builder.ts           # HTML template document builder
      ograf.ts             # OGraf (EBU) host page builder
      paths.ts             # Template cache directory management
      test-signals.ts      # Built-in SMPTE/Bars/Grid/Ramp generators
    output/
      manager.ts           # Frame routing to all output sinks (with error resilience)
      blackburst.ts        # Black frame generator for idle SDI/NDI
      sdi.ts               # DeckLink SDI output (macadam)
      ndi.ts               # NDI output (grandiose)
      window.ts            # Fullscreen window output (RGB + Alpha)
  renderer/
    control/               # Control window dashboard (React)
      App.tsx              # Status, PVW/PGM thumbnails, transport, config
      index.html           # Control window entry
    template/              # Offscreen rendering host page
      index.html           # Template injection target
    output/                # Fullscreen canvas output windows
      rgb.html             # RGB output (fill)
      alpha.html           # Alpha/key output
  preload/
    index.ts               # contextBridge for control window IPC
    output.ts              # contextBridge for output windows
```

### Configuration

Settings are stored via `electron-store` and persist across sessions:

| Setting | Default | Description |
|---------|---------|-------------|
| `wsPort` | `9900` | WebSocket server port |
| `wsAuthToken` | `""` | Auth token for WS connections (empty = no auth) |
| `healthPort` | `9901` | HTTP health endpoint port (0 = disabled) |
| `frameRate` | `25` | Target FPS (25 = PAL, 30 = NTSC) |
| `resolution` | `1920x1080` | Rendering resolution |
| `rgbMonitor` | `-1` (disabled) | Display index for RGB fullscreen window |
| `alphaMonitor` | `-1` (disabled) | Display index for Alpha/key window |
| `sdi.enabled` | `false` | Enable DeckLink SDI output |
| `sdi.fillDevice` | `0` | DeckLink device index for fill |
| `sdi.keyDevice` | `1` | DeckLink device index for key |
| `ndi.enabled` | `false` | Enable NDI output |
| `ndi.senderName` | `Veles Playout` | NDI source name on the network |
| `cacheMaxBytes` | `524288000` | Template cache max size (500MB) |

### CI/CD

GitHub Actions builds on every push to `main`. To create a release:

```bash
# Bump version in package.json, then:
git tag v0.1.1
git push origin v0.1.1
```

The workflow builds the NSIS installer and portable exe, then publishes them as a draft GitHub Release. Publish the draft to make it available for download and auto-updates.

## Related

- [veles-studio](https://github.com/veles-productions/veles-studio) — Web operator UI (sends commands via WebSocket)
- [veles-core](https://github.com/veles-productions/veles-core) — Backend API (template database, agent pipeline)
- [veles-gpu](https://github.com/veles-productions/veles-gpu) — GPU inference server (LLM, embeddings, image gen)

## License

MIT
