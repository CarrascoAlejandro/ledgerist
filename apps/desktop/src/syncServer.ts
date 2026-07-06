/**
 * Main-process WebSocket relay for P2P sync (docs/sync/DESIGN.md §7).
 *
 * Deliberately dumb: it never parses frames and holds no keys — the sync
 * protocol and all encryption live in the renderer, which talks to this
 * relay over IPC. Only the main process can listen on a socket.
 */
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import crypto from 'crypto';

export const SYNC_PORT_BASE = 45680;
export const SYNC_PORT_MAX = 45689;
const MAX_PAYLOAD = 8 * 1024 * 1024;

export interface SyncServerInfo {
  running: boolean;
  port: number | null;
  addresses: string[];
}

export type RelayEvent =
  | { type: 'conn-opened'; connId: string; remoteAddress: string }
  | { type: 'frame'; connId: string; frame: Uint8Array }
  | { type: 'conn-closed'; connId: string; reason?: string };

/** IPv4, non-internal, private ranges first (most likely LAN-reachable). */
export function getLanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  const isPrivate = (ip: string) =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return addresses.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

function listenOn(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: '0.0.0.0',
      port,
      maxPayload: MAX_PAYLOAD,
    });
    server.once('listening', () => resolve(server));
    server.once('error', (err) => reject(err));
  });
}

export class SyncRelayServer {
  private server: WebSocketServer | null = null;
  private port: number | null = null;
  private conns = new Map<string, WebSocket>();
  private eventCb: ((ev: RelayEvent) => void) | null = null;

  onEvent(cb: (ev: RelayEvent) => void): void {
    this.eventCb = cb;
  }

  private emit(ev: RelayEvent): void {
    this.eventCb?.(ev);
  }

  info(): SyncServerInfo {
    return {
      running: this.server !== null,
      port: this.port,
      addresses: getLanAddresses(),
    };
  }

  /** Idempotent. Tries the base port, then the next free one in the range. */
  async start(preferredPort: number = SYNC_PORT_BASE): Promise<SyncServerInfo> {
    if (this.server) return this.info();

    let lastError: unknown = null;
    for (let port = preferredPort; port <= SYNC_PORT_MAX; port++) {
      try {
        this.server = await listenOn(port);
        this.port = port;
        break;
      } catch (err) {
        lastError = err;
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
      }
    }
    if (!this.server) {
      throw lastError ?? new Error('Could not bind sync server');
    }

    this.server.on('connection', (ws, req) => {
      const connId = crypto.randomUUID();
      this.conns.set(connId, ws);
      this.emit({
        type: 'conn-opened',
        connId,
        remoteAddress: req.socket.remoteAddress ?? 'unknown',
      });
      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const frame = Buffer.isBuffer(data)
          ? new Uint8Array(data)
          : Array.isArray(data)
            ? new Uint8Array(Buffer.concat(data))
            : new Uint8Array(data);
        this.emit({ type: 'frame', connId, frame });
      });
      ws.on('close', (_code, reason) => {
        this.conns.delete(connId);
        this.emit({ type: 'conn-closed', connId, reason: reason?.toString() || undefined });
      });
      ws.on('error', () => {
        // 'close' follows and performs cleanup.
      });
    });

    return this.info();
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const ws of this.conns.values()) {
      ws.terminate();
    }
    this.conns.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Resolves when the frame is flushed to the socket (backpressure). */
  send(connId: string, frame: Uint8Array): Promise<void> {
    const ws = this.conns.get(connId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Connection ${connId} is not open`));
    }
    return new Promise((resolve, reject) => {
      ws.send(frame, (err) => (err ? reject(err) : resolve()));
    });
  }

  closeConn(connId: string, reason?: string): void {
    const ws = this.conns.get(connId);
    if (ws) {
      ws.close(1000, reason?.slice(0, 120));
    }
  }

  closeAllConns(): void {
    for (const ws of this.conns.values()) {
      ws.terminate();
    }
    this.conns.clear();
  }
}
