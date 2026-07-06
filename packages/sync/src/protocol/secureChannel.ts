/**
 * Channel security (docs/sync/DESIGN.md §5.1): mutual HMAC challenge/response
 * authentication with the long-lived pairing key K, HKDF-derived per-session
 * AES-256-GCM keys (one per direction), counter-nonce frames.
 *
 * Frame layout after auth: [8-byte BE counter | AES-GCM ciphertext+tag].
 * IV = 4 zero bytes || counter. AAD = the counter header. Counters start at 1
 * and must strictly increase — replay and reordering are rejected before any
 * decryption is attempted.
 *
 * All crypto is WebCrypto (crypto.subtle) — available in browsers, the
 * Electron renderer, the Capacitor webview, and Node ≥ 20.
 */
import { decodeMessage, encodeMessage } from './codec.js';
import type { SyncErrorCode, SyncMessage } from './messages.js';
import { PROTOCOL_VERSION } from './messages.js';
import type { PeerChannel } from '../transport/types.js';

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type HandshakeErrorCode = SyncErrorCode | 'timeout' | 'closed';

export class HandshakeError extends Error {
  constructor(
    public code: HandshakeErrorCode,
    message?: string,
  ) {
    super(message ?? `Handshake failed: ${code}`);
  }
}

// ── Byte helpers ──────────────────────────────────────────────────────────

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const textEncoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export const b64u = {
  encode(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

// ── Crypto primitives (shared with pairing) ───────────────────────────────

export async function hmacSign(key: Uint8Array, ...parts: Uint8Array[]): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', k, concatBytes(...parts) as BufferSource);
  return new Uint8Array(mac);
}

export async function hmacVerify(
  key: Uint8Array,
  mac: Uint8Array,
  ...parts: Uint8Array[]
): Promise<boolean> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    k,
    mac as BufferSource,
    concatBytes(...parts) as BufferSource,
  );
}

export async function hkdfBits(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  byteLen: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    byteLen * 8,
  );
  return new Uint8Array(bits);
}

async function deriveAesKey(
  pairingKey: Uint8Array,
  nonceC: Uint8Array,
  nonceS: Uint8Array,
  direction: 'c2s' | 's2c',
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', pairingKey as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: concatBytes(nonceC, nonceS) as BufferSource,
      info: utf8(`ledger-sync-session-${direction}`) as BufferSource,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

// ── Handshake plumbing ────────────────────────────────────────────────────

class HandshakeReader {
  private queue: Uint8Array[] = [];
  private waiter: { resolve: (f: Uint8Array) => void; reject: (e: Error) => void } | null = null;
  private closedWith: Error | null = null;

  constructor(channel: PeerChannel, private timeoutMs: number) {
    channel.onFrame((frame) => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(frame);
      } else {
        this.queue.push(frame);
      }
    });
    channel.onClose((reason) => {
      this.closedWith = new HandshakeError('closed', reason);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.reject(this.closedWith);
      }
    });
  }

  async nextMessage(): Promise<SyncMessage> {
    const frame = await this.nextFrame();
    return decodeMessage(frame);
  }

  private async nextFrame(): Promise<Uint8Array> {
    if (this.queue.length > 0) return this.queue.shift()!;
    if (this.closedWith) throw this.closedWith;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new HandshakeError('timeout'));
      }, this.timeoutMs);
      this.waiter = {
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }
}

async function sendMessage(channel: PeerChannel, msg: SyncMessage): Promise<void> {
  await channel.send(encodeMessage(msg));
}

async function sendError(channel: PeerChannel, code: SyncErrorCode): Promise<void> {
  await sendMessage(channel, { type: 'error', code }).catch(() => undefined);
  await channel.close(code).catch(() => undefined);
}

function expectType<T extends SyncMessage['type']>(
  msg: SyncMessage,
  type: T,
): Extract<SyncMessage, { type: T }> {
  if (msg.type === 'error') {
    throw new HandshakeError(msg.code, msg.message);
  }
  if (msg.type !== type) {
    throw new HandshakeError('bad_message', `expected ${type}, got ${msg.type}`);
  }
  return msg as Extract<SyncMessage, { type: T }>;
}

// ── SecureChannel ─────────────────────────────────────────────────────────

/**
 * Decorator over an authenticated PeerChannel: every frame in either
 * direction is AES-256-GCM sealed with a strictly increasing counter.
 */
export class SecureChannel implements PeerChannel {
  private sendCounter = 0n;
  private lastReceived = 0n;
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private pendingPlaintext: Uint8Array[] = [];

  constructor(
    private inner: PeerChannel,
    private sendKey: CryptoKey,
    private receiveKey: CryptoKey,
  ) {
    this.inner.onFrame((frame) => {
      void this.receive(frame);
    });
  }

