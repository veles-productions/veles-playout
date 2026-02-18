/**
 * WebSocket Control Server — receives commands from veles-studio.
 *
 * Protocol:
 * - Commands (studio → playout): load, update, play, stop, take, clear, freeze, setOutput, status
 * - Events (playout → studio): state, frameUpdate, error
 *
 * Listens on configurable port (default: 9900).
 */

import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { PlayoutEngine, type EngineSnapshot, type TemplatePayload } from './engine';
import { buildTemplateDoc } from './template/builder';
import { buildOGrafHostDoc, isOGrafTemplate as isOGraf } from './template/ograf';
import { generateTestSignal, type TestPattern } from './template/test-signals';
import { getConfig } from './config';
import { detectHardware } from './hardware';
import type { CaptureStats } from './capture';
import type { AsRunLog } from './as-run-log';

// ── Protocol Types ──

interface WsCommand {
  id?: string;
  type:
    | 'load'
    | 'update'
    | 'updatePgm'
    | 'play'
    | 'stop'
    | 'take'
    | 'clear'
    | 'freeze'
    | 'setOutput'
    | 'status'
    | 'testSignal'
    | 'getInfo'
    | 'auth';
  payload?: Record<string, unknown>;
}

interface WsEvent {
  type: 'state' | 'frameUpdate' | 'error' | 'ack' | 'info';
  id?: string;
  payload: unknown;
}

interface ClientInfo {
  id: string;
  ws: WebSocket;
  connectedAt: number;
  remoteAddress?: string;
}

export class WebSocketServer extends EventEmitter {
  private wss: WsServer | null = null;
  private clients = new Map<string, ClientInfo>();
  private engine: PlayoutEngine;
  private port: number;
  private authToken: string | null = null;
  private asRunLog: AsRunLog | null = null;

  constructor(engine: PlayoutEngine, port: number = 9900) {
    super();
    this.engine = engine;
    this.port = port;
  }

  /** Set an optional auth token — clients must send { type: "auth", token } as first message */
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /** Attach an as-run log instance for compliance logging */
  setAsRunLog(log: AsRunLog): void {
    this.asRunLog = log;
  }

  start(): void {
    this.wss = new WsServer({ port: this.port });
    console.log(`[WS] Control server listening on port ${this.port}`);

    this.wss.on('connection', (ws, req) => {
      const clientId = uuid();
      const clientInfo: ClientInfo = {
        id: clientId,
        ws,
        connectedAt: Date.now(),
        remoteAddress: req.socket.remoteAddress,
      };

      // Auth check: if token is set, validate from query string
      if (this.authToken) {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        if (token !== this.authToken) {
          console.warn(`[WS] Unauthorized client rejected from ${clientInfo.remoteAddress}`);
          ws.close(4401, 'Unauthorized');
          return;
        }
      }

      this.clients.set(clientId, clientInfo);
      console.log(`[WS] Client connected: ${clientId} from ${clientInfo.remoteAddress}`);
      this.emit('clientChange', {
        clientId,
        event: 'connected',
        remoteAddress: clientInfo.remoteAddress,
        totalClients: this.clients.size,
      });

      // Send current state on connect
      this.send(ws, {
        type: 'state',
        payload: this.engine.getSnapshot(),
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as WsCommand;
          this.handleCommand(clientId, message);
        } catch (err) {
          this.send(ws, {
            type: 'error',
            payload: { message: 'Invalid JSON message' },
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WS] Client disconnected: ${clientId}`);
        this.emit('clientChange', {
          clientId,
          event: 'disconnected',
          totalClients: this.clients.size,
        });
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error ${clientId}:`, err);
        this.clients.delete(clientId);
      });
    });

    this.wss.on('error', (err) => {
      console.error('[WS] Server error:', err);
    });
  }

