import type { PeerChannel, TransportClient } from './types.js';

/**
 * Minimal structural WebSocket type — works with the browser/webview global
 * and with `ws`'s WebSocket class in Node tests (injected constructor).
 */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

const OPEN = 1;

class WsPeerChannel implements PeerChannel {
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private closeCbs: Array<(reason?: string) => void> = [];
  private pending: Uint8Array[] = [];
  private closed = false;

  constructor(private ws: WebSocketLike) {
    ws.addEventListener('message', (event: { data: unknown }) => {
      let bytes: Uint8Array;
      if (event.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(event.data);
      } else if (ArrayBuffer.isView(event.data)) {
        const view = event.data as Uint8Array;
        bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      } else {
        // Text frames are not part of the protocol.
        void this.close('bad_message');
        return;
      }
      if (this.frameCb) {
        this.frameCb(bytes);
      } else {
        this.pending.push(bytes);
      }
    });
    ws.addEventListener('close', (event: { reason?: string }) => {
      this.fireClose(event.reason || undefined);
    });
    ws.addEventListener('error', () => {
      this.fireClose('socket error');
    });
  }

  private fireClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb(reason);
  }

  async send(frame: Uint8Array): Promise<void> {
    if (this.closed || this.ws.readyState !== OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.ws.send(frame);
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
}

export class WsTransportClient implements TransportClient {
  constructor(
    private WebSocketImpl: WebSocketCtor = (globalThis as { WebSocket?: WebSocketCtor })
      .WebSocket as WebSocketCtor,
    private openTimeoutMs = 10_000,
  ) {
    if (!this.WebSocketImpl) {
      throw new Error('No WebSocket implementation available');
    }
  }

  async connect(address: string): Promise<PeerChannel> {
    const ws = new this.WebSocketImpl(`ws://${address}`);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection to ${address} timed out`));
      }, this.openTimeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Could not connect to ${address}`));
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        reject(new Error(`Connection to ${address} closed during open`));
      });
    });
    return new WsPeerChannel(ws);
  }
}
