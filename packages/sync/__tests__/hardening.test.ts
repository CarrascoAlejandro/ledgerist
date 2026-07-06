/**
 * @jest-environment node
 *
 * Phase 6e: bulk-persist window semantics and unpair/re-pair lifecycle.
 */
import { WebSocket as NodeWebSocket } from 'ws';
import { useBookStore, useLedgerStore } from '@ledger/stores';
import { createPairingOffer, runPairingJoin } from '../src/index.js';
import { createAcceptor, dialAndSync } from '../src/engine/sessionRunner.js';
import { getPeer, setPeerStatus } from '../src/engine/peers.js';
import { WsTransportClient } from '../src/transport/wsClient.js';
import type { WebSocketCtor } from '../src/transport/wsClient.js';
import { NodeWsServer } from './helpers/nodeWsServer.js';
import { createDevice, expectConverged, pairDevices, syncPair, withDevice } from './harness.js';

jest.setTimeout(30_000);

const wsCtor = NodeWebSocket as unknown as WebSocketCtor;

describe('bulk-persist window (WebDBConnection)', () => {
  it('defers persistence to one save per window, nests, and persists on close', async () => {
    const device = await createDevice('bulk');
    const conn = device.conn as unknown as {
      beginBulk(): void;
      endBulk(): Promise<void>;
      run(sql: string, params?: unknown[]): Promise<unknown>;
      close(): Promise<void>;
      persist: boolean;
      persistToDB: () => Promise<void>;
    };

    // The harness opens connections with persist=false; enable persistence
    // with a spyable serializer to count saves without IndexedDB.
    let saves = 0;
    conn.persist = true;
    conn.persistToDB = async () => {
      saves += 1;
    };

    await conn.run(`UPDATE sync_local SET device_name = 'a'`);
    expect(saves).toBe(1); // outside a bulk window: per-write persistence

    conn.beginBulk();
    conn.beginBulk(); // nested
    await conn.run(`UPDATE sync_local SET device_name = 'b'`);
    await conn.run(`UPDATE sync_local SET device_name = 'c'`);
    await conn.endBulk();
    expect(saves).toBe(1); // still deferred — inner end doesn't flush
    await conn.endBulk();
    expect(saves).toBe(2); // exactly one save for the whole window

    conn.beginBulk();
    await conn.endBulk();
    expect(saves).toBe(2); // clean window with no writes saves nothing

    conn.persist = false; // detach spy before harness close
    await device.conn.close();
  });

  it('a full loopback session persists once per side, not per batch', async () => {
    const a = await createDevice('bulkA');
    const b = await createDevice('bulkB');
    await pairDevices(a, b);

    await withDevice(a, async () => {
      const book = await useBookStore.getState().createBook({ name: 'Bulk' });
      await useLedgerStore
        .getState()
        .createLedger({ book_id: book.data!.book_id, ledger_name: 'Cash', icon: '💰' });
    });

    let savesOnB = 0;
    const bConn = b.conn as unknown as { persist: boolean; persistToDB: () => Promise<void> };
    bConn.persist = true;
    bConn.persistToDB = async () => {
      savesOnB += 1;
    };

    await syncPair(b, a);
    expect(savesOnB).toBe(1); // one bulk flush for the whole session

    bConn.persist = false;
    await a.conn.close();
    await b.conn.close();
  });
});