  stop(): void {
    if (this.wss) {
      // Close all client connections
      for (const client of this.clients.values()) {
        try {
          client.ws.close(1001, 'Server shutting down');
        } catch {
          // ignore
        }
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
      console.log('[WS] Control server stopped');
    }
  }

  /** Broadcast state to all connected clients */
  broadcastState(snapshot: EngineSnapshot): void {
    this.broadcast({ type: 'state', payload: snapshot });
  }

  /** Broadcast frame stats to all connected clients */
  broadcastStats(stats: CaptureStats): void {
    this.broadcast({
      type: 'frameUpdate',
      payload: { fps: stats.fps, dropped: stats.dropped },
    });
  }

  /** Get number of connected clients */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Get connection info for all clients */
  getClients(): Array<{ id: string; remoteAddress?: string; connectedAt: number }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      remoteAddress: c.remoteAddress,
      connectedAt: c.connectedAt,
    }));
  }

  // ── Private ──

  private async handleCommand(clientId: string, command: WsCommand): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      switch (command.type) {
        case 'load': {
          const p = command.payload as Record<string, unknown> | undefined;
          if (!p) throw new Error('Missing payload for load');

          const payload: TemplatePayload = {
            templateHtml: (p.templateHtml as string) || '',
            templateCss: (p.templateCss as string) || '',
            variables: (p.variables as Record<string, string>) || {},
            isOGraf: (p.isOGraf as boolean) || false,
            ografManifest: (p.ografManifest as Record<string, unknown>) || undefined,
            templateId: (p.templateId as string) || '',
          };

          // Build the full HTML document
          let builtHtml: string;
          if (payload.isOGraf) {
            const cfg = getConfig();
            builtHtml = buildOGrafHostDoc(
              { is_ograf: true, ograf_manifest: payload.ografManifest },
              payload.variables || {},
              { autoPlay: false, width: cfg.resolution.width, height: cfg.resolution.height, frameRate: cfg.frameRate },
            );
          } else {
            builtHtml = buildTemplateDoc(payload);
          }

          // Replace templateHtml with the built document
          payload.templateHtml = builtHtml;
          await this.engine.load(payload);

          this.asRunLog?.write({
            event: 'load',
            templateId: payload.templateId,
            variables: payload.variables,
          });
          break;
        }

        case 'update': {
          const p = command.payload as Record<string, unknown> | undefined;
          const variables = (p?.variables as Record<string, string>) || {};
          await this.engine.update(variables);
          break;
        }

        case 'updatePgm': {
          const p = command.payload as Record<string, unknown> | undefined;
          const variables = (p?.variables as Record<string, string>) || {};
          await this.engine.updatePgm(variables);
          break;
        }

        case 'play':
          await this.engine.play();
          break;

        case 'stop':
          await this.engine.stop();
          break;

        case 'take': {
          const tp = command.payload as Record<string, unknown> | undefined;
          if (tp?.transition === 'mix') {
            const duration = (tp?.duration as number) || 500;
            await this.engine.takeMix(duration);
          } else {
            await this.engine.take();
          }
          break;
        }

        case 'clear':
          await this.engine.clear();
          break;

        case 'freeze':
          this.engine.freeze();
          break;

        case 'setOutput': {
          // Forward output config changes (handled in index.ts IPC)
          // This is a pass-through for remote configuration
          console.log('[WS] setOutput:', command.payload);
          break;
        }

        case 'testSignal': {
          const tp = command.payload as Record<string, unknown> | undefined;
          const pattern = (tp?.pattern as TestPattern) || 'smpte';
          const alpha = (tp?.alpha as boolean) || false;
          const html = generateTestSignal(pattern, alpha);
          const testPayload: TemplatePayload = {
            templateHtml: html,
            templateCss: '',
            variables: {},
            templateId: `test-signal:${pattern}`,
          };
          await this.engine.load(testPayload);
          break;
        }

        case 'getInfo': {
          const cfg = getConfig();
          const hw = detectHardware();
          this.send(client.ws, {
            type: 'info',
            payload: {
              version: app.getVersion(),
              resolution: cfg.resolution,
              frameRate: cfg.frameRate,
              sdi: hw.sdi,
              ndi: hw.ndi,
              displays: hw.displays,
            },
          });
          return; // Don't send ack for info requests
        }

        case 'status':
          this.send(client.ws, {
            type: 'state',
            payload: this.engine.getSnapshot(),
          });
          return; // Don't send ack for status requests

        case 'auth':
          // Auth is handled at connection time via query param.
          // This is a no-op for backward compatibility.
          break;
      }

      // Send acknowledgment
      if (command.id) {
        this.send(client.ws, {
          type: 'ack',
          id: command.id,
          payload: { success: true },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[WS] Command error (${command.type}):`, message);
      this.send(client.ws, {
        type: 'error',
        id: command.id,
        payload: { message },
      });
    }
  }

  private send(ws: WebSocket, event: WsEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  private broadcast(event: WsEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }
}
