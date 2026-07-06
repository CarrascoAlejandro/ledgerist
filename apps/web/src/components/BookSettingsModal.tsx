import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookStore, useLedgerStore } from '@ledger/stores';
import type { Book } from '@ledger/shared';
import ConfirmDialog from './ConfirmDialog.js';

interface Props {
  book: Book;
  onClose: () => void;
}

export default function BookSettingsModal({ book, onClose }: Props) {
  const navigate = useNavigate();
  const { renameBook, closeBook, reopenBook, setAutoOpenBook, forceRebalanceAndCloseBook, deleteBook } = useBookStore();
  // Use live book from store so is_auto_open stays fresh
  const liveBook = useBookStore((s) => s.books.find((b) => b.book_id === book.book_id) ?? book);
  const [name, setName] = useState(book.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [showRebalanceConfirm, setShowRebalanceConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  async function handleRename() {
    const result = await renameBook({ book_id: book.book_id, name });
    if (result.success) {
      setNameError(null);
    } else {
      setNameError(result.error ?? 'Failed to rename book');
    }
  }

  async function handleClose() {
    await closeBook(book.book_id);
    onClose();
  }

  async function handleReopen() {
    await reopenBook(book.book_id);
    setShowReopenConfirm(false);
    onClose();
  }

  async function handleToggleAutoOpen() {
    await setAutoOpenBook(book.book_id, liveBook.is_auto_open !== 1);
  }

  async function handleRebalance() {
    await forceRebalanceAndCloseBook(book.book_id);
    setShowRebalanceConfirm(false);
    onClose();
  }

  async function handleDelete() {
    await deleteBook(book.book_id);
    setShowDeleteConfirm(false);
    onClose();
    navigate('/');
  }

  // Preview adjustments for the rebalance confirm dialog
  const rebalancePreview = useLedgerStore
    .getState()
    .getLedgersForBook(book.book_id)
    .filter((l) => l.balance !== 0)
    .map((l) => ({
      name: l.ledger_name,
      amount: Math.abs(l.balance),
      direction: l.balance > 0 ? 'sub' : 'add',
    }));

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center">
        <div className="w-full max-w-sm rounded-t-xl bg-white p-6 shadow-xl dark:bg-gray-800 sm:rounded-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Book Settings
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>

          {/* Rename */}
          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Book Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                onClick={handleRename}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save
              </button>
            </div>
            {nameError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
            )}
          </div>

          {/* Auto-Open toggle */}
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={liveBook.is_auto_open === 1}
                onChange={handleToggleAutoOpen}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Auto-open on launch
              </span>
            </label>
            <p className="mt-1 pl-7 text-xs text-gray-400">
              Only one book can be auto-open at a time.
            </p>
          </div>

          {/* Close / Reopen */}
          <div className="mb-4 border-t border-gray-100 pt-4 dark:border-gray-700">
            {liveBook.is_closed === 0 ? (
              <button
                onClick={handleClose}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Close Book
              </button>
            ) : (
              <button
                onClick={() => setShowReopenConfirm(true)}
                className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Reopen Book
              </button>
            )}
          </div>

          {/* Force Rebalance & Close (only when book is open) */}
          {liveBook.is_closed === 0 && (
            <div className="mb-4">
              <button
                onClick={() => setShowRebalanceConfirm(true)}
                className="w-full rounded-md border border-orange-300 px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/20"
              >
                Force Rebalance &amp; Close
              </button>
            </div>
          )}

          {/* Danger Zone */}
          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Danger Zone
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete Book
            </button>
          </div>
        </div>
      </div>

      {showReopenConfirm && (
        <ConfirmDialog
          title="Reopen Book"
          message="This will restore full editing capability for this book. Continue?"
          confirmLabel="Reopen"
          confirmVariant="primary"
          onConfirm={handleReopen}
          onCancel={() => setShowReopenConfirm(false)}
        />
      )}

      {showRebalanceConfirm && (
        <ConfirmDialog
          title="Force Rebalance & Close"
          message={
            rebalancePreview.length > 0
              ? `This will insert adjustment entries for ${rebalancePreview.length} ledger${rebalancePreview.length !== 1 ? 's' : ''} (${rebalancePreview.map((a) => `${a.name}: ${a.direction === 'sub' ? '-' : '+'}${a.amount.toFixed(2)}`).join(', ')}) and close the book. Continue?`
              : 'All ledger balances are already zero. The book will be marked as balanced and closed. Continue?'
          }
          confirmLabel="Rebalance & Close"
          confirmVariant="danger"
          onConfirm={handleRebalance}
          onCancel={() => setShowRebalanceConfirm(false)}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Book"
          message="This will permanently delete this book and all its ledgers and entries. This action cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
