# Veles Playout — Electron Broadcast Graphics App

Standalone Electron app that renders broadcast templates via Chromium offscreen rendering and outputs uncompressed frames to DeckLink SDI, NDI, and fullscreen windows. Controlled remotely from veles-studio via WebSocket.

## Tech Stack
- **Runtime:** Electron 35+ (Chromium offscreen rendering)
- **Language:** TypeScript (strict)
- **Build:** electron-vite + electron-builder
- **UI:** React 19 (control window only)
- **Settings:** electron-store
- **Protocol:** WebSocket (ws) on port 9900
- **Hardware:** macadam (DeckLink SDI, optional), grandiose (NDI, optional)

## Project Structure
```
src/
  main/          # Node.js main process
    index.ts     # App entry, windows, protocol, lifecycle
    engine.ts    # PVW/PGM state machine
    capture.ts   # Offscreen paint -> BGRA buffer
    ws-server.ts # WebSocket control API
    config.ts    # Persistent settings
    template/    # Template loading, building, OGraf support
    output/      # Frame routing, SDI, NDI, window output
  renderer/
    control/     # Dashboard UI (React)
    template/    # Offscreen rendering host page
    output/      # Fullscreen canvas windows (RGB, Alpha)
  preload/       # contextBridge for IPC
```

## Commands
- `npm run dev` — Development with hot reload
- `npm run build` — Production build
- `npm run dist` — Build + create Windows installer
- `npm run test` — Vitest

## Architecture Notes
- Offscreen BrowserWindows render at 1920x1080 with transparent background
- paint event provides raw BGRA via image.getBitmap() — no PNG encoding
- TAKE swaps PVW/PGM window references for zero-latency transitions
- Alpha extraction: pull byte [i*4+3] from BGRA -> grayscale luma key
- macadam and grandiose are optional — app works in window-only mode
- Template caching with LRU eviction in userData/templates/
- template:// custom protocol serves OGraf modules from cache

## Related Repos
- `veles-studio` — Operator UI, sends commands via WS
- `veles-core` — Template database API
- `veles-gpu` — GPU inference (browser fallback mode)
