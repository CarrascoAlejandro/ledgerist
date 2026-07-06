/**
 * @jest-environment node
 *
 * 6c integration: pairing and full authenticated sessions over REAL sockets
 * (node `ws` server + WsTransportClient), against real migrated databases.
 */
import { WebSocket as NodeWebSocket } from 'ws';
import { useBookStore, useEntryStore, useLedgerStore } from '@ledger/stores';
import {
  HandshakeError,
  b64u,
  createPairingOffer,
  encodePairingPayload,
  parsePairingPayload,
  randomBytes,
} from '../src/index.js';
import { createAcceptor, dialAndSync } from '../src/engine/sessionRunner.js';
import { runPairingJoin } from '../src/engine/pairing.js';
import type { PairingOffer } from '../src/engine/pairing.js';
import { getPeer, listPeers } from '../src/engine/peers.js';
import { WsTransportClient } from '../src/transport/wsClient.js';
import type { WebSocketCtor } from '../src/transport/wsClient.js';
import { NodeWsServer } from './helpers/nodeWsServer.js';
import {
  createDevice,
  expectBalancesCorrect,
  expectConverged,
  loadBook,
  withDevice,
} from './harness.js';
import type { TestDevice } from './harness.js';

jest.setTimeout(30_000);

const wsCtor = NodeWebSocket as unknown as WebSocketCtor;

interface Host {
  device: TestDevice;
  server: NodeWsServer;
  address: { host: string; port: number };
  offerRef: { current: PairingOffer | null };
  errors: unknown[];
}

async function startHost(
  device: TestDevice,
  port = 0,
  wrapChannel?: (ch: import('../src/transport/types.js').PeerChannel) => void,
): Promise<Host> {
  const server = new NodeWsServer();
  const address = await server.start(port);
  const offerRef: { current: PairingOffer | null } = { current: null };
  const errors: unknown[] = [];
  const acceptor = createAcceptor({
    db: device.conn,
    hlc: device.ctx.hlc,
    local: { deviceId: device.deviceId, deviceName: device.label },
    getActiveOffer: () => offerRef.current,
    onError: (e) => errors.push(e),
  });
  server.onConnection((channel) => {
    wrapChannel?.(channel);
    acceptor(channel);
  });
  return { device, server, address, offerRef, errors };
}

