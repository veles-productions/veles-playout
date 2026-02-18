/**
 * Health endpoint tests.
 *
 * Tests the HTTP health and Prometheus metrics endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as http from 'http'
import { HealthServer } from '../main/health'
import type { PlayoutEngine, EngineState, EngineSnapshot } from '../main/engine'
import type { FrameCapture, CaptureStats } from '../main/capture'
import type { WebSocketServer } from '../main/ws-server'

function createMockDeps(overrides?: {
  engineState?: EngineState
  fps?: number
  dropped?: number
  totalFrames?: number
  clientCount?: number
}) {
  const mockEngine = {
    getState: vi.fn().mockReturnValue(overrides?.engineState ?? 'idle'),
    getSnapshot: vi.fn().mockReturnValue({ state: overrides?.engineState ?? 'idle' }),
  } as unknown as PlayoutEngine

  const mockCapture = {
    getStats: vi.fn().mockReturnValue({
      fps: overrides?.fps ?? 25,
      dropped: overrides?.dropped ?? 0,
      totalFrames: overrides?.totalFrames ?? 1000,
    } as CaptureStats),
  } as unknown as FrameCapture

  const mockWsServer = {
    getClientCount: vi.fn().mockReturnValue(overrides?.clientCount ?? 1),
  } as unknown as WebSocketServer

  return { engine: mockEngine, capture: mockCapture, wsServer: mockWsServer }
}

// Use a random port for each test to avoid conflicts
let testPort = 19900

function getTestPort() {
  return ++testPort
}

function httpGet(port: number, path: string, method = 'GET'): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('HealthServer', () => {
  let server: HealthServer | null = null

  afterEach(() => {
    if (server) {
      server.stop()
      server = null
    }
  })

  it('GET /health returns 200 with correct JSON when healthy', async () => {
    const port = getTestPort()
    const deps = createMockDeps({ engineState: 'idle', fps: 25 })
    server = new HealthServer(port, deps)
    server.start()

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/health')
    expect(res.status).toBe(200)

    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.engine).toBe('idle')
    expect(body.fps).toBe(25)
    expect(body.dropped).toBe(0)
    expect(body.totalFrames).toBe(1000)
    expect(body.uptime).toBeGreaterThanOrEqual(0)
    expect(body.clients).toBe(1)
    expect(body.version).toBeDefined()
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('GET /health returns 503 when degraded (on-air + 0 fps)', async () => {
    const port = getTestPort()
    const deps = createMockDeps({ engineState: 'on-air', fps: 0 })
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/health')
    expect(res.status).toBe(503)

    const body = JSON.parse(res.body)
    expect(body.status).toBe('degraded')
    expect(body.engine).toBe('on-air')
  })

  it('GET /health returns 200 when idle + 0 fps (normal idle)', async () => {
    const port = getTestPort()
    const deps = createMockDeps({ engineState: 'idle', fps: 0 })
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/health')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('GET / serves health endpoint', async () => {
    const port = getTestPort()
    const deps = createMockDeps()
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('GET /metrics returns Prometheus text format', async () => {
    const port = getTestPort()
    const deps = createMockDeps({ engineState: 'on-air', fps: 25, dropped: 3, totalFrames: 5000 })
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/metrics')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')

    expect(res.body).toContain('veles_playout_on_air 1')
    expect(res.body).toContain('veles_playout_fps 25')
    expect(res.body).toContain('veles_playout_dropped_frames_total 3')
    expect(res.body).toContain('veles_playout_frames_total 5000')
    expect(res.body).toContain('veles_playout_ws_clients 1')
    expect(res.body).toContain('veles_playout_uptime_seconds')
  })

  it('GET /unknown returns 404', async () => {
    const port = getTestPort()
    const deps = createMockDeps()
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/unknown')
    expect(res.status).toBe(404)
  })

  it('non-GET returns 405', async () => {
    const port = getTestPort()
    const deps = createMockDeps()
    server = new HealthServer(port, deps)
    server.start()
    await new Promise((r) => setTimeout(r, 100))

    const res = await httpGet(port, '/health', 'POST')
    expect(res.status).toBe(405)
  })

  it('stop() shuts down server', () => {
    const port = getTestPort()
    const deps = createMockDeps()
    server = new HealthServer(port, deps)
    server.start()
    server.stop()
    server = null
    // No error thrown = success
  })
})
