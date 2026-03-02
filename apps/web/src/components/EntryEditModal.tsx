import { useState } from 'react';
import { useEntryStore, useLedgerStore, useBookStore } from '@ledger/stores';
import type { Entry, EntryDirection } from '@ledger/shared';
import ConfirmDialog from './ConfirmDialog.js';

interface Props {
  entry: Entry;
  bookId: string;
  onClose: () => void;
}

function toDateInputValue(dateStr: string): string {
  // dateStr is already 'YYYY-MM-DD'
  return dateStr;
}

export default function EntryEditModal({ entry, bookId, onClose }: Props) {
  const { editEntry, deleteEntry, getTransferPair } = useEntryStore();
  const { getLedgersForBook } = useLedgerStore();
  const { currentBook } = useBookStore();

  const isClosed = currentBook?.is_closed === 1;
  const ledgers = getLedgersForBook(bookId);
  const transferPair = getTransferPair(entry.entry_id);

  const [date, setDate] = useState(toDateInputValue(entry.entry_date));
  const [amount, setAmount] = useState(String(entry.amount));
  const [direction, setDirection] = useState<EntryDirection>(entry.cat_direction);
  const [ledgerId, setLedgerId] = useState(entry.ledger_id);
  const [detail, setDetail] = useState(entry.detail ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  async function handleSave() {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setSaveError('Amount must be a positive number');
      return;
    }

    const result = await editEntry({
      entry_id: entry.entry_id,
      book_id: bookId,
      updates: {
        entry_date: date,
        amount: parsedAmount,
        cat_direction: direction,
        detail: detail.trim() === '' ? null : detail.trim(),
      },
    });

    if (result.success) {
      onClose();
    } else {
      setSaveError(result.error ?? 'Failed to save entry');
    }
  }

  async function handleDelete() {
    const result = await deleteEntry({ entry_id: entry.entry_id, book_id: bookId });
    if (result.success) {
      onClose();
    } else {
      setSaveError(result.error ?? 'Failed to delete entry');
      setShowDeleteConfirm(false);
    }
  }

  const deleteMessage = transferPair
    ? 'This will also delete the paired transfer entry. Continue?'
    : 'Delete this entry? This action cannot be undone.';

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center">
        <div className="w-full max-w-sm rounded-t-xl bg-white p-6 shadow-xl dark:bg-gray-800 sm:rounded-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {isClosed ? 'Entry Detail' : 'Edit Entry'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>

          {isClosed ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This book is closed. Entries are read-only.
            </p>
          ) : (
            <>
              {/* Date */}
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              {/* Amount + Direction */}
              <div className="mb-3 flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Direction
                  </label>
                  <div className="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
                    <button
                      onClick={() => setDirection('add')}
                      className={`px-3 py-2 text-sm font-medium ${direction === 'add' ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    >
                      +
                    </button>
                    <button
                      onClick={() => setDirection('sub')}
                      className={`px-3 py-2 text-sm font-medium ${direction === 'sub' ? 'bg-red-600 text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    >
                      −
                    </button>
                  </div>
                </div>
              </div>

              {/* Ledger */}
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Ledger
                </label>
                <select
                  value={ledgerId}
                  onChange={(e) => setLedgerId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {ledgers.map((l) => (
                    <option key={l.ledger_id} value={l.ledger_id}>
                      {l.icon} {l.ledger_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Detail */}
              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Detail
                </label>
                <input
                  type="text"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Optional description"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              {saveError && (
                <p className="mb-3 text-sm text-red-600 dark:text-red-400">{saveError}</p>
              )}

              <button
                onClick={handleSave}
                className="mb-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save Changes
              </button>

              {transferPair && (
                <p className="mb-2 text-xs text-blue-600 dark:text-blue-400">
                  Transfer entry — deleting will also remove the paired entry.
                </p>
              )}

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Delete Entry
              </button>
            </>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Entry"
          message={deleteMessage}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
