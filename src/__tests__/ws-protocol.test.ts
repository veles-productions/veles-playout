/**
 * WebSocket protocol tests.
 *
 * Tests the WS server command handling: load, take, clear, freeze,
 * update, updatePgm, status, getInfo, testSignal, auth.
 * Mocks ws module, engine, and config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ── Mock ws module (must not reference outer scope) ──

vi.mock('ws', () => {
  const { EventEmitter: EE } = require('events')

  class MockWS extends EE {
    static OPEN = 1
    readyState = 1
    send = vi.fn()
    close = vi.fn()
  }

  class MockWSS extends EE {
    close = vi.fn()
  }

  return {
    WebSocketServer: vi.fn().mockImplementation(() => new MockWSS()),
    WebSocket: MockWS,
  }
})

// ── Mock dependencies ──

vi.mock('../main/template/builder', () => ({
  buildTemplateDoc: vi.fn((payload: any) => `<html>${payload.templateHtml}</html>`),
}))

vi.mock('../main/template/ograf', () => ({
  buildOGrafHostDoc: vi.fn(() => '<html>ograf</html>'),
  isOGrafTemplate: vi.fn(() => false),
}))

vi.mock('../main/template/test-signals', () => ({
  generateTestSignal: vi.fn((pattern: string) => `<html>${pattern} test signal</html>`),
}))

vi.mock('../main/config', () => ({
  getConfig: vi.fn(() => ({
    resolution: { width: 1920, height: 1080 },
    frameRate: 25,
    wsPort: 9900,
    wsAuthToken: '',
    healthPort: 9901,
  })),
}))

vi.mock('../main/hardware', () => ({
  detectHardware: vi.fn(() => ({
    sdi: { available: false, devices: [] },
    ndi: { available: false },
    displays: [{ id: 1, label: 'Test', width: 1920, height: 1080 }],
  })),
}))

// Importing after mocks
import { WebSocketServer } from '../main/ws-server'
import { PlayoutEngine } from '../main/engine'
import { BrowserWindow } from 'electron'
import { WebSocketServer as WsServer, WebSocket as WsWebSocket } from 'ws'

function createMockEngine(): PlayoutEngine {
  const engine = new PlayoutEngine()
  const pvw = new (BrowserWindow as any)()
  const pgm = new (BrowserWindow as any)()
  pvw.webContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    setFrameRate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  pgm.webContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    setFrameRate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  engine.setWindows(pvw as any, pgm as any)
  return engine
}

function createMockSocket(): EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const ws = new EventEmitter() as any
  ws.readyState = (WsWebSocket as any).OPEN ?? 1
  ws.send = vi.fn()
  ws.close = vi.fn()
  return ws
}

describe('WebSocketServer', () => {
  let wsServer: WebSocketServer
  let engine: PlayoutEngine
  let mockWss: EventEmitter
  let mockSocket: ReturnType<typeof createMockSocket>

  beforeEach(() => {
    engine = createMockEngine()
    wsServer = new WebSocketServer(engine, 9900)
    wsServer.start()

    // Get the mock WsServer instance
    mockWss = (WsServer as any).mock.results[
      (WsServer as any).mock.results.length - 1
    ].value as EventEmitter

    mockSocket = createMockSocket()
  })

  function simulateConnection(socket?: typeof mockSocket, url?: string) {
    const ws = socket ?? mockSocket
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      url: url ?? '/',
      headers: { host: 'localhost:9900' },
    }
    mockWss.emit('connection', ws, req)
    return ws
  }

  function sendCommand(ws: typeof mockSocket, command: Record<string, unknown>) {
    const messageHandlers = ws.listeners('message')
    for (const handler of messageHandlers) {
      handler(Buffer.from(JSON.stringify(command)))
    }
  }

  // ── Connection ──

  it('sends current state on new connection', () => {
    simulateConnection()
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"state"')
    )
  })

  it('increments client count on connection', () => {
    simulateConnection()
    expect(wsServer.getClientCount()).toBe(1)
  })

  it('decrements client count on disconnect', () => {
    simulateConnection()
    expect(wsServer.getClientCount()).toBe(1)
    mockSocket.emit('close')
    expect(wsServer.getClientCount()).toBe(0)
  })

  // ── Auth ──

  it('rejects client without token when auth is required', () => {
    wsServer.setAuthToken('secret123')
    simulateConnection(undefined, '/')
    expect(mockSocket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
  })

  it('accepts client with correct token', () => {
    wsServer.setAuthToken('secret123')
    const ws = createMockSocket()
    simulateConnection(ws, '/?token=secret123')
    expect(ws.close).not.toHaveBeenCalled()
    expect(wsServer.getClientCount()).toBeGreaterThanOrEqual(1)
  })

  it('allows all clients when no auth token is set', () => {
    simulateConnection()
    expect(mockSocket.close).not.toHaveBeenCalled()
  })

  // ── Commands ──

  it('handles load command', async () => {
    simulateConnection()
    const loadSpy = vi.spyOn(engine, 'load')

    sendCommand(mockSocket, {
      type: 'load',
      payload: {
        templateHtml: '<div>Test</div>',
        variables: { headline: 'News' },
      },
    })

    await vi.waitFor(() => {
      expect(loadSpy).toHaveBeenCalled()
    })
  })

  it('handles take command (hard cut)', async () => {
    simulateConnection()
    await engine.load({
      templateHtml: '<div>Test</div>',
      templateId: 'test-1',
    })

    const takeSpy = vi.spyOn(engine, 'take')
    sendCommand(mockSocket, { type: 'take' })

    await vi.waitFor(() => {
      expect(takeSpy).toHaveBeenCalled()
    })
  })

  it('handles take command with mix transition', async () => {
    simulateConnection()
    await engine.load({
      templateHtml: '<div>Test</div>',
      templateId: 'test-1',
    })

    const mixSpy = vi.spyOn(engine, 'takeMix')
    sendCommand(mockSocket, {
      type: 'take',
      payload: { transition: 'mix', duration: 1000 },
    })

    await vi.waitFor(() => {
      expect(mixSpy).toHaveBeenCalledWith(1000)
    })
  })

  it('handles next command', async () => {
    simulateConnection()
    const nextSpy = vi.spyOn(engine, 'next')
    sendCommand(mockSocket, { type: 'next' })

    await vi.waitFor(() => {
      expect(nextSpy).toHaveBeenCalled()
    })
  })

  it('handles clear command', async () => {
    simulateConnection()
    const clearSpy = vi.spyOn(engine, 'clear')
    sendCommand(mockSocket, { type: 'clear' })

    await vi.waitFor(() => {
      expect(clearSpy).toHaveBeenCalled()
    })
  })

  it('handles freeze command', async () => {
    simulateConnection()
    const freezeSpy = vi.spyOn(engine, 'freeze')
    sendCommand(mockSocket, { type: 'freeze' })

    await vi.waitFor(() => {
      expect(freezeSpy).toHaveBeenCalled()
    })
  })

  it('handles update command', async () => {
    simulateConnection()
    const updateSpy = vi.spyOn(engine, 'update')
    sendCommand(mockSocket, {
      type: 'update',
      payload: { variables: { headline: 'Updated' } },
    })

    await vi.waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ headline: 'Updated' })
    })
  })

  it('handles updatePgm command', async () => {
    simulateConnection()
    const updatePgmSpy = vi.spyOn(engine, 'updatePgm')
    sendCommand(mockSocket, {
      type: 'updatePgm',
      payload: { variables: { headline: 'Live' } },
    })

    await vi.waitFor(() => {
      expect(updatePgmSpy).toHaveBeenCalledWith({ headline: 'Live' })
    })
  })

  it('handles status command — sends state back', () => {
    simulateConnection()
    mockSocket.send.mockClear()

    sendCommand(mockSocket, { type: 'status' })

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"state"')
    )
  })

  it('handles getInfo command — sends info back', () => {
    simulateConnection()
    mockSocket.send.mockClear()

    sendCommand(mockSocket, { type: 'getInfo' })

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"info"')
    )
  })

  it('handles testSignal command', async () => {
    simulateConnection()
    const loadSpy = vi.spyOn(engine, 'load')

    sendCommand(mockSocket, {
      type: 'testSignal',
      payload: { pattern: 'smpte' },
    })

    await vi.waitFor(() => {
      expect(loadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'test-signal:smpte' })
      )
    })
  })

  // ── Error handling ──

  it('sends error on invalid JSON', () => {
    simulateConnection()
    mockSocket.send.mockClear()

    const messageHandlers = mockSocket.listeners('message')
    for (const handler of messageHandlers) {
      handler(Buffer.from('not json'))
    }

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"error"')
    )
  })

  it('sends ack with matching ID on successful command', async () => {
    simulateConnection()
    await engine.load({ templateHtml: '<div>Test</div>', templateId: 'x' })
    mockSocket.send.mockClear()

    sendCommand(mockSocket, { type: 'clear', id: 'cmd-42' })

    await vi.waitFor(() => {
      const calls = mockSocket.send.mock.calls
      const ackCall = calls.find((c: any) => {
        const parsed = JSON.parse(c[0] as string)
        return parsed.type === 'ack' && parsed.id === 'cmd-42'
      })
      expect(ackCall).toBeDefined()
    })
  })

  it('sends error with matching ID on failed command', async () => {
    simulateConnection()
    mockSocket.send.mockClear()

    sendCommand(mockSocket, { type: 'load', id: 'cmd-99' })

    await vi.waitFor(() => {
      const calls = mockSocket.send.mock.calls
      const errCall = calls.find((c: any) => {
        const parsed = JSON.parse(c[0] as string)
        return parsed.type === 'error' && parsed.id === 'cmd-99'
      })
      expect(errCall).toBeDefined()
    })
  })

  // ── Broadcast ──

  it('broadcastState sends to all connected clients', () => {
    const ws1 = createMockSocket()
    const ws2 = createMockSocket()
    simulateConnection(ws1)
    simulateConnection(ws2)

    ws1.send.mockClear()
    ws2.send.mockClear()

    wsServer.broadcastState(engine.getSnapshot())

    expect(ws1.send).toHaveBeenCalledWith(expect.stringContaining('"type":"state"'))
    expect(ws2.send).toHaveBeenCalledWith(expect.stringContaining('"type":"state"'))
  })

  // ── Lifecycle ──

  it('stop() closes all clients and server', () => {
    const ws1 = createMockSocket()
    simulateConnection(ws1)

    wsServer.stop()

    expect(ws1.close).toHaveBeenCalledWith(1001, 'Server shutting down')
    expect(wsServer.getClientCount()).toBe(0)
  })

  it('getClients() returns connection info', () => {
    simulateConnection()
    const clients = wsServer.getClients()
    expect(clients).toHaveLength(1)
    expect(clients[0]).toHaveProperty('id')
    expect(clients[0]).toHaveProperty('remoteAddress', '127.0.0.1')
    expect(clients[0]).toHaveProperty('connectedAt')
  })
})