describe('unpair / re-pair lifecycle over real sockets', () => {
  it('unpaired peers are rejected; re-pairing resets the cursor and reconverges', async () => {
    const host = await createDevice('host');
    const joiner = await createDevice('joiner');
    const server = new NodeWsServer();
    const address = await server.start(0);
    const offerRef: { current: ReturnType<typeof createPairingOffer> | null } = { current: null };
    server.onConnection(
      createAcceptor({
        db: host.conn,
        hlc: host.ctx.hlc,
        local: { deviceId: host.deviceId, deviceName: 'host' },
        getActiveOffer: () => offerRef.current,
        onError: () => undefined,
      }),
    );

    // Pair and sync some data.
    offerRef.current = createPairingOffer(host.deviceId, address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner' },
      joiner.conn,
    );
    await new Promise((r) => setTimeout(r, 50));

    await withDevice(host, async () => {
      await useBookStore.getState().createBook({ name: 'Lifecycle' });
    });
    const deps = {
      db: joiner.conn,
      hlc: joiner.ctx.hlc,
      local: { deviceId: joiner.deviceId, deviceName: 'joiner' },
    };
    let peer = (await getPeer(joiner.conn, host.deviceId))!;
    await dialAndSync(new WsTransportClient(wsCtor), peer, deps);
    await expectConverged([host, joiner]);

    // Host unpairs the joiner → subsequent dial is rejected as unknown_peer.
    await setPeerStatus(host.conn, joiner.deviceId, 0);
    peer = (await getPeer(joiner.conn, host.deviceId))!;
    await expect(dialAndSync(new WsTransportClient(wsCtor), peer, deps)).rejects.toMatchObject({
      code: 'unknown_peer',
    });

    // Re-pair: fresh offer replaces the key and resets cursors on both sides.
    offerRef.current = createPairingOffer(host.deviceId, address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner' },
      joiner.conn,
    );
    await new Promise((r) => setTimeout(r, 50));

    const joinerPeer = (await getPeer(joiner.conn, host.deviceId))!;
    const hostPeer = (await getPeer(host.conn, joiner.deviceId))!;
    expect(joinerPeer.applied_through_seq).toBe(0); // cursor reset
    expect(hostPeer.applied_through_seq).toBe(0);
    expect(hostPeer.status).toBe(1);

    // New data on the host + cursor-0 full re-delivery still converge cleanly.
    await withDevice(host, async () => {
      await useBookStore.getState().createBook({ name: 'After re-pair' });
    });
    const result = await dialAndSync(new WsTransportClient(wsCtor), joinerPeer, deps);
    expect(result.conflicts).toBe(0); // re-delivered rows are idempotent skips
    await expectConverged([host, joiner]);

    await server.stop();
    await host.conn.close();
    await joiner.conn.close();
  });

  it('double-pairing the same two devices just refreshes the key', async () => {
    const host = await createDevice('host2');
    const joiner = await createDevice('joiner2');
    const server = new NodeWsServer();
    const address = await server.start(0);
    const offerRef: { current: ReturnType<typeof createPairingOffer> | null } = { current: null };
    server.onConnection(
      createAcceptor({
        db: host.conn,
        hlc: host.ctx.hlc,
        local: { deviceId: host.deviceId, deviceName: 'host2' },
        getActiveOffer: () => offerRef.current,
        onError: () => undefined,
      }),
    );

    offerRef.current = createPairingOffer(host.deviceId, address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner2' },
      joiner.conn,
    );
    await new Promise((r) => setTimeout(r, 50));
    const firstKey = (await getPeer(joiner.conn, host.deviceId))!.shared_key;

    offerRef.current = createPairingOffer(host.deviceId, address);
    await runPairingJoin(
      new WsTransportClient(wsCtor),
      offerRef.current.payloadString,
      { deviceId: joiner.deviceId, deviceName: 'joiner2' },
      joiner.conn,
    );
    await new Promise((r) => setTimeout(r, 50));

    const joinerPeer = (await getPeer(joiner.conn, host.deviceId))!;
    const hostPeer = (await getPeer(host.conn, joiner.deviceId))!;
    expect(joinerPeer.shared_key).not.toBe(firstKey); // fresh key
    expect(joinerPeer.shared_key).toBe(hostPeer.shared_key); // both sides agree

    // The fresh key authenticates.
    await withDevice(host, async () => {
      await useBookStore.getState().createBook({ name: 'Fresh key' });
    });
    await dialAndSync(new WsTransportClient(wsCtor), joinerPeer, {
      db: joiner.conn,
      hlc: joiner.ctx.hlc,
      local: { deviceId: joiner.deviceId, deviceName: 'joiner2' },
    });
    await expectConverged([host, joiner]);

    await server.stop();
    await host.conn.close();
    await joiner.conn.close();
  });
});