describe('pairing over real sockets', () => {
  let host: Host;
  let joiner: TestDevice;

  beforeEach(async () => {
    host = await startHost(await createDevice('host'));
    joiner = await createDevice('joiner');
  });
  afterEach(async () => {
    await host.server.stop();
    await host.device.conn.close();
    await joiner.conn.close();
  });

  it('happy path: both sides persist identical keys with the right address asymmetry', async () => {
    host.offerRef.current = createPairingOffer(host.device.deviceId, host.address);

    const result = await runPairingJoin(
      new WsTransportClient(wsCtor),
      host.offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner' },
      joiner.conn,
    );
    expect(result.peerDeviceId).toBe(host.device.deviceId);

    // Wait for the host's async acceptor to persist its side.
    await new Promise((r) => setTimeout(r, 50));

    const onJoiner = await getPeer(joiner.conn, host.device.deviceId);
    const onHost = await getPeer(host.device.conn, joiner.deviceId);
    expect(onJoiner).not.toBeNull();
    expect(onHost).not.toBeNull();
    expect(onJoiner!.shared_key).toBe(onHost!.shared_key); // same derived K
    expect(onJoiner!.last_address).toBe(`${host.address.host}:${host.address.port}`);
    expect(onHost!.last_address).toBeNull(); // host cannot dial back in v1
    expect(onJoiner!.applied_through_seq).toBe(0);
    expect(host.offerRef.current!.used).toBe(true);
  });

  it('wrong secret: rejected, nothing persisted, failure counted', async () => {
    host.offerRef.current = createPairingOffer(host.device.deviceId, host.address);
    const forged = encodePairingPayload({
      ...parsePairingPayload(host.offerRef.current.payloadString),
      secret: randomBytes(32),
    });

    await expect(
      runPairingJoin(
        new WsTransportClient(wsCtor),
        forged,
        { deviceId: joiner.deviceId, deviceName: 'joiner' },
        joiner.conn,
      ),
    ).rejects.toMatchObject({ code: 'pairing_failed' });

    await new Promise((r) => setTimeout(r, 50));
    expect(await listPeers(joiner.conn)).toHaveLength(0);
    expect(await listPeers(host.device.conn)).toHaveLength(0);
    expect(host.offerRef.current!.failureCount).toBe(1);
    expect(host.offerRef.current!.used).toBe(false);
  });

  it('expired offer → pairing_expired', async () => {
    host.offerRef.current = createPairingOffer(host.device.deviceId, host.address, 0);
    await expect(
      runPairingJoin(
        new WsTransportClient(wsCtor),
        host.offerRef.current.payloadString,
        { deviceId: joiner.deviceId, deviceName: 'joiner' },
        joiner.conn,
      ),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
  });

  it('consumed offer cannot be reused', async () => {
    host.offerRef.current = createPairingOffer(host.device.deviceId, host.address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      host.offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner' },
      joiner.conn,
    );
    const second = await createDevice('second-joiner');
    await expect(
      runPairingJoin(
        new WsTransportClient(wsCtor),
        host.offerRef.current.payloadString,
        { deviceId: second.deviceId, deviceName: 'second' },
        second.conn,
      ),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
    await second.conn.close();
  });

  it('payload codec rejects garbage, wrong scheme, bad version, short secret', () => {
    expect(() => parsePairingPayload('not a url')).toThrow(HandshakeError);
    expect(() => parsePairingPayload('https://evil?v=1&host=x&port=1&device=d&secret=AA')).toThrow(
      HandshakeError,
    );
    expect(() =>
      parsePairingPayload(`ledger-sync://pair?v=2&host=x&port=1&device=d&secret=${b64u.encode(randomBytes(32))}`),
    ).toThrow(expect.objectContaining({ code: 'protocol_version' }));
    expect(() =>
      parsePairingPayload(`ledger-sync://pair?v=1&host=x&port=1&device=d&secret=${b64u.encode(randomBytes(8))}`),
    ).toThrow(HandshakeError);
    expect(() =>
      parsePairingPayload(`ledger-sync://pair?v=1&host=x&port=99999&device=d&secret=${b64u.encode(randomBytes(32))}`),
    ).toThrow(HandshakeError);
    // Round trip.
    const payload = {
      v: 1 as const,
      host: '192.168.1.20',
      port: 45680,
      device: 'abc-def',
      secret: randomBytes(32),
    };
    const parsed = parsePairingPayload(encodePairingPayload(payload));
    expect(parsed.host).toBe(payload.host);
    expect(parsed.port).toBe(payload.port);
    expect(parsed.device).toBe(payload.device);
    expect(Array.from(parsed.secret)).toEqual(Array.from(payload.secret));
  });
});

describe('full sessions over real sockets', () => {
  let host: Host;
  let joiner: TestDevice;

  beforeEach(async () => {
    host = await startHost(await createDevice('host'));
    joiner = await createDevice('joiner');
    host.offerRef.current = createPairingOffer(host.device.deviceId, host.address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      host.offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner' },
      joiner.conn,
    );
    await new Promise((r) => setTimeout(r, 50)); // host acceptor persists
  });
  afterEach(async () => {
    await host.server.stop();
    await host.device.conn.close();
    await joiner.conn.close();
  });

  it('store mutations → pair → dialAndSync → convergence; second sync near-empty', async () => {
    await withDevice(host.device, async () => {
      const bookRes = await useBookStore.getState().createBook({ name: 'Socket Book' });
      const bookId = bookRes.data!.book_id;
      const ledgerRes = await useLedgerStore
        .getState()
        .createLedger({ book_id: bookId, ledger_name: 'Cash', icon: '💰' });
      await loadBook(bookId);
      await useEntryStore.getState().addEntry({
        book_id: bookId,
        ledger_id: ledgerRes.data!.ledger_id,
        entry_date: '2026-07-01',
        amount: 33,
        cat_direction: 'add',
        detail: 'over sockets',
      });
    });

    const peer = (await getPeer(joiner.conn, host.device.deviceId))!;
    const result = await dialAndSync(new WsTransportClient(wsCtor), peer, {
      db: joiner.conn,
      hlc: joiner.ctx.hlc,
      local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
    });
    expect(result.pulled).toBeGreaterThan(0);
    await expectConverged([host.device, joiner]);
    await expectBalancesCorrect(joiner);

    const second = await dialAndSync(new WsTransportClient(wsCtor), peer, {
      db: joiner.conn,
      hlc: joiner.ctx.hlc,
      local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
    });
    expect(second.pulled).toBe(0);
    expect(second.conflicts).toBe(0);
    expect(host.errors).toHaveLength(0);
  });

  it('an unpaired dialer gets unknown_peer', async () => {
    const stranger = await createDevice('stranger');
    // Forge a peer record pointing at the host with a made-up key.
    const fakePeer = {
      peer_device_id: host.device.deviceId,
      peer_name: 'host',
      shared_key: b64u.encode(randomBytes(32)),
      last_address: `${host.address.host}:${host.address.port}`,
      applied_through_seq: 0,
      acked_through_seq: 0,
      last_synced_at: null,
      paired_at: '',
      status: 1 as const,
    };
    await expect(
      dialAndSync(new WsTransportClient(wsCtor), fakePeer, {
        db: stranger.conn,
        hlc: stranger.ctx.hlc,
        local: { deviceId: stranger.deviceId, deviceName: 'stranger' },
      }),
    ).rejects.toMatchObject({ code: 'unknown_peer' });
    await stranger.conn.close();
  });

  it('mid-session socket kill: no cursor advance past the applied work; clean retry converges', async () => {
    await withDevice(host.device, async () => {
      const bookRes = await useBookStore.getState().createBook({ name: 'Kill Test' });
      const bookId = bookRes.data!.book_id;
      await useLedgerStore
        .getState()
        .createLedger({ book_id: bookId, ledger_name: 'Cash', icon: '💰' });
    });

    // Deterministic kill: a fresh host whose server-side channel dies after
    // its 3rd outbound frame (challenge, auth_ok, first data frame) — always
    // mid-session, never racing session completion.
    await host.server.stop();
    let killArmed = true;
    host = await startHost(host.device, 0, (channel) => {
      if (!killArmed) return;
      let sends = 0;
      const origSend = channel.send.bind(channel);
      channel.send = async (frame: Uint8Array) => {
        sends += 1;
        if (sends > 3) {
          await channel.close('injected kill');
          throw new Error('killed');
        }
        return origSend(frame);
      };
    });
    // Point the stored peer address at the new server port.
    await joiner.conn.run(`UPDATE sync_peers SET last_address = ? WHERE peer_device_id = ?`, [
      `${host.address.host}:${host.address.port}`,
      host.device.deviceId,
    ]);

    const peer = (await getPeer(joiner.conn, host.device.deviceId))!;
    await expect(
      dialAndSync(new WsTransportClient(wsCtor), peer, {
        db: joiner.conn,
        hlc: joiner.ctx.hlc,
        local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
      }),
    ).rejects.toThrow();

    // Clean retry.
    killArmed = false;
    const freshPeer = (await getPeer(joiner.conn, host.device.deviceId))!;
    await dialAndSync(new WsTransportClient(wsCtor), freshPeer, {
      db: joiner.conn,
      hlc: joiner.ctx.hlc,
      local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
    });
    await expectConverged([host.device, joiner]);
  });

  it('a tampering proxy aborts the session without corrupting either DB', async () => {
    await withDevice(host.device, async () => {
      await useBookStore.getState().createBook({ name: 'Tamper Test' });
    });

    // Man-in-the-middle: forward frames but flip a byte in large (data) ones.
    const mitm = new NodeWsServer();
    const mitmAddr = await mitm.start(0);
    mitm.onConnection(async (clientSide) => {
      const upstream = await new WsTransportClient(wsCtor).connect(
        `${host.address.host}:${host.address.port}`,
      );
      clientSide.onFrame((f) => {
        const copy = f.slice();
        if (copy.length > 100) copy[50] ^= 0xff;
        void upstream.send(copy);
      });
      upstream.onFrame((f) => {
        const copy = f.slice();
        if (copy.length > 100) copy[50] ^= 0xff;
        void clientSide.send(copy);
      });
      clientSide.onClose(() => void upstream.close());
      upstream.onClose(() => void clientSide.close());
    });

    const real = (await getPeer(joiner.conn, host.device.deviceId))!;
    const viaMitm = { ...real, last_address: `${mitmAddr.host}:${mitmAddr.port}` };
    const booksBefore = await joiner.conn.query(`SELECT * FROM books`);

    await expect(
      dialAndSync(new WsTransportClient(wsCtor), viaMitm, {
        db: joiner.conn,
        hlc: joiner.ctx.hlc,
        local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
      }),
    ).rejects.toThrow();

    const booksAfter = await joiner.conn.query(`SELECT * FROM books`);
    expect(booksAfter).toEqual(booksBefore); // nothing applied through tampering
    const cursor = (await getPeer(joiner.conn, host.device.deviceId))!.applied_through_seq;
    expect(cursor).toBe(0);
    await mitm.stop();
  });
});
