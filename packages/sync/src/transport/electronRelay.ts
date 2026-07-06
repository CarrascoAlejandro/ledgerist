/**
 * Renderer-side adapter: turns the Electron main process's dumb IPC frame
 * relay (apps/desktop/src/syncServer.ts, exposed via preload as
 * window.electronAPI.sync) into PeerChannel objects for the SyncEngine.
 *
 * IMPORTANT: window.electronAPI's global TYPE is already declared by
 * packages/database/src/drivers/electron-renderer.ts — access here goes
 * through a cast accessor instead of a second (conflicting) global merge.
 */
import type { PeerChannel, TransportServer } from './types.js';

export interface ElectronServerInfo {
  running: boolean;
  port: number | null;
  addresses: string[];
}

export interface ElectronSyncAPI {
  serverStart(): Promise<ElectronServerInfo>;
  serverStop(): Promise<ElectronServerInfo>;
  serverInfo(): Promise<ElectronServerInfo>;
  send(connId: string, frame: Uint8Array): Promise<void>;
  closeConn(connId: string, reason?: string): Promise<void>;
  onConnOpened(cb: (p: { connId: string; remoteAddress: string }) => void): () => void;
  onFrame(cb: (p: { connId: string; frame: Uint8Array }) => void): () => void;
  onConnClosed(cb: (p: { connId: string; reason?: string }) => void): () => void;
  onServerInfoChanged(cb: (p: ElectronServerInfo) => void): () => void;
}

export function getElectronSyncAPI(): ElectronSyncAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as { electronAPI?: { sync?: ElectronSyncAPI } }).electronAPI?.sync;
  return api ?? null;
}

class RelayPeerChannel implements PeerChannel {
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private closeCbs: Array<(reason?: string) => void> = [];
  private pending: Uint8Array[] = [];
  private closed = false;

  constructor(
    private api: ElectronSyncAPI,
    private connId: string,
  ) {}

  deliver(frame: Uint8Array): void {
    if (this.closed) return;
    if (this.frameCb) {
      this.frameCb(frame);
    } else {
      this.pending.push(frame);
    }
  }

  fireClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb(reason);
  }

  async send(frame: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Relay connection closed');
    await this.api.send(this.connId, frame); // awaited invoke = backpressure
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
    if (this.closed) return;
    this.fireClose(reason);
    await this.api.closeConn(this.connId, reason).catch(() => undefined);
  }
}

export class ElectronRelayServer implements TransportServer {
  private channels = new Map<string, RelayPeerChannel>();
  private connectionCb: ((channel: PeerChannel) => void) | null = null;
  private unsubscribers: Array<() => void> = [];
  private wired = false;

  constructor(private api: ElectronSyncAPI) {}

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.unsubscribers.push(
      this.api.onConnOpened(({ connId }) => {
        const channel = new RelayPeerChannel(this.api, connId);
        this.channels.set(connId, channel);
        this.connectionCb?.(channel);
      }),
      this.api.onFrame(({ connId, frame }) => {
        // Structured-clone may surface the bytes as ArrayBuffer or view.
        const bytes =
          frame instanceof Uint8Array ? frame : new Uint8Array(frame as ArrayBufferLike);
        this.channels.get(connId)?.deliver(bytes);
      }),
      this.api.onConnClosed(({ connId, reason }) => {
        this.channels.get(connId)?.fireClose(reason);
        this.channels.delete(connId);
      }),
    );
  }

  async start(_port: number): Promise<{ host: string; port: number }> {
    this.wire();
    const info = await this.api.serverStart();
    return { host: info.addresses[0] ?? '127.0.0.1', port: info.port ?? 0 };
  }

  onConnection(cb: (channel: PeerChannel) => void): void {
    this.wire();
    this.connectionCb = cb;
  }

  async stop(): Promise<void> {
    await this.api.serverStop();
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.wired = false;
    this.channels.clear();
  }
}
