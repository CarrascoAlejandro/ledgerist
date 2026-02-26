import type { Ledger } from '@ledger/shared';

interface Props {
  ledgers: Ledger[];
  filter: string;
  onSelect: (ledger: Ledger) => void;
}

export default function LedgerSuggestion({ ledgers, filter, onSelect }: Props) {
  const lower = filter.toLowerCase();
  const filtered = ledgers.filter(
    (l) =>
      l.alias?.toLowerCase().includes(lower) ||
      l.ledger_name.toLowerCase().includes(lower),
  );

  if (filtered.length === 0) return null;

  return (
    <ul className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
      {filtered.map((ledger) => (
        <li key={ledger.ledger_id}>
          <button
            type="button"
            onClick={() => onSelect(ledger)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <span>{ledger.icon}</span>
            <span className="flex-1 text-gray-900 dark:text-gray-100">{ledger.ledger_name}</span>
            {ledger.alias && (
              <span className="text-xs text-gray-500 dark:text-gray-400">#{ledger.alias}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
