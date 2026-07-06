import { create } from 'zustand';
import { getSyncContext } from '@ledger/shared';
import type { ActionResult } from '@ledger/shared';
import {
  ElectronRelayServer,
  HandshakeError,
  WsTransportClient,
  countUnseenConflicts,
  createAcceptor,
  createPairingOffer,
  dialAndSync,
  getElectronSyncAPI,
  getLocalDevice,
  listConflicts,
  listPeers,
  markConflictsSeen,
  renameDevice as renameDeviceQuery,
  runPairingJoin,
  setPeerStatus,
} from '@ledger/sync';
import type {
  ElectronSyncAPI,
  PairingOffer,
  SyncConflict,
  SyncPeer,
  SyncProgressEvent,
  SyncSessionResult,
} from '@ledger/sync';
import { getDB } from './db.js';
import { useBookStore } from './bookStore.js';
import { useLedgerStore } from './ledgerStore.js';
import { useEntryStore } from './entryStore.js';

const SERVER_ENABLED_KEY = 'ledger.sync.serverEnabled';

export interface SessionProgress {
  phase: 'idle' | 'connecting' | 'syncing' | 'done' | 'error';
  result: SyncSessionResult | null;
  error: string | null;
}

export interface ServerStatus {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  port: number | null;
  addresses: string[];
}

interface SyncState {
  deviceId: string | null;
  deviceName: string | null;
  peers: SyncPeer[];
  serverStatus: ServerStatus;
  sessionsByPeer: Record<string, SessionProgress>;
  conflicts: SyncConflict[];
  unseenConflictCount: number;
  pairing: {
    mode: 'host' | 'join' | null;
    payload: string | null;
    expiresAt: number | null;
    status: 'idle' | 'waiting' | 'success' | 'error';
    error: string | null;
  };
  loading: boolean;
  error: string | null;
}

interface SyncActions {
  loadSyncState(): Promise<void>;
  renameDevice(name: string): Promise<ActionResult>;
  setServerEnabled(enabled: boolean): Promise<ActionResult>;
  startPairingHost(): Promise<ActionResult<{ payload: string; expiresAt: number }>>;
  cancelPairing(): void;
  completePairingJoin(payload: string): Promise<ActionResult>;
  syncNow(peerDeviceId: string): Promise<ActionResult<SyncSessionResult>>;
  syncAll(): Promise<ActionResult>;
  unpair(peerDeviceId: string): Promise<ActionResult>;
  loadConflicts(): Promise<void>;
  markAllConflictsSeen(): Promise<ActionResult>;
}

// ── Module singletons (per renderer process) ──────────────────────────────

let relayServer: ElectronRelayServer | null = null;
let acceptorWired = false;
let activeOffer: PairingOffer | null = null;

function electronSyncAPI(): ElectronSyncAPI | null {
  return getElectronSyncAPI();
}

function serverEnabledPreference(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(SERVER_ENABLED_KEY) !== 'false';
}

function persistServerEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SERVER_ENABLED_KEY, String(enabled));
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof HandshakeError) {
    switch (e.code) {
      case 'pairing_expired':
        return 'Pairing code expired — ask the host device to show a new one.';
      case 'pairing_failed':
        return 'Pairing failed — check that the code was copied completely.';
      case 'unknown_peer':
        return 'This device no longer recognizes you — remove it or pair again.';
      case 'auth_failed':
        return 'Authentication failed — the pairing may be stale; try re-pairing.';
      case 'protocol_version':
        return 'The other device runs an incompatible app version — update both apps.';
      case 'timeout':
        return 'The other device did not respond in time.';
      default:
        return e.message;
    }
  }
  return String(e instanceof Error ? e.message : e);
}

/** After a sync applied remote data, refresh whatever the UI has loaded. */
async function refreshDataStores(): Promise<void> {
  await useBookStore.getState().fetchBooks();
  const bookId = useLedgerStore.getState().currentBook_id;
  if (bookId) {
    await useLedgerStore.getState().fetchLedgers(bookId);
    await useEntryStore.getState().fetchEntriesForBook(bookId);
  }
}

