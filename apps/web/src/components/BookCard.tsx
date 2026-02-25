import type { Book } from '@ledger/shared';

interface Props {
  book: Book & { ledger_count: number };
  onClick: () => void;
}

export default function BookCard({ book, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📒</span>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{book.name}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {book.ledger_count} ledger{book.ledger_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {book.is_closed === 1 && (
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            Closed
          </span>
        )}
      </div>
    </div>
  );
}
