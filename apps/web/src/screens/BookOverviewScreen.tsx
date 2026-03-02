import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBookStore, useLedgerStore, useEntryStore } from '@ledger/stores';
import type { Ledger, Entry } from '@ledger/shared';
import LedgerSection from '../components/LedgerSection.js';
import ParserBar from '../components/ParserBar.js';
import BookSettingsModal from '../components/BookSettingsModal.js';
import LedgerSettingsModal from '../components/LedgerSettingsModal.js';
import EntryEditModal from '../components/EntryEditModal.js';

export default function BookOverviewScreen() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();
  const { currentBook, loading: bookLoading } = useBookStore();
  const {
    ledgers,
    collapsed,
    loading: ledgerLoading,
    error: ledgerError,
    createLedger,
    toggleLedgerCollapse,
  } = useLedgerStore();
  const { getEntriesForLedger } = useEntryStore();
  const [newLedgerName, setNewLedgerName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [parserOpen, setParserOpen] = useState(false);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [settingsLedger, setSettingsLedger] = useState<Ledger | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);

  useEffect(() => {
    if (bookId) {
      useBookStore.getState().openBook(bookId);
      useLedgerStore.getState().fetchLedgers(bookId);
      useEntryStore.getState().fetchEntriesForBook(bookId);
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
        {currentBook && (
          <button
            onClick={() => setBookSettingsOpen(true)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Book settings"
          >
            ⚙️
          </button>
        )}
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
              <LedgerSection
                key={ledger.ledger_id}
                ledger={ledger}
                entries={getEntriesForLedger(ledger.ledger_id)}
                isCollapsed={collapsed[ledger.ledger_id] ?? false}
                isBookClosed={currentBook?.is_closed === 1}
                onToggleCollapse={() => toggleLedgerCollapse(ledger.ledger_id)}
                onSettingsClick={() => setSettingsLedger(ledger)}
                onEditEntry={setEditingEntry}
              />
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

      {/* FAB: only visible when book is open */}
      {currentBook?.is_closed !== 1 && (
        <button
          onClick={() => setParserOpen(true)}
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-2xl text-white shadow-lg hover:bg-blue-700"
          aria-label="Add entry"
        >
          ✏️
        </button>
      )}

      {/* Parser overlay */}
      {parserOpen && bookId && (
        <ParserBar bookId={bookId} onClose={() => setParserOpen(false)} />
      )}

      {/* Book settings modal */}
      {bookSettingsOpen && currentBook && (
        <BookSettingsModal book={currentBook} onClose={() => setBookSettingsOpen(false)} />
      )}

      {/* Ledger settings modal */}
      {settingsLedger && (
        <LedgerSettingsModal
          ledger={settingsLedger}
          onClose={() => setSettingsLedger(null)}
        />
      )}

      {/* Entry edit modal */}
      {editingEntry && bookId && (
        <EntryEditModal
          entry={editingEntry}
          bookId={bookId}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
