/**
 * First-time pairing (docs/sync/DESIGN.md §4): the host shows a QR / copyable
 * string carrying host:port + a 32-byte ephemeral secret; the joiner connects
 * and both sides prove knowledge of the secret via HMAC, then derive the
 * long-lived pairing key K with HKDF and persist a sync_peers row.
 */
import type { IDBConnection } from '@ledger/database';
import { decodeMessage, encodeMessage } from '../protocol/codec.js';
import type { SyncMessage } from '../protocol/messages.js';
import {
  HandshakeError,
  b64u,
  hkdfBits,
  hmacSign,
  hmacVerify,
  randomBytes,
  utf8,
} from '../protocol/secureChannel.js';
import type { PeerChannel, TransportClient } from '../transport/types.js';
import { upsertPeer } from './peers.js';

export const PAIRING_SCHEME = 'ledger-sync://pair';
export const PAIRING_TTL_MS = 120_000;
export const PAIRING_MAX_FAILURES = 5;
const SECRET_BYTES = 32;

export interface PairingPayload {
  v: 1;
  host: string;
  port: number;
  device: string;
  secret: Uint8Array;
}

export function encodePairingPayload(p: PairingPayload): string {
  const params = new URLSearchParams({
    v: String(p.v),
    host: p.host,
    port: String(p.port),
    device: p.device,
    secret: b64u.encode(p.secret),
  });
  return `${PAIRING_SCHEME}?${params.toString()}`;
}

/** Manual '?'-split — custom schemes parse inconsistently via `new URL`. */
export function parsePairingPayload(s: string): PairingPayload {
  const trimmed = s.trim();
  const qIndex = trimmed.indexOf('?');
  if (qIndex === -1 || trimmed.slice(0, qIndex) !== PAIRING_SCHEME) {
    throw new HandshakeError('bad_message', 'Not a ledger-sync pairing code');
  }
  const params = new URLSearchParams(trimmed.slice(qIndex + 1));
  const v = params.get('v');
  if (v !== '1') {
    throw new HandshakeError('protocol_version', 'Unsupported pairing code version');
  }
  const host = params.get('host');
  const portStr = params.get('port');
  const device = params.get('device');
  const secretStr = params.get('secret');
  if (!host || !portStr || !device || !secretStr) {
    throw new HandshakeError('bad_message', 'Pairing code is missing fields');
  }
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HandshakeError('bad_message', 'Pairing code has an invalid port');
  }
  const secret = b64u.decode(secretStr);
  if (secret.length !== SECRET_BYTES) {
    throw new HandshakeError('bad_message', 'Pairing code has an invalid secret');
  }
  return { v: 1, host, port, device, secret };
}

/** K = HKDF(secret, salt='ledger-sync-v1', info=sorted device ids). */
export async function derivePairingKey(
  secret: Uint8Array,
  deviceIdA: string,
  deviceIdB: string,
): Promise<Uint8Array> {
  const info = [deviceIdA, deviceIdB].sort().join('');
  return hkdfBits(secret, utf8('ledger-sync-v1'), utf8(info), 32);
}

// ── Host side ─────────────────────────────────────────────────────────────

export interface PairingOffer {
  payloadString: string;
  secret: Uint8Array;
  hostDeviceId: string;
  expiresAt: number;
  used: boolean;
  failureCount: number;
  cancelled: boolean;
  cancel(): void;
}

export function createPairingOffer(
  hostDeviceId: string,
  addr: { host: string; port: number },
  ttlMs: number = PAIRING_TTL_MS,
): PairingOffer {
  const secret = randomBytes(SECRET_BYTES);
  const offer: PairingOffer = {
    payloadString: encodePairingPayload({
      v: 1,
      host: addr.host,
      port: addr.port,
      device: hostDeviceId,
      secret,
    }),
    secret,
    hostDeviceId,
    expiresAt: Date.now() + ttlMs,
    used: false,
    failureCount: 0,
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  };
  return offer;
}

function offerIsLive(offer: PairingOffer): boolean {
  return (
    !offer.used &&
    !offer.cancelled &&
    offer.failureCount < PAIRING_MAX_FAILURES &&
    Date.now() <= offer.expiresAt
  );
}

async function sendAndClose(channel: PeerChannel, msg: SyncMessage, reason: string): Promise<void> {
  await channel.send(encodeMessage(msg)).catch(() => undefined);
  await channel.close(reason).catch(() => undefined);
}

