/**
 * HTTP Health Endpoint for broadcast monitoring systems.
 *
 * Returns JSON with engine state, FPS, uptime, connected clients.
 * Compatible with Nagios, Zabbix, Prometheus (via json_exporter), UptimeRobot.
 *
 * GET /health → 200 { status, engine, fps, dropped, uptime, clients, version }
 * GET /metrics → 200 Prometheus text format (basic)
 */

import * as http from 'http';
import { app } from 'electron';
import type { PlayoutEngine, EngineState } from './engine';
import type { FrameCapture, CaptureStats } from './capture';
import type { WebSocketServer } from './ws-server';

interface HealthDeps {
  engine: PlayoutEngine;
  capture: FrameCapture;
  wsServer: WebSocketServer;
}

export class HealthServer {
  private server: http.Server | null = null;
  private port: number;
  private deps: HealthDeps;
  private startedAt: number;

  constructor(port: number, deps: HealthDeps) {
    this.port = port;
    this.deps = deps;
    this.startedAt = Date.now();
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${this.port}`);

      if (url.pathname === '/health' || url.pathname === '/') {
        this.handleHealth(res);
      } else if (url.pathname === '/metrics') {
        this.handleMetrics(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[Health] HTTP health endpoint on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.warn(`[Health] Server error:`, err);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    const engineState = this.deps.engine.getState();
    const stats = this.deps.capture.getStats();
    const uptimeMs = Date.now() - this.startedAt;

    const isOnAir = engineState === 'on-air' || engineState === 'frozen';

    const body = JSON.stringify({
      status: isOnAir ? 'on-air' : 'ok',
      engine: engineState,
      fps: stats.fps,
      dropped: stats.dropped,
      totalFrames: stats.totalFrames,
      uptime: Math.floor(uptimeMs / 1000),
      clients: this.deps.wsServer.getClientCount(),
      version: app.getVersion(),
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  }

  private handleMetrics(res: http.ServerResponse): void {
    const engineState = this.deps.engine.getState();
    const stats = this.deps.capture.getStats();
    const uptimeMs = Date.now() - this.startedAt;
    const isOnAir = engineState === 'on-air' || engineState === 'frozen' ? 1 : 0;

    const lines = [
      '# HELP veles_playout_on_air Whether playout is currently on air',
      '# TYPE veles_playout_on_air gauge',
      `veles_playout_on_air ${isOnAir}`,
      '# HELP veles_playout_fps Current frames per second',
      '# TYPE veles_playout_fps gauge',
      `veles_playout_fps ${stats.fps}`,
      '# HELP veles_playout_dropped_frames_total Total dropped frames',
      '# TYPE veles_playout_dropped_frames_total counter',
      `veles_playout_dropped_frames_total ${stats.dropped}`,
      '# HELP veles_playout_frames_total Total rendered frames',
      '# TYPE veles_playout_frames_total counter',
      `veles_playout_frames_total ${stats.totalFrames}`,
      '# HELP veles_playout_uptime_seconds Playout uptime in seconds',
      '# TYPE veles_playout_uptime_seconds gauge',
      `veles_playout_uptime_seconds ${Math.floor(uptimeMs / 1000)}`,
      '# HELP veles_playout_ws_clients Connected WebSocket clients',
      '# TYPE veles_playout_ws_clients gauge',
      `veles_playout_ws_clients ${this.deps.wsServer.getClientCount()}`,
      '',
    ];

    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(lines.join('\n'));
  }
}
