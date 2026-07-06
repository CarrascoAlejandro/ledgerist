/**
 * @jest-environment node
 */
import {
  HandshakeError,
  SecureChannel,
  b64u,
  hkdfBits,
  hmacSign,
  hmacVerify,
  randomBytes,
  secureAccept,
  secureConnect,
  utf8,
} from '../src/protocol/secureChannel.js';
import { decodeMessage, encodeMessage } from '../src/protocol/codec.js';
import { createLoopbackPair } from '../src/transport/loopback.js';
import type { LoopbackChannel } from '../src/transport/loopback.js';
import type { SyncMessage } from '../src/protocol/messages.js';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const PAIRING_KEY = randomBytes(32);
const CLIENT_ID = 'client-device-0000';
const SERVER_ID = 'server-device-0000';

async function handshakePair(
  key: Uint8Array = PAIRING_KEY,
  serverKey: Uint8Array = key,
): Promise<{ client: SecureChannel; server: SecureChannel; raw: [LoopbackChannel, LoopbackChannel] }> {
  const [chC, chS] = createLoopbackPair();
  const [client, accepted] = await Promise.all([
    secureConnect(chC, {
      localDeviceId: CLIENT_ID,
      pairingKey: key,
      expectedPeerDeviceId: SERVER_ID,
    }),
    secureAccept(chS, {
      localDeviceId: SERVER_ID,
      lookupPairingKey: async () => serverKey,
    }),
  ]);
  return { client, server: accepted.channel, raw: [chC, chS] };
}

