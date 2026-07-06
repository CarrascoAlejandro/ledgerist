import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookStore, useSettingsStore } from '@ledger/stores';
import type { Book } from '@ledger/shared';
import BookCard from '../components/BookCard.js';

type BookWithCount = Book & { ledger_count: number };

export default function DashboardScreen() {
  const navigate = useNavigate();
  const { books, loading, error, fetchBooks, createBook } = useBookStore();
  const [newBookName, setNewBookName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    useSettingsStore.getState().loadSettings();
    useBookStore.getState().fetchBooks().then(() => {
      const autoOpen = useBookStore.getState().getAutoOpenBook();
      if (autoOpen) {
        useBookStore.getState().openBook(autoOpen.book_id);
        navigate(`/book/${autoOpen.book_id}`);
      }
    });
  }, []);

  async function handleCreate() {
    // eslint-disable-next-line no-console
    console.info('[ui] create book clicked', {
      rawName: newBookName,
      trimmedName: newBookName.trim(),
      length: newBookName.length,
    });
    const result = await createBook({ name: newBookName });
    // eslint-disable-next-line no-console
    console.info('[ui] create book result', result);
    if (result.success) {
      setNewBookName('');
      setCreateError(null);
    } else {
      setCreateError(result.error ?? 'Failed to create book');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">My Books</h1>
        <button
          onClick={() => navigate('/settings')}
          className="text-2xl leading-none"
          aria-label="Settings"
        >
          ⚙️
        </button>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className="text-gray-500 dark:text-gray-400">Loading…</span>
          </div>
        )}

        {!loading && books.length === 0 && (
          <p className="py-10 text-center text-gray-500 dark:text-gray-400">
            No books yet. Create one to get started.
          </p>
        )}

        {!loading && books.length > 0 && (
          <div className="mb-6 flex flex-col gap-3">
            {books.map((book) => (
              <BookCard
                key={book.book_id}
                book={book as BookWithCount}
                onClick={() => navigate(`/book/${book.book_id}`)}
              />
            ))}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">New Book</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newBookName}
              onChange={(e) => setNewBookName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Book name"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              onClick={handleCreate}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create
            </button>
          </div>
          {createError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{createError}</p>
          )}
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </main>
    </div>
  );
}
