/**
 * Transport seam (docs/sync/DESIGN.md §7). The engine only ever talks to a
 * PeerChannel; WebSocket, Electron IPC relay, in-memory loopback, and any
 * future Internet transport are interchangeable implementations.
 */

export interface PeerChannel {
  send(frame: Uint8Array): Promise<void>;
  onFrame(cb: (frame: Uint8Array) => void): void;
  onClose(cb: (reason?: string) => void): void;
  close(reason?: string): Promise<void>;
}

export interface TransportClient {
  connect(address: string): Promise<PeerChannel>;
}

export interface TransportServer {
  start(port: number): Promise<{ host: string; port: number }>;
  onConnection(cb: (channel: PeerChannel) => void): void;
  stop(): Promise<void>;
}
