import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncStore } from '@ledger/stores';
import type { SyncPeer } from '@ledger/sync';
import PairDeviceModal from '../components/PairDeviceModal.js';
import ConflictLogModal from '../components/ConflictLogModal.js';
import ConfirmDialog from '../components/ConfirmDialog.js';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(`${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const cardClass =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800';

export default function SyncScreen() {
  const navigate = useNavigate();
  const {
    deviceId,
    deviceName,
    peers,
    serverStatus,
    sessionsByPeer,
    conflicts,
    unseenConflictCount,
    loading,
    error,
    loadSyncState,
    renameDevice,
    setServerEnabled,
    syncNow,
    syncAll,
    unpair,
    loadConflicts,
    markAllConflictsSeen,
  } = useSyncStore();

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [pairModal, setPairModal] = useState<'host' | 'join' | null>(null);
  const [conflictModal, setConflictModal] = useState(false);
  const [unpairTarget, setUnpairTarget] = useState<SyncPeer | null>(null);

  useEffect(() => {
    void useSyncStore.getState().loadSyncState();
  }, []);

  const canHost = serverStatus.supported;
  const canScan =
    typeof window !== 'undefined' &&
    Boolean(
      (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
    );

  async function handleOpenConflicts() {
    await loadConflicts();
    setConflictModal(true);
  }

  function handleCloseConflicts() {
    setConflictModal(false);
    void markAllConflictsSeen();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button onClick={() => navigate(-1)} className="text-sm text-blue-600 dark:text-blue-400">
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Device Sync</h1>
      </header>

      <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className="text-gray-500 dark:text-gray-400">Loading…</span>
          </div>
        )}
        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        )}

        {!loading && deviceId && (
          <>
            {unseenConflictCount > 0 && (
              <button
                onClick={() => void handleOpenConflicts()}
                className="rounded-md bg-amber-50 p-3 text-left text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
              >
                {unseenConflictCount} conflict{unseenConflictCount === 1 ? '' : 's'} resolved during
                sync — kept the newer version. Tap to review.
              </button>
            )}

            {/* This device */}
            <section className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                This device
              </h2>
              <div className="flex items-center gap-2">
                <input
                  value={nameDraft ?? deviceName ?? ''}
                  onChange={(e) => setNameDraft(e.target.value)}
                  aria-label="Device name"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                />
                {nameDraft !== null && nameDraft !== deviceName && (
                  <button
                    onClick={() => {
                      void renameDevice(nameDraft);
                      setNameDraft(null);
                    }}
                    className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Save
                  </button>
                )}
              </div>
              <p className="mt-2 truncate text-xs text-gray-400 dark:text-gray-500">{deviceId}</p>
            </section>

            {/* Server (desktop only) */}
            {canHost && (
              <section className={cardClass}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Sync server
                  </h2>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={serverStatus.enabled}
                      onChange={(e) => void setServerEnabled(e.target.checked)}
                    />
                    Enabled
                  </label>
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {serverStatus.running && serverStatus.port ? (
                    <>
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />
                      Listening on {serverStatus.addresses[0] ?? '…'}:{serverStatus.port}
                    </>
                  ) : (
                    <>
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-gray-400" />
                      Not listening — other devices cannot reach this one
                    </>
                  )}
                </p>
                {serverStatus.addresses.length > 1 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Other addresses: {serverStatus.addresses.slice(1).join(', ')}
                  </p>
                )}
              </section>
            )}

            {/* Paired devices */}
            <section className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Paired devices
                </h2>
                {peers.some((p) => p.last_address) && (
                  <button
                    onClick={() => void syncAll()}
                    className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Sync all
                  </button>
                )}
              </div>

              {peers.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  No paired devices yet.
                </p>
              )}

              <ul className="flex flex-col gap-3">
                {peers.map((peer) => {
                  const session = sessionsByPeer[peer.peer_device_id];
                  return (
                    <li
                      key={peer.peer_device_id}
                      className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3 last:border-b-0 last:pb-0 dark:border-gray-700"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                          {peer.peer_name}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Last synced {relativeTime(peer.last_synced_at)}
                        </p>
                        {session?.phase === 'done' && session.result && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            Pulled {session.result.pulled}, pushed {session.result.pushed}
                            {session.result.conflicts > 0 &&
                              `, ${session.result.conflicts} conflict${session.result.conflicts === 1 ? '' : 's'} resolved — kept newer version`}
                          </p>
                        )}
                        {session?.phase === 'error' && session.error && (
                          <p className="text-xs text-red-600 dark:text-red-400">{session.error}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {peer.last_address ? (
                          <button
                            onClick={() => void syncNow(peer.peer_device_id)}
                            disabled={
                              session?.phase === 'connecting' || session?.phase === 'syncing'
                            }
                            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {session?.phase === 'connecting' || session?.phase === 'syncing'
                              ? 'Syncing…'
                              : 'Sync now'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            syncs when it connects here
                          </span>
                        )}
                        <button
                          onClick={() => setUnpairTarget(peer)}
                          aria-label={`Unpair ${peer.peer_name}`}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => setPairModal(canHost ? 'host' : 'join')}
                className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Pair new device
              </button>
              {canHost && (
                <button
                  onClick={() => setPairModal('join')}
                  className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Join another desktop instead
                </button>
              )}
            </section>

            {/* Conflict history */}
            <section className={cardClass}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Conflict history
                </h2>
                <button
                  onClick={() => void handleOpenConflicts()}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  View log
                </button>
              </div>
            </section>
          </>
        )}
      </main>

      {pairModal && (
        <PairDeviceModal mode={pairModal} canScan={canScan} onClose={() => setPairModal(null)} />
      )}
      {conflictModal && (
        <ConflictLogModal conflicts={conflicts} onClose={handleCloseConflicts} />
      )}
      {unpairTarget && (
        <ConfirmDialog
          title={`Unpair ${unpairTarget.peer_name}?`}
          message="This device will stop syncing with it. Data already synced stays on both devices. You can pair again at any time."
          confirmLabel="Unpair"
          confirmVariant="danger"
          onConfirm={() => {
            void unpair(unpairTarget.peer_device_id);
            setUnpairTarget(null);
          }}
          onCancel={() => setUnpairTarget(null)}
        />
      )}
    </div>
  );
}
