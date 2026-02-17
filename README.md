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
3. **Take to air** — click the red TAKE button. Status changes to ON AIR
4. **Clear** — click CLEAR to go back to STANDBY

To connect from Veles Studio, open the Output page and enter `ws://localhost:9900` (or the playout machine's IP) in the Connectors Panel.

## Features

- **PVW/PGM engine** — industry-standard preview/program workflow with zero-latency TAKE (window-swap, no re-render)
- **Transport controls** — PLAY, STOP, TAKE, CLEAR, FREEZE buttons in the control window for standalone operation
- **Multiple outputs** — SDI (DeckLink fill+key), NDI, fullscreen window (RGB + Alpha), all simultaneous
- **Template rendering** — HTML/CSS templates with dynamic variables, CSS animations, and [OGraf](https://www.ebu.ch/groups/open-graphics) (EBU standard) support
- **Built-in test signals** — SMPTE, Bars, Grid, Ramp patterns with optional alpha variants
- **WebSocket control** — JSON protocol on port 9900, accepts commands from Veles Studio or any client
- **Hardware detection** — auto-detects DeckLink devices, NDI runtime, and connected displays
- **Auto-updates** — checks GitHub Releases on launch, installs updates on quit
- **Persistent config** — settings saved via electron-store across sessions

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         Control Window           │
                    │  Status · Monitors · Transport   │
                    │  Test Signals · Hardware · Config │
                    └────────────┬────────────────────┘
                                 │ IPC
                                 ▼
┌────────────┐    ┌──────────────────────────────┐    ┌──────────────┐
│ WS Client  │───▶│       Main Process            │───▶│ SDI Output   │
│ (Studio)   │    │                                │    │ (DeckLink)   │
│ port 9900  │◀───│  Engine ──▶ PVW BrowserWindow │    ├──────────────┤
└────────────┘    │    │         (offscreen)       │    │ NDI Output   │
                  │    │                           │───▶│ (grandiose)  │
                  │    └──▶ PGM BrowserWindow      │    ├──────────────┤
                  │          (offscreen)           │    │ Window Output│
                  │              │                 │───▶│ (fullscreen) │
                  │              ▼                 │    │ RGB + Alpha  │
                  │         FrameCapture           │    └──────────────┘
                  │      (paint → BGRA buffer)     │
                  └──────────────────────────────────┘
```

**Engine states:** `idle` → `pvw-loaded` → `on-air` ⇆ `frozen`

TAKE swaps the PVW and PGM BrowserWindow references rather than copying content, giving true zero-latency transitions.

## WebSocket Protocol

Connect to `ws://localhost:9900`. Commands are JSON:

### Commands (client → playout)

```jsonc
// Load a template into preview
{ "type": "load", "payload": { "templateHtml": "<div>{{headline}}</div>", "templateCss": "div { color: white; }", "variables": { "headline": "Breaking News" } } }

// Update variables on preview
{ "type": "update", "payload": { "variables": { "headline": "Updated" } } }

// Transport
{ "type": "take" }       // PVW → PGM (go on-air)
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
{ "type": "state", "payload": { "state": "on-air", "pvwReady": true, "pgmReady": true, ... } }
{ "type": "frameUpdate", "payload": { "fps": 25, "dropped": 0 } }
{ "type": "info", "payload": { "version": "0.1.0", "resolution": { "width": 1920, "height": 1080 }, ... } }
{ "type": "error", "payload": { "message": "No template loaded in preview" } }
```

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
    engine.ts              # PVW/PGM state machine (load/take/clear/freeze)
    capture.ts             # Offscreen paint event → BGRA frame buffer
    ws-server.ts           # WebSocket control server (port 9900)
    config.ts              # Persistent settings (electron-store)
    hardware.ts            # SDI/NDI/display detection
    ipc.ts                 # IPC channel constants and message types
    template/
      builder.ts           # HTML template document builder
      ograf.ts             # OGraf (EBU) host page builder
      paths.ts             # Template cache directory management
      test-signals.ts      # Built-in SMPTE/Bars/Grid/Ramp generators
    output/
      manager.ts           # Frame routing to all output sinks
      sdi.ts               # DeckLink SDI output (macadam)
      ndi.ts               # NDI output (grandiose)
      window.ts            # Fullscreen window output (RGB + Alpha)
  renderer/
    control/               # Control window dashboard (React)
      App.tsx              # Status, monitors, transport, config panels
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
| `frameRate` | `25` | Target FPS (25 = PAL, 30 = NTSC) |
| `resolution` | `1920x1080` | Rendering resolution |
| `rgbMonitor` | `-1` (disabled) | Display index for RGB fullscreen window |
| `alphaMonitor` | `-1` (disabled) | Display index for Alpha/key window |
| `sdi.enabled` | `false` | Enable DeckLink SDI output |
| `sdi.fillDevice` | `0` | DeckLink device index for fill |
| `sdi.keyDevice` | `1` | DeckLink device index for key |
| `ndi.enabled` | `false` | Enable NDI output |
| `ndi.senderName` | `Veles Playout` | NDI source name on the network |

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
