/**
 * Node `ws`-based TransportServer for integration tests. Deliberately mirrors
 * the semantics of apps/desktop/src/syncServer.ts (one PeerChannel per
 * connection, binary frames, close propagation) so it doubles as that relay's
 * reference implementation.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { PeerChannel, TransportServer } from '../../src/transport/types.js';

class NodeWsPeerChannel implements PeerChannel {
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private closeCbs: Array<(reason?: string) => void> = [];
  private pending: Uint8Array[] = [];
  private closed = false;

  constructor(private ws: WebSocket) {
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : Array.isArray(data)
          ? new Uint8Array(Buffer.concat(data))
          : new Uint8Array(data);
      if (this.frameCb) {
        this.frameCb(bytes);
      } else {
        this.pending.push(bytes);
      }
    });
    ws.on('close', (_code, reason) => this.fireClose(reason?.toString() || undefined));
    ws.on('error', () => this.fireClose('socket error'));
  }

  private fireClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb(reason);
  }

  async send(frame: Uint8Array): Promise<void> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Connection is not open');
    }
    await new Promise<void>((resolve, reject) => {
      this.ws.send(frame, (err) => (err ? reject(err) : resolve()));
    });
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.frameCb = cb;
    while (this.pending.length > 0 && !this.closed) {
      cb(this.pending.shift()!);
    }
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCbs.push(cb);
  }

  async close(reason?: string): Promise<void> {
    if (!this.closed) {
      this.ws.close(1000, reason?.slice(0, 120));
      this.fireClose(reason);
    }
  }

  /** Test hook: hard-kill the socket without a close handshake. */
  terminate(): void {
    this.ws.terminate();
  }
}

export class NodeWsServer implements TransportServer {
  private server: WebSocketServer | null = null;
  private connectionCb: ((channel: PeerChannel) => void) | null = null;
  readonly channels: NodeWsPeerChannel[] = [];

  async start(port: number): Promise<{ host: string; port: number }> {
    this.server = await new Promise<WebSocketServer>((resolve, reject) => {
      const s = new WebSocketServer({
        host: '127.0.0.1',
        port,
        maxPayload: 8 * 1024 * 1024,
      });
      s.once('listening', () => resolve(s));
      s.once('error', reject);
    });
    this.server.on('connection', (ws) => {
      const channel = new NodeWsPeerChannel(ws);
      this.channels.push(channel);
      this.connectionCb?.(channel);
    });
    const addr = this.server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    return { host: '127.0.0.1', port: boundPort };
  }

  onConnection(cb: (channel: PeerChannel) => void): void {
    this.connectionCb = cb;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const client of this.server.clients) {
      client.terminate();
    }
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
