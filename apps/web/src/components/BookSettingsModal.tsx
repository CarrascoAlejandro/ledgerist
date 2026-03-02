import { useState } from 'react';
import { useBookStore } from '@ledger/stores';
import type { Book } from '@ledger/shared';
import ConfirmDialog from './ConfirmDialog.js';

interface Props {
  book: Book;
  onClose: () => void;
}

export default function BookSettingsModal({ book, onClose }: Props) {
  const { renameBook, closeBook, reopenBook } = useBookStore();
  const [name, setName] = useState(book.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);

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

          {/* Close / Reopen */}
          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            {book.is_closed === 0 ? (
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
    </>
  );
}
