import type { Ledger } from '@ledger/shared';

interface Props {
  ledger: Ledger;
  onClick?: () => void;
}

function formatBalance(balance: number): string {
  const abs = Math.abs(balance).toFixed(2);
  return balance >= 0 ? `+${abs}` : `-${abs}`;
}

export default function LedgerCard({ ledger, onClick }: Props) {
  const isPositive = ledger.balance >= 0;

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${onClick ? 'cursor-pointer transition hover:shadow-md' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{ledger.icon}</span>
        <p className="font-medium text-gray-900 dark:text-gray-100">{ledger.ledger_name}</p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`font-semibold tabular-nums ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {formatBalance(ledger.balance)}
        </span>
        {onClick && (
          <span className="text-gray-400 dark:text-gray-500">›</span>
        )}
      </div>
    </div>
  );
}