export const useSyncStore = create<SyncState & SyncActions>((set, get) => {
  function updateSession(peerId: string, progress: Partial<SessionProgress>): void {
    set((state) => {
      const current: SessionProgress = state.sessionsByPeer[peerId] ?? {
        phase: 'idle',
        result: null,
        error: null,
      };
      return {
        sessionsByPeer: {
          ...state.sessionsByPeer,
          [peerId]: { ...current, ...progress },
        },
      };
    });
  }

  async function refreshPeersAndConflicts(): Promise<void> {
    const db = getDB();
    const [peers, unseen] = await Promise.all([listPeers(db), countUnseenConflicts(db)]);
    set({ peers, unseenConflictCount: unseen });
  }

  function onSessionEvent(peerId: string, ev: SyncProgressEvent): void {
    if (ev.phase === 'pulling' || ev.phase === 'pushing') {
      updateSession(peerId, { phase: 'syncing' });
    } else if (ev.phase === 'error') {
      updateSession(peerId, { phase: 'error' });
    }
  }

  async function wireAcceptorOnce(): Promise<void> {
    const api = electronSyncAPI();
    if (!api || acceptorWired) return;
    acceptorWired = true;

    const db = getDB();
    const ctx = getSyncContext();
    const local = await getLocalDevice(db);
    relayServer = new ElectronRelayServer(api);

    relayServer.onConnection(
      createAcceptor({
        db,
        hlc: ctx.hlc,
        local: { deviceId: local.device_id, deviceName: local.device_name },
        getActiveOffer: () => activeOffer,
        onPaired: (peer) => {
          set((state) => ({
            pairing: { ...state.pairing, status: 'success' },
          }));
          void refreshPeersAndConflicts();
          void peer;
        },
        onSessionEvent,
        onSessionComplete: (peerId, result) => {
          updateSession(peerId, { phase: 'done', result });
          void refreshPeersAndConflicts();
          void refreshDataStores();
        },
        onError: () => {
          // Handshake failures from strangers are routine; nothing to surface.
        },
      }),
    );

    api.onServerInfoChanged((info) => {
      set((state) => ({
        serverStatus: { ...state.serverStatus, ...info },
      }));
    });

    // Reconcile the persisted toggle with main's auto-start.
    if (!serverEnabledPreference()) {
      await api.serverStop().catch(() => undefined);
    }
    const info = await api.serverInfo();
    set((state) => ({
      serverStatus: {
        ...state.serverStatus,
        supported: true,
        enabled: serverEnabledPreference(),
        ...info,
      },
    }));
  }

  return {
    deviceId: null,
    deviceName: null,
    peers: [],
    serverStatus: {
      supported: false,
      enabled: true,
      running: false,
      port: null,
      addresses: [],
    },
    sessionsByPeer: {},
    conflicts: [],
    unseenConflictCount: 0,
    pairing: { mode: null, payload: null, expiresAt: null, status: 'idle', error: null },
    loading: false,
    error: null,

    async loadSyncState() {
      set({ loading: true, error: null });
      try {
        const db = getDB();
        const local = await getLocalDevice(db);
        set({ deviceId: local.device_id, deviceName: local.device_name });
        await refreshPeersAndConflicts();
        await wireAcceptorOnce();
        set({ loading: false });
      } catch (e) {
        set({ loading: false, error: friendlyError(e) });
      }
    },

    async renameDevice(name) {
      const trimmed = name.trim();
      if (!trimmed) {
        return { success: false, error: 'Device name cannot be empty', code: 'VALIDATION_ERROR' };
      }
      try {
        await renameDeviceQuery(getDB(), trimmed);
        set({ deviceName: trimmed });
        return { success: true };
      } catch (e) {
        return { success: false, error: friendlyError(e), code: 'DATABASE_ERROR' };
      }
    },

    async setServerEnabled(enabled) {
      const api = electronSyncAPI();
      if (!api) {
        return { success: false, error: 'This device cannot host', code: 'PERMISSION_DENIED' };
      }
      try {
        persistServerEnabled(enabled);
        const info = enabled ? await api.serverStart() : await api.serverStop();
        set((state) => ({
          serverStatus: { ...state.serverStatus, ...info, enabled },
        }));
        return { success: true };
      } catch (e) {
        return { success: false, error: friendlyError(e), code: 'DATABASE_ERROR' };
      }
    },

    async startPairingHost() {
      const { deviceId } = get();
      const { serverStatus } = get();
      if (!deviceId || !serverStatus.running || serverStatus.port === null) {
        return {
          success: false,
          error: 'The sync server is not running',
          code: 'PERMISSION_DENIED',
        };
      }
      const host = serverStatus.addresses[0];
      if (!host) {
        return { success: false, error: 'No LAN address found', code: 'NOT_FOUND' };
      }
      activeOffer = createPairingOffer(deviceId, { host, port: serverStatus.port });
      set({
        pairing: {
          mode: 'host',
          payload: activeOffer.payloadString,
          expiresAt: activeOffer.expiresAt,
          status: 'waiting',
          error: null,
        },
      });
      return {
        success: true,
        data: { payload: activeOffer.payloadString, expiresAt: activeOffer.expiresAt },
      };
    },

    cancelPairing() {
      activeOffer?.cancel();
      activeOffer = null;
      set({
        pairing: { mode: null, payload: null, expiresAt: null, status: 'idle', error: null },
      });
    },

    async completePairingJoin(payload) {
      const { deviceId, deviceName } = get();
      if (!deviceId) {
        return { success: false, error: 'Sync state not loaded', code: 'DATABASE_ERROR' };
      }
      set((state) => ({
        pairing: { ...state.pairing, mode: 'join', status: 'waiting', error: null },
      }));
      try {
        await runPairingJoin(
          new WsTransportClient(),
          payload,
          { deviceId, deviceName: deviceName ?? 'Device' },
          getDB(),
        );
        set((state) => ({ pairing: { ...state.pairing, status: 'success' } }));
        await get().loadSyncState();
        return { success: true };
      } catch (e) {
        const message = friendlyError(e);
        set((state) => ({
          pairing: { ...state.pairing, status: 'error', error: message },
        }));
        return { success: false, error: message, code: 'CONFLICT' };
      }
    },

    async syncNow(peerDeviceId) {
      const peer = get().peers.find((p) => p.peer_device_id === peerDeviceId);
      if (!peer) {
        return { success: false, error: 'Unknown peer', code: 'NOT_FOUND' };
      }
      if (!peer.last_address) {
        return {
          success: false,
          error: 'This device must be reached by the other side — sync from there.',
          code: 'PERMISSION_DENIED',
        };
      }
      const { deviceId, deviceName } = get();
      updateSession(peerDeviceId, { phase: 'connecting', result: null, error: null });
      try {
        const ctx = getSyncContext();
        const result = await dialAndSync(new WsTransportClient(), peer, {
          db: getDB(),
          hlc: ctx.hlc,
          local: { deviceId: deviceId!, deviceName: deviceName ?? 'Device' },
          onSessionEvent,
        });
        updateSession(peerDeviceId, { phase: 'done', result, error: null });
        await refreshPeersAndConflicts();
        await refreshDataStores();
        return { success: true, data: result };
      } catch (e) {
        const message = friendlyError(e);
        updateSession(peerDeviceId, { phase: 'error', error: message });
        return { success: false, error: message, code: 'DATABASE_ERROR' };
      }
    },

    async syncAll() {
      const reachable = get().peers.filter((p) => p.last_address);
      for (const peer of reachable) {
        await get().syncNow(peer.peer_device_id);
      }
      return { success: true };
    },

    async unpair(peerDeviceId) {
      try {
        await setPeerStatus(getDB(), peerDeviceId, 0);
        await refreshPeersAndConflicts();
        return { success: true };
      } catch (e) {
        return { success: false, error: friendlyError(e), code: 'DATABASE_ERROR' };
      }
    },

    async loadConflicts() {
      try {
        const conflicts = await listConflicts(getDB());
        set({ conflicts });
      } catch (e) {
        set({ error: friendlyError(e) });
      }
    },

    async markAllConflictsSeen() {
      try {
        await markConflictsSeen(getDB());
        set({ unseenConflictCount: 0 });
        return { success: true };
      } catch (e) {
        return { success: false, error: friendlyError(e), code: 'DATABASE_ERROR' };
      }
    },
  };
});
