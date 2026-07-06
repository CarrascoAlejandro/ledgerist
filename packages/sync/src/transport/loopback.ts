import type { PeerChannel } from './types.js';

/**
 * In-memory PeerChannel pair for tests. Frames are delivered asynchronously
 * (queueMicrotask) in order. `failAfterSends(n)` injects a connection drop:
 * the n-th send() closes both ends instead of delivering.
 */
export class LoopbackChannel implements PeerChannel {
  private twin: LoopbackChannel | null = null;
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private closeCbs: Array<(reason?: string) => void> = [];
  private closed = false;
  private sendsRemaining: number | null = null;
  private pending: Uint8Array[] = [];

  static pair(): [LoopbackChannel, LoopbackChannel] {
    const a = new LoopbackChannel();
    const b = new LoopbackChannel();
    a.twin = b;
    b.twin = a;
    return [a, b];
  }

  failAfterSends(n: number): void {
    this.sendsRemaining = n;
  }

  async send(frame: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error('Channel closed');
    }
    if (this.sendsRemaining !== null) {
      this.sendsRemaining -= 1;
      if (this.sendsRemaining < 0) {
        await this.close('injected failure');
        throw new Error('Channel closed (injected failure)');
      }
    }
    const twin = this.twin;
    if (!twin) throw new Error('Unpaired channel');
    const copy = frame.slice();
    queueMicrotask(() => twin.deliver(copy));
  }

  private deliver(frame: Uint8Array): void {
    if (this.closed) return;
    if (this.frameCb) {
      this.frameCb(frame);
    } else {
      this.pending.push(frame);
    }
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
    this.closed = true;
    for (const cb of this.closeCbs) cb(reason);
    // Close the twin too — a dropped connection is visible on both ends.
    if (this.twin && !this.twin.closed) {
      await this.twin.close(reason);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export function createLoopbackPair(): [LoopbackChannel, LoopbackChannel] {
  return LoopbackChannel.pair();
}
