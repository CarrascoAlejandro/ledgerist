import { useState } from 'react';
import type { SyncConflict } from '@ledger/sync';

interface Props {
  conflicts: SyncConflict[];
  onClose: () => void;
}

const KIND_LABEL: Record<SyncConflict['kind'], string> = {
  lww: 'Concurrent edit',
  unique_name: 'Book name collision',
  unique_alias: 'Ledger alias collision',
  transfer_repair: 'Transfer repaired',
};

const KIND_BADGE: Record<SyncConflict['kind'], string> = {
  lww: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  unique_name: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  unique_alias: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  transfer_repair: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

function describeLoser(conflict: SyncConflict): string {
  try {
    const loser = JSON.parse(conflict.loser_snapshot) as Record<string, unknown>;
    const label =
      (loser.name as string) ??
      (loser.ledger_name as string) ??
      (loser.detail as string) ??
      (loser.alias as string) ??
      conflict.row_id;
    return String(label);
  } catch {
    return conflict.row_id;
  }
}

export default function ConflictLogModal({ conflicts, onClose }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
          Sync conflicts
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Conflicts are resolved automatically — the most recent change wins. The overwritten
          version is kept here for reference.
        </p>

        <div className="flex-1 overflow-y-auto">
          {conflicts.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No conflicts recorded.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {conflicts.map((c) => (
              <li
                key={c.conflict_id}
                className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_BADGE[c.kind]}`}
                  >
                    {KIND_LABEL[c.kind]}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{c.resolved_at}</span>
                </div>
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">{c.table_name}</span> · “{describeLoser(c)}” —{' '}
                  {c.winner === 'local' ? 'this device’s version won' : 'the newer remote version won'}
                </p>
                <button
                  onClick={() =>
                    setExpanded(expanded === c.conflict_id ? null : c.conflict_id)
                  }
                  className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  {expanded === c.conflict_id ? 'Hide overwritten data' : 'Show overwritten data'}
                </button>
                {expanded === c.conflict_id && (
                  <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                    {JSON.stringify(JSON.parse(c.loser_snapshot), null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
