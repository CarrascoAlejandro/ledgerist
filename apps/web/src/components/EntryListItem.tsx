import React from 'react';
import type { Entry } from '@ledger/shared';

interface Props {
  entry: Entry;
  onClick?: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EntryListItem({ entry, onClick }: Props) {
  const isAdd = entry.cat_direction === 'add';

  return (
    <div
      className={`flex items-center gap-3 border-b border-gray-100 py-3 dark:border-gray-700${onClick ? ' cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <span className="w-14 shrink-0 text-sm text-gray-500 dark:text-gray-400">
        {formatDate(entry.entry_date)}
      </span>
      <span
        className={`w-5 shrink-0 text-center font-bold ${isAdd ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
      >
        {isAdd ? '+' : '-'}
      </span>
      <span className="w-24 shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
        {entry.amount.toFixed(2)}
      </span>
      <span className="flex-1 truncate text-sm text-gray-500 dark:text-gray-400">
        {entry.detail ?? ''}
      </span>
      {entry.transfer_group_id && (
        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
          Transfer
        </span>
      )}
    </div>
  );
}

export default React.memo(EntryListItem);
