import type { IDBConnection } from '@ledger/database';
import type { HLC } from '@ledger/shared';
import { decodeMessage, encodeMessage } from '../protocol/codec.js';
import type { SyncMessage, SyncMessageType, SyncedTable, WireRow } from '../protocol/messages.js';
import type { PeerChannel } from '../transport/types.js';
import { BATCH_SIZE, SYNC_TABLES, chunkRows, collectTableChanges, getMaxSeq, stampUnstampedRows } from './collector.js';
import { MergeSession } from './merge.js';
import { getPeer, updateAckedThroughSeq } from './peers.js';

export interface SyncEngineDeps {
  conn: IDBConnection;
  hlc: HLC;
  deviceId: string;
}

export interface SyncSessionResult {
  pulled: number;
  pushed: number;
  conflicts: number;
}

export type SyncPhase = 'pulling' | 'pushing' | 'done' | 'error';

export interface SyncProgressEvent {
  phase: SyncPhase;
  table?: SyncedTable;
  rows?: number;
}

class SessionClosedError extends Error {
  constructor(reason?: string) {
    super(`Sync session closed${reason ? `: ${reason}` : ''}`);
  }
}

/** Wraps a PeerChannel's callbacks into an awaitable, ordered message queue. */
class MessageReader {
  private queue: SyncMessage[] = [];
  private waiter: { resolve: (m: SyncMessage) => void; reject: (e: Error) => void } | null = null;
  private closedWith: Error | null = null;

  constructor(channel: PeerChannel) {
    channel.onFrame((frame) => {
      let msg: SyncMessage;
      try {
        msg = decodeMessage(frame);
      } catch (e) {
        this.fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
    channel.onClose((reason) => this.fail(new SessionClosedError(reason)));
  }

  private fail(error: Error): void {
    if (this.closedWith) return;
    this.closedWith = error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(error);
    }
  }

  async next(): Promise<SyncMessage> {
    if (this.queue.length > 0) return this.queue.shift()!;
    if (this.closedWith) throw this.closedWith;
    return new Promise<SyncMessage>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  async expect<T extends SyncMessageType>(type: T): Promise<Extract<SyncMessage, { type: T }>> {
    const msg = await this.next();
    if (msg.type === 'error') {
      throw new Error(`Peer error: ${msg.code}${msg.message ? ` (${msg.message})` : ''}`);
    }
    if (msg.type !== type) {
      throw new Error(`Protocol violation: expected ${type}, got ${msg.type}`);
    }
    return msg as Extract<SyncMessage, { type: T }>;
  }
}

/**
 * Runs sync sessions over a pre-authenticated PeerChannel (DESIGN §5.2).
 * The client pulls first, then pushes; the server mirrors. Cursor persistence
 * lives inside MergeSession.finalize — crash-safe at every message boundary.
 */
export class SyncEngine {
  private progressCb: ((e: SyncProgressEvent) => void) | null = null;

  constructor(private deps: SyncEngineDeps) {}

  onProgress(cb: (e: SyncProgressEvent) => void): void {
    this.progressCb = cb;
  }

  private emit(e: SyncProgressEvent): void {
    this.progressCb?.(e);
  }

  /** Dialing side: pull from the peer, then serve the peer's pull, then complete. */
  async initiate(channel: PeerChannel, peerDeviceId: string): Promise<SyncSessionResult> {
    const reader = new MessageReader(channel);
    try {
      const pull = await this.runPullHalf(channel, reader, peerDeviceId);
      const push = await this.runPushHalf(channel, reader, peerDeviceId);
      await this.send(channel, { type: 'sync_complete' });
      await channel.close();
      this.emit({ phase: 'done' });
      return { pulled: pull.applied, pushed: push, conflicts: pull.conflicts };
    } catch (e) {
      this.emit({ phase: 'error' });
      await channel.close().catch(() => undefined);
      throw e;
    }
  }

  /** Listening side: serve the client's pull, then pull ourselves, then await completion. */
  async respond(channel: PeerChannel, peerDeviceId: string): Promise<SyncSessionResult> {
    const reader = new MessageReader(channel);
    try {
      const pushed = await this.runPushHalf(channel, reader, peerDeviceId);
      const pull = await this.runPullHalf(channel, reader, peerDeviceId);
      await reader.expect('sync_complete');
      this.emit({ phase: 'done' });
      return { pulled: pull.applied, pushed, conflicts: pull.conflicts };
    } catch (e) {
      this.emit({ phase: 'error' });
      await channel.close().catch(() => undefined);
      throw e;
    }
  }

  private async send(channel: PeerChannel, msg: SyncMessage): Promise<void> {
    await channel.send(encodeMessage(msg));
  }

  /** Receive changes from the peer: sync_begin → apply batches → finalize → ack. */
  private async runPullHalf(
    channel: PeerChannel,
    reader: MessageReader,
    peerDeviceId: string,
  ): Promise<{ applied: number; conflicts: number }> {
    const { conn, hlc, deviceId } = this.deps;
    const peer = await getPeer(conn, peerDeviceId);
    if (!peer || peer.status !== 1) {
      throw new Error(`Unknown or unpaired peer: ${peerDeviceId}`);
    }
    this.emit({ phase: 'pulling' });
    await this.send(channel, { type: 'sync_begin', cursor: peer.applied_through_seq });

    const merge = new MergeSession(conn, hlc, deviceId, peerDeviceId, peer.acked_through_seq);
    for (;;) {
      const msg = await reader.next();
      if (msg.type === 'changes') {
        await merge.applyBatch(msg.table, msg.rows);
        this.emit({ phase: 'pulling', table: msg.table, rows: msg.rows.length });
      } else if (msg.type === 'changes_done') {
        const stats = await merge.finalize(msg.through_seq);
        await this.send(channel, { type: 'apply_ack', through_seq: msg.through_seq });
        return { applied: stats.applied, conflicts: stats.conflicts };
      } else if (msg.type === 'error') {
        throw new Error(`Peer error: ${msg.code}`);
      } else {
        throw new Error(`Protocol violation: expected changes/changes_done, got ${msg.type}`);
      }
    }
  }

  /** Serve the peer's pull: await sync_begin → snapshot → stream batches → await ack. */
  private async runPushHalf(
    channel: PeerChannel,
    reader: MessageReader,
    peerDeviceId: string,
  ): Promise<number> {
    const { conn, deviceId } = this.deps;
    const begin = await reader.expect('sync_begin');
    this.emit({ phase: 'pushing' });

    // Stamp any missed rows BEFORE snapshotting — the lazy stamp fires the
    // changelog trigger, which would otherwise push those rows past the
    // snapshot bound and out of this delta.
    await stampUnstampedRows(conn, deviceId);
    const snapshot = await getMaxSeq(conn);

    let sent = 0;
    for (const { table } of SYNC_TABLES) {
      const rows = await collectTableChanges(conn, table, begin.cursor, snapshot, peerDeviceId);
      for (const batch of chunkRows(rows as WireRow[], BATCH_SIZE)) {
        await this.send(channel, { type: 'changes', table, rows: batch });
        sent += batch.length;
        this.emit({ phase: 'pushing', table, rows: batch.length });
      }
    }
    await this.send(channel, { type: 'changes_done', through_seq: snapshot });
    await reader.expect('apply_ack');
    // The peer has now applied our log through `snapshot` — remember it so
    // the merge can distinguish concurrent edits from ordinary propagation.
    await updateAckedThroughSeq(conn, peerDeviceId, snapshot);
    return sent;
  }
}
