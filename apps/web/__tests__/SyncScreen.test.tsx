import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useSyncStore } from '@ledger/stores';
import type { SyncPeer } from '@ledger/sync';
import SyncScreen from '../src/screens/SyncScreen.js';

function makePeer(overrides: Partial<SyncPeer> = {}): SyncPeer {
  return {
    peer_device_id: 'peer-1',
    peer_name: 'Alejandro’s Phone',
    shared_key: 'key',
    last_address: '192.168.1.30:45680',
    applied_through_seq: 10,
    acked_through_seq: 8,
    last_synced_at: null,
    paired_at: '2026-07-01 10:00:00',
    status: 1,
    ...overrides,
  };
}

function primeStore(overrides: Record<string, unknown> = {}) {
  useSyncStore.setState({
    deviceId: 'device-uuid-1234',
    deviceName: 'Desktop',
    peers: [],
    serverStatus: { supported: false, enabled: true, running: false, port: null, addresses: [] },
    sessionsByPeer: {},
    conflicts: [],
    unseenConflictCount: 0,
    pairing: { mode: null, payload: null, expiresAt: null, status: 'idle', error: null },
    loading: false,
    error: null,
    loadSyncState: jest.fn().mockResolvedValue(undefined),
    renameDevice: jest.fn().mockResolvedValue({ success: true }),
    setServerEnabled: jest.fn().mockResolvedValue({ success: true }),
    startPairingHost: jest.fn().mockResolvedValue({ success: true }),
    cancelPairing: jest.fn(),
    completePairingJoin: jest.fn().mockResolvedValue({ success: true }),
    syncNow: jest.fn().mockResolvedValue({ success: true }),
    syncAll: jest.fn().mockResolvedValue({ success: true }),
    unpair: jest.fn().mockResolvedValue({ success: true }),
    loadConflicts: jest.fn().mockResolvedValue(undefined),
    markAllConflictsSeen: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as never);
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <SyncScreen />
    </MemoryRouter>,
  );
}

describe('SyncScreen', () => {
  it('loads sync state on mount and shows device identity', () => {
    primeStore();
    renderScreen();
    expect(useSyncStore.getState().loadSyncState).toHaveBeenCalled();
    expect(screen.getByDisplayValue('Desktop')).toBeInTheDocument();
    expect(screen.getByText('device-uuid-1234')).toBeInTheDocument();
  });

  it('hides the server card on devices that cannot host', () => {
    primeStore();
    renderScreen();
    expect(screen.queryByText('Sync server')).not.toBeInTheDocument();
  });

  it('shows the server card with address when hosting', () => {
    primeStore({
      serverStatus: {
        supported: true,
        enabled: true,
        running: true,
        port: 45680,
        addresses: ['192.168.1.20', '10.0.0.5'],
      },
    });
    renderScreen();
    expect(screen.getByText('Sync server')).toBeInTheDocument();
    expect(screen.getByText(/Listening on 192\.168\.1\.20:45680/)).toBeInTheDocument();
    expect(screen.getByText(/Other addresses: 10\.0\.0\.5/)).toBeInTheDocument();
  });

  it('renders peers with relative last-synced and dispatches syncNow', async () => {
    const user = userEvent.setup();
    const syncNow = jest.fn().mockResolvedValue({ success: true });
    primeStore({ peers: [makePeer()], syncNow });
    renderScreen();

    expect(screen.getByText('Alejandro’s Phone')).toBeInTheDocument();
    expect(screen.getByText('Last synced never')).toBeInTheDocument();
    await user.click(screen.getByText('Sync now'));
    expect(syncNow).toHaveBeenCalledWith('peer-1');
  });

  it('marks unreachable peers instead of offering Sync now', () => {
    primeStore({ peers: [makePeer({ last_address: null })] });
    renderScreen();
    expect(screen.queryByText('Sync now')).not.toBeInTheDocument();
    expect(screen.getByText('syncs when it connects here')).toBeInTheDocument();
  });

  it('shows session results after a sync', () => {
    primeStore({
      peers: [makePeer()],
      sessionsByPeer: {
        'peer-1': {
          phase: 'done',
          result: { pulled: 12, pushed: 3, conflicts: 1 },
          error: null,
        },
      },
    });
    renderScreen();
    expect(
      screen.getByText(/Pulled 12, pushed 3, 1 conflict resolved — kept newer version/),
    ).toBeInTheDocument();
  });

  it('surfaces the unseen-conflicts banner and opens the log', async () => {
    const user = userEvent.setup();
    const loadConflicts = jest.fn().mockResolvedValue(undefined);
    primeStore({ unseenConflictCount: 2, loadConflicts });
    renderScreen();

    const banner = screen.getByText(/2 conflicts resolved during sync/);
    await user.click(banner);
    expect(loadConflicts).toHaveBeenCalled();
    expect(screen.getByText('Sync conflicts')).toBeInTheDocument();
  });

  it('unpairs via the confirm dialog', async () => {
    const user = userEvent.setup();
    const unpair = jest.fn().mockResolvedValue({ success: true });
    primeStore({ peers: [makePeer()], unpair });
    renderScreen();

    await user.click(screen.getByLabelText('Unpair Alejandro’s Phone'));
    expect(screen.getByText('Unpair Alejandro’s Phone?')).toBeInTheDocument();
    await user.click(screen.getByText('Unpair'));
    expect(unpair).toHaveBeenCalledWith('peer-1');
  });

  it('saves a renamed device', async () => {
    const user = userEvent.setup();
    const renameDevice = jest.fn().mockResolvedValue({ success: true });
    primeStore({ renameDevice });
    renderScreen();

    const input = screen.getByLabelText('Device name');
    await user.clear(input);
    await user.type(input, 'Living-room PC');
    await user.click(screen.getByText('Save'));
    expect(renameDevice).toHaveBeenCalledWith('Living-room PC');
  });
});