  private header(counter: bigint): Uint8Array {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, counter);
    return out;
  }

  private iv(header: Uint8Array): Uint8Array {
    const iv = new Uint8Array(12);
    iv.set(header, 4); // 4 zero bytes || 8-byte counter
    return iv;
  }

  async send(plaintext: Uint8Array): Promise<void> {
    this.sendCounter += 1n;
    const header = this.header(this.sendCounter);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: this.iv(header) as BufferSource,
        additionalData: header as BufferSource,
        tagLength: 128,
      },
      this.sendKey,
      plaintext as BufferSource,
    );
    await this.inner.send(concatBytes(header, new Uint8Array(ciphertext)));
  }

  private async receive(frame: Uint8Array): Promise<void> {
    try {
      if (frame.length < 9 || frame.length > MAX_FRAME_BYTES) {
        throw new HandshakeError('bad_message', 'bad frame size');
      }
      const header = frame.slice(0, 8);
      const counter = new DataView(header.buffer, header.byteOffset).getBigUint64(0);
      if (counter <= this.lastReceived) {
        throw new HandshakeError('bad_message', 'replayed or out-of-order frame');
      }
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: this.iv(header) as BufferSource,
          additionalData: header as BufferSource,
          tagLength: 128,
        },
        this.receiveKey,
        frame.slice(8) as BufferSource,
      );
      this.lastReceived = counter;
      const bytes = new Uint8Array(plaintext);
      if (this.frameCb) {
        this.frameCb(bytes);
      } else {
        this.pendingPlaintext.push(bytes);
      }
    } catch {
      // Tampered, replayed, or garbage frame — the channel is not trustworthy.
      await this.inner.close('auth_failed').catch(() => undefined);
    }
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.frameCb = cb;
    while (this.pendingPlaintext.length > 0) {
      cb(this.pendingPlaintext.shift()!);
    }
  }

  onClose(cb: (reason?: string) => void): void {
    this.inner.onClose(cb);
  }

  async close(reason?: string): Promise<void> {
    await this.inner.close(reason);
  }
}

// ── Handshake entry points ────────────────────────────────────────────────

export interface SecureConnectOptions {
  localDeviceId: string;
  pairingKey: Uint8Array;
  expectedPeerDeviceId: string;
  timeoutMs?: number;
}

/** Client side: hello → challenge → auth → auth_ok, then derive session keys. */
export async function secureConnect(
  channel: PeerChannel,
  opts: SecureConnectOptions,
): Promise<SecureChannel> {
  const reader = new HandshakeReader(channel, opts.timeoutMs ?? 15_000);
  const nonceC = randomBytes(16);

  await sendMessage(channel, {
    type: 'hello',
    v: PROTOCOL_VERSION,
    device_id: opts.localDeviceId,
    nonce: b64u.encode(nonceC),
  });

  const challenge = expectType(await reader.nextMessage(), 'challenge');
  if (challenge.device_id !== opts.expectedPeerDeviceId) {
    await sendError(channel, 'auth_failed');
    throw new HandshakeError('auth_failed', 'unexpected peer device id');
  }
  const nonceS = b64u.decode(challenge.nonce);

  const mac = await hmacSign(opts.pairingKey, utf8('auth-c'), nonceC, nonceS);
  await sendMessage(channel, { type: 'auth', mac: b64u.encode(mac) });

  const authOk = expectType(await reader.nextMessage(), 'auth_ok');
  const serverMacValid = await hmacVerify(
    opts.pairingKey,
    b64u.decode(authOk.mac),
    utf8('auth-s'),
    nonceS,
    nonceC,
  );
  if (!serverMacValid) {
    await sendError(channel, 'auth_failed');
    throw new HandshakeError('auth_failed', 'server MAC invalid');
  }

  return new SecureChannel(
    channel,
    await deriveAesKey(opts.pairingKey, nonceC, nonceS, 'c2s', 'encrypt'),
    await deriveAesKey(opts.pairingKey, nonceC, nonceS, 's2c', 'decrypt'),
  );
}

export interface SecureAcceptOptions {
  localDeviceId: string;
  lookupPairingKey(peerDeviceId: string): Promise<Uint8Array | null>;
  timeoutMs?: number;
  /** The already-received hello (the acceptor peeks the first frame to route). */
  hello?: Extract<SyncMessage, { type: 'hello' }>;
}

/** Server side of the handshake. */
export async function secureAccept(
  channel: PeerChannel,
  opts: SecureAcceptOptions,
): Promise<{ channel: SecureChannel; peerDeviceId: string }> {
  const reader = new HandshakeReader(channel, opts.timeoutMs ?? 15_000);
  const hello = opts.hello ?? expectType(await reader.nextMessage(), 'hello');

  if (hello.v !== PROTOCOL_VERSION) {
    await sendError(channel, 'protocol_version');
    throw new HandshakeError('protocol_version');
  }
  const pairingKey = await opts.lookupPairingKey(hello.device_id);
  if (!pairingKey) {
    await sendError(channel, 'unknown_peer');
    throw new HandshakeError('unknown_peer');
  }
  const nonceC = b64u.decode(hello.nonce);
  const nonceS = randomBytes(16);

  await sendMessage(channel, {
    type: 'challenge',
    device_id: opts.localDeviceId,
    nonce: b64u.encode(nonceS),
  });

  const auth = expectType(await reader.nextMessage(), 'auth');
  const clientMacValid = await hmacVerify(
    pairingKey,
    b64u.decode(auth.mac),
    utf8('auth-c'),
    nonceC,
    nonceS,
  );
  if (!clientMacValid) {
    await sendError(channel, 'auth_failed');
    throw new HandshakeError('auth_failed', 'client MAC invalid');
  }

  const mac = await hmacSign(pairingKey, utf8('auth-s'), nonceS, nonceC);
  await sendMessage(channel, { type: 'auth_ok', mac: b64u.encode(mac) });

  return {
    channel: new SecureChannel(
      channel,
      await deriveAesKey(pairingKey, nonceC, nonceS, 's2c', 'encrypt'),
      await deriveAesKey(pairingKey, nonceC, nonceS, 'c2s', 'decrypt'),
    ),
    peerDeviceId: hello.device_id,
  };
}