describe('crypto primitives', () => {
  it('HKDF-SHA256 matches RFC 5869 Test Case 1', async () => {
    const ikm = fromHex('0b'.repeat(22));
    const salt = fromHex('000102030405060708090a0b0c');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    const okm = await hkdfBits(ikm, salt, info, 42);
    expect(hex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('HMAC-SHA256 matches RFC 4231 Test Case 2', async () => {
    const key = utf8('Jefe');
    const data = utf8('what do ya want for nothing?');
    const mac = await hmacSign(key, data);
    expect(hex(mac)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(await hmacVerify(key, mac, data)).toBe(true);
    expect(await hmacVerify(key, mac, utf8('tampered'))).toBe(false);
  });

  it('b64u round-trips all byte lengths incl. padding edges', () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = randomBytes(len);
      const encoded = b64u.encode(bytes);
      expect(encoded).not.toMatch(/[+/=]/);
      expect(Array.from(b64u.decode(encoded))).toEqual(Array.from(bytes));
    }
  });
});

describe('handshake + encrypted channel', () => {
  it('completes mutual auth and round-trips messages both directions', async () => {
    const { client, server } = await handshakePair();
    const fromClient: SyncMessage[] = [];
    const fromServer: SyncMessage[] = [];
    server.onFrame((f) => fromClient.push(decodeMessage(f)));
    client.onFrame((f) => fromServer.push(decodeMessage(f)));

    await client.send(encodeMessage({ type: 'sync_begin', cursor: 7 }));
    await server.send(encodeMessage({ type: 'changes_done', through_seq: 42 }));
    await new Promise((r) => setTimeout(r, 10));

    expect(fromClient).toEqual([{ type: 'sync_begin', cursor: 7 }]);
    expect(fromServer).toEqual([{ type: 'changes_done', through_seq: 42 }]);
  });

  it('rejects a wrong pairing key with auth_failed', async () => {
    const [chC, chS] = createLoopbackPair();
    const results = await Promise.allSettled([
      secureConnect(chC, {
        localDeviceId: CLIENT_ID,
        pairingKey: randomBytes(32),
        expectedPeerDeviceId: SERVER_ID,
      }),
      secureAccept(chS, {
        localDeviceId: SERVER_ID,
        lookupPairingKey: async () => PAIRING_KEY,
      }),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const serverErr = (results[1] as PromiseRejectedResult).reason as HandshakeError;
    expect(serverErr.code).toBe('auth_failed');
  });

  it('rejects an unknown peer', async () => {
    const [chC, chS] = createLoopbackPair();
    const results = await Promise.allSettled([
      secureConnect(chC, {
        localDeviceId: CLIENT_ID,
        pairingKey: PAIRING_KEY,
        expectedPeerDeviceId: SERVER_ID,
      }),
      secureAccept(chS, {
        localDeviceId: SERVER_ID,
        lookupPairingKey: async () => null,
      }),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const clientErr = (results[0] as PromiseRejectedResult).reason as HandshakeError;
    expect(clientErr.code).toBe('unknown_peer');
  });

  it('rejects a protocol version mismatch', async () => {
    const [chC, chS] = createLoopbackPair();
    const acceptPromise = secureAccept(chS, {
      localDeviceId: SERVER_ID,
      lookupPairingKey: async () => PAIRING_KEY,
    });
    const clientReply = new Promise<SyncMessage>((resolve) => {
      chC.onFrame((f) => resolve(decodeMessage(f)));
    });
    await chC.send(
      encodeMessage({ type: 'hello', v: 2, device_id: CLIENT_ID, nonce: b64u.encode(randomBytes(16)) }),
    );
    await expect(acceptPromise).rejects.toMatchObject({ code: 'protocol_version' });
    expect(await clientReply).toEqual({ type: 'error', code: 'protocol_version' });
  });

  it('times out when the peer goes silent', async () => {
    const [chC] = createLoopbackPair();
    await expect(
      secureConnect(chC, {
        localDeviceId: CLIENT_ID,
        pairingKey: PAIRING_KEY,
        expectedPeerDeviceId: SERVER_ID,
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('frame protection', () => {
  async function tamperTest(
    mutate: (frame: Uint8Array) => Uint8Array | null,
  ): Promise<{ delivered: Uint8Array[]; closed: boolean }> {
    const [chC, chS] = createLoopbackPair();
    const [client, accepted] = await Promise.all([
      secureConnect(chC, {
        localDeviceId: CLIENT_ID,
        pairingKey: PAIRING_KEY,
        expectedPeerDeviceId: SERVER_ID,
      }),
      secureAccept(chS, {
        localDeviceId: SERVER_ID,
        lookupPairingKey: async () => PAIRING_KEY,
      }),
    ]);
    const server = accepted.channel;

    const delivered: Uint8Array[] = [];
    let closed = false;
    server.onFrame((f) => delivered.push(f));
    server.onClose(() => (closed = true));

    // Intercept the raw (encrypted) frames the client emits.
    const rawSend = chC.send.bind(chC);
    chC.send = async (frame: Uint8Array) => {
      const mutated = mutate(frame);
      if (mutated === null) return; // swallow
      return rawSend(mutated);
    };

    await client.send(encodeMessage({ type: 'sync_complete' })).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    return { delivered, closed };
  }

  it('rejects ciphertext tampering', async () => {
    const { delivered, closed } = await tamperTest((frame) => {
      const copy = frame.slice();
      copy[copy.length - 1] ^= 0xff;
      return copy;
    });
    expect(delivered).toHaveLength(0);
    expect(closed).toBe(true);
  });

  it('rejects counter-header tampering', async () => {
    const { delivered, closed } = await tamperTest((frame) => {
      const copy = frame.slice();
      copy[7] ^= 0x01; // still > lastReceived, but AAD/IV no longer match
      return copy;
    });
    expect(delivered).toHaveLength(0);
    expect(closed).toBe(true);
  });

  it('rejects replayed frames', async () => {
    const { client, server } = await handshakePair();
    const rawFrames: Uint8Array[] = [];
    const inner = (client as unknown as { inner: LoopbackChannel }).inner;
    const rawSend = inner.send.bind(inner);
    inner.send = async (frame: Uint8Array) => {
      rawFrames.push(frame.slice());
      return rawSend(frame);
    };

    const delivered: SyncMessage[] = [];
    let closed = false;
    server.onFrame((f) => delivered.push(decodeMessage(f)));
    server.onClose(() => (closed = true));

    await client.send(encodeMessage({ type: 'sync_complete' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toHaveLength(1);

    await rawSend(rawFrames[0]); // replay the same encrypted frame
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toHaveLength(1); // not delivered twice
    expect(closed).toBe(true); // channel condemned
  });

  it('cross-session replay fails (fresh nonces → different keys)', async () => {
    const first = await handshakePair();
    const captured: Uint8Array[] = [];
    const inner1 = (first.client as unknown as { inner: LoopbackChannel }).inner;
    const rawSend1 = inner1.send.bind(inner1);
    inner1.send = async (frame: Uint8Array) => {
      captured.push(frame.slice());
      return rawSend1(frame);
    };
    await first.client.send(encodeMessage({ type: 'sync_complete' }));
    await new Promise((r) => setTimeout(r, 10));

    const second = await handshakePair(); // same PAIRING_KEY, new nonces
    const delivered: Uint8Array[] = [];
    let closed = false;
    second.server.onFrame((f) => delivered.push(f));
    second.server.onClose(() => (closed = true));

    const inner2 = (second.client as unknown as { inner: LoopbackChannel }).inner;
    await inner2.send(captured[0]); // inject session-1 frame into session 2
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toHaveLength(0);
    expect(closed).toBe(true);
  });
});
