import type { Ledger, Entry } from '@ledger/shared';
import EntryListItem from './EntryListItem.js';

interface Props {
  ledger: Ledger;
  entries: Entry[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function formatBalance(balance: number): string {
  const sign = balance >= 0 ? '+' : '';
  return `${sign}${balance.toFixed(2)}`;
}

export default function LedgerSection({ ledger, entries, isCollapsed, onToggleCollapse }: Props) {
  const totalCredits = entries
    .filter((e) => e.cat_direction === 'add')
    .reduce((sum, e) => sum + e.amount, 0);

  const isPositive = ledger.balance >= 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header row */}
      <button
        onClick={onToggleCollapse}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={!isCollapsed}
      >
        <span className="text-xl">{ledger.icon}</span>
        <span className="flex-1 font-semibold text-gray-900 dark:text-gray-100">
          {ledger.ledger_name}
        </span>
        <span
          className={`tabular-nums font-medium ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {formatBalance(ledger.balance)}
        </span>
        <span className="ml-1 text-gray-400 dark:text-gray-500">
          {isCollapsed ? '›' : '▾'}
        </span>
      </button>

      {/* Expanded content */}
      {!isCollapsed && (
        <>
          <div className="border-t border-gray-100 px-4 dark:border-gray-700">
            {entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No entries yet.
              </p>
            ) : (
              entries.map((entry) => (
                <EntryListItem key={entry.entry_id} entry={entry} />
              ))
            )}
          </div>

          {entries.length > 0 && (
            <div className="flex justify-end gap-4 border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <span>Total credits: {totalCredits.toFixed(2)}</span>
              <span
                className={`font-medium ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
              >
                Balance: {formatBalance(ledger.balance)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