/**
 * Handle an inbound pair_request against the active offer. On success both
 * sides hold the same K; the host stores last_address = NULL (it cannot dial
 * a phone or browser back in v1).
 */
export async function runPairingHost(
  channel: PeerChannel,
  firstMsg: Extract<SyncMessage, { type: 'pair_request' }>,
  offer: PairingOffer | null,
  local: { deviceId: string; deviceName: string },
  db: IDBConnection,
): Promise<{ peerDeviceId: string; peerName: string }> {
  if (!offer || !offerIsLive(offer)) {
    await sendAndClose(channel, { type: 'error', code: 'pairing_expired' }, 'pairing_expired');
    throw new HandshakeError('pairing_expired');
  }

  const proofValid = await hmacVerify(
    offer.secret,
    b64u.decode(firstMsg.proof),
    utf8('pair-v1'),
    utf8(firstMsg.device_id),
    utf8(local.deviceId),
  );
  if (!proofValid) {
    offer.failureCount += 1;
    await sendAndClose(channel, { type: 'error', code: 'pairing_failed' }, 'pairing_failed');
    throw new HandshakeError('pairing_failed');
  }

  const proof = await hmacSign(
    offer.secret,
    utf8('pair-v1'),
    utf8(local.deviceId),
    utf8(firstMsg.device_id),
  );
  await channel.send(
    encodeMessage({
      type: 'pair_accept',
      device_id: local.deviceId,
      device_name: local.deviceName,
      proof: b64u.encode(proof),
    }),
  );

  const key = await derivePairingKey(offer.secret, local.deviceId, firstMsg.device_id);
  await upsertPeer(db, {
    peer_device_id: firstMsg.device_id,
    peer_name: firstMsg.device_name,
    shared_key: b64u.encode(key),
    last_address: null,
  });
  offer.used = true;
  await channel.close('paired').catch(() => undefined);
  return { peerDeviceId: firstMsg.device_id, peerName: firstMsg.device_name };
}

// ── Joiner side ───────────────────────────────────────────────────────────

export async function runPairingJoin(
  client: TransportClient,
  payloadString: string,
  local: { deviceId: string; deviceName: string },
  db: IDBConnection,
  timeoutMs = 15_000,
): Promise<{ peerDeviceId: string; peerName: string; address: string }> {
  const payload = parsePairingPayload(payloadString);
  const address = `${payload.host}:${payload.port}`;
  const channel = await client.connect(address);

  try {
    const proof = await hmacSign(
      payload.secret,
      utf8('pair-v1'),
      utf8(local.deviceId),
      utf8(payload.device),
    );
    await channel.send(
      encodeMessage({
        type: 'pair_request',
        device_id: local.deviceId,
        device_name: local.deviceName,
        proof: b64u.encode(proof),
      }),
    );

    const reply = await new Promise<SyncMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new HandshakeError('timeout')), timeoutMs);
      channel.onFrame((frame) => {
        clearTimeout(timer);
        try {
          resolve(decodeMessage(frame));
        } catch (e) {
          reject(e);
        }
      });
      channel.onClose((reason) => {
        clearTimeout(timer);
        reject(new HandshakeError('closed', reason));
      });
    });

    if (reply.type === 'error') {
      throw new HandshakeError(reply.code, reply.message);
    }
    if (reply.type !== 'pair_accept') {
      throw new HandshakeError('bad_message', `expected pair_accept, got ${reply.type}`);
    }
    if (reply.device_id !== payload.device) {
      throw new HandshakeError('pairing_failed', 'host device id mismatch');
    }

    const hostProofValid = await hmacVerify(
      payload.secret,
      b64u.decode(reply.proof),
      utf8('pair-v1'),
      utf8(payload.device),
      utf8(local.deviceId),
    );
    if (!hostProofValid) {
      throw new HandshakeError('pairing_failed', 'host proof invalid');
    }

    const key = await derivePairingKey(payload.secret, local.deviceId, payload.device);
    await upsertPeer(db, {
      peer_device_id: payload.device,
      peer_name: reply.device_name,
      shared_key: b64u.encode(key),
      last_address: address,
    });
    return { peerDeviceId: payload.device, peerName: reply.device_name, address };
  } finally {
    await channel.close().catch(() => undefined);
  }
}
