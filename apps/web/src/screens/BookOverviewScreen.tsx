import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBookStore, useLedgerStore } from '@ledger/stores';
import LedgerCard from '../components/LedgerCard.js';

export default function BookOverviewScreen() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();
  const { currentBook, loading: bookLoading } = useBookStore();
  const { ledgers, loading: ledgerLoading, error: ledgerError, createLedger } = useLedgerStore();
  const [newLedgerName, setNewLedgerName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (bookId) {
      useBookStore.getState().openBook(bookId);
      useLedgerStore.getState().fetchLedgers(bookId);
    }
  }, [bookId]);

  const loading = bookLoading || ledgerLoading;

  async function handleCreateLedger() {
    if (!bookId) return;
    const result = await createLedger({ book_id: bookId, ledger_name: newLedgerName });
    if (result.success) {
      setNewLedgerName('');
      setCreateError(null);
    } else {
      setCreateError(result.error ?? 'Failed to create ledger');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-blue-600 dark:text-blue-400"
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {currentBook?.name ?? '…'}
          </h1>
          {currentBook?.is_closed === 1 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              Closed
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className="text-gray-500 dark:text-gray-400">Loading…</span>
          </div>
        )}

        {!loading && ledgers.length === 0 && (
          <p className="py-10 text-center text-gray-500 dark:text-gray-400">No ledgers yet.</p>
        )}

        {!loading && ledgers.length > 0 && (
          <div className="mb-6 flex flex-col gap-3">
            {ledgers.map((ledger) => (
              <LedgerCard key={ledger.ledger_id} ledger={ledger} />
            ))}
          </div>
        )}

        {currentBook?.is_closed !== 1 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">New Ledger</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newLedgerName}
                onChange={(e) => setNewLedgerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateLedger()}
                placeholder="Ledger name"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                onClick={handleCreateLedger}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Add Ledger
              </button>
            </div>
            {createError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{createError}</p>
            )}
            {ledgerError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{ledgerError}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
