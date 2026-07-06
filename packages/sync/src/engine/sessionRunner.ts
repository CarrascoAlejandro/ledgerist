/**
 * Glue between transports, pairing, crypto, and the SyncEngine.
 *
 * A listening device's socket receives BOTH pairing attempts and sync
 * sessions; the first plaintext frame discriminates: `pair_request` routes to
 * the pairing host flow, `hello` to the authenticated session flow.
 */
import type { IDBConnection } from '@ledger/database';
import type { HLC } from '@ledger/shared';
import { decodeMessage, encodeMessage } from '../protocol/codec.js';
import {
  HandshakeError,
  b64u,
  secureAccept,
  secureConnect,
} from '../protocol/secureChannel.js';
import type { PeerChannel, TransportClient } from '../transport/types.js';
import { SyncEngine } from './SyncEngine.js';
import type { SyncProgressEvent, SyncSessionResult } from './SyncEngine.js';
import type { PairingOffer } from './pairing.js';
import { runPairingHost } from './pairing.js';
import { getPeer } from './peers.js';
import type { SyncPeer } from './peers.js';

export interface RunnerDeps {
  db: IDBConnection;
  hlc: HLC;
  local: { deviceId: string; deviceName: string };
  getActiveOffer(): PairingOffer | null;
  onPaired?(peer: { peerDeviceId: string; peerName: string }): void;
  onSessionEvent?(peerDeviceId: string, ev: SyncProgressEvent): void;
  onSessionComplete?(peerDeviceId: string, result: SyncSessionResult): void;
  onError?(error: unknown): void;
}

async function lookupPairingKey(
  db: IDBConnection,
  peerDeviceId: string,
): Promise<Uint8Array | null> {
  const peer = await getPeer(db, peerDeviceId);
  if (!peer || peer.status !== 1) return null;
  return b64u.decode(peer.shared_key);
}

/**
 * Returns the TransportServer onConnection handler: peeks the first frame and
 * routes to pairing or an authenticated sync session.
 */
export function createAcceptor(deps: RunnerDeps): (channel: PeerChannel) => void {
  return (channel: PeerChannel) => {
    let routed = false;
    channel.onFrame((frame) => {
      if (routed) return; // subsequent frames are re-consumed by the routed flow
      routed = true;
      void routeFirstFrame(channel, frame, deps).catch((e) => deps.onError?.(e));
    });
  };
}

async function routeFirstFrame(
  channel: PeerChannel,
  frame: Uint8Array,
  deps: RunnerDeps,
): Promise<void> {
  let msg;
  try {
    msg = decodeMessage(frame);
  } catch {
    await channel.close('bad_message').catch(() => undefined);
    return;
  }

  if (msg.type === 'pair_request') {
    const paired = await runPairingHost(
      channel,
      msg,
      deps.getActiveOffer(),
      deps.local,
      deps.db,
    );
    deps.onPaired?.(paired);
    return;
  }

  if (msg.type === 'hello') {
    const { channel: secure, peerDeviceId } = await secureAccept(channel, {
      localDeviceId: deps.local.deviceId,
      lookupPairingKey: (id) => lookupPairingKey(deps.db, id),
      hello: msg,
    });
    const engine = new SyncEngine({
      conn: deps.db,
      hlc: deps.hlc,
      deviceId: deps.local.deviceId,
    });
    engine.onProgress((ev) => deps.onSessionEvent?.(peerDeviceId, ev));
    const result = await engine.respond(secure, peerDeviceId);
    deps.onSessionComplete?.(peerDeviceId, result);
    return;
  }

  await channel
    .send(encodeMessage({ type: 'error', code: 'bad_message' }))
    .catch(() => undefined);
  await channel.close('bad_message').catch(() => undefined);
}

/** Dial a peer's stored address, authenticate, and run a full session. */
export async function dialAndSync(
  client: TransportClient,
  peer: SyncPeer,
  deps: Pick<RunnerDeps, 'db' | 'hlc' | 'local' | 'onSessionEvent'>,
): Promise<SyncSessionResult> {
  if (!peer.last_address) {
    throw new HandshakeError('bad_message', 'Peer has no known address — it must dial us');
  }
  const raw = await client.connect(peer.last_address);
  const secure = await secureConnect(raw, {
    localDeviceId: deps.local.deviceId,
    pairingKey: b64u.decode(peer.shared_key),
    expectedPeerDeviceId: peer.peer_device_id,
  });
  const engine = new SyncEngine({
    conn: deps.db,
    hlc: deps.hlc,
    deviceId: deps.local.deviceId,
  });
  engine.onProgress((ev) => deps.onSessionEvent?.(peer.peer_device_id, ev));
  return engine.initiate(secure, peer.peer_device_id);
}
