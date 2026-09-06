import { useEffect, useRef, useState } from 'react';
import { useEntryStore } from '@ledger/stores';
import { useLedgerStore } from '@ledger/stores';
import { useSettingsStore } from '@ledger/stores';
import type { EntryDirection, Ledger } from '@ledger/shared';
import LedgerSuggestion from './LedgerSuggestion.js';

interface Props {
  bookId: string;
  onClose: () => void;
}

interface Overrides {
  entry_date?: string;
  amount?: number;
  cat_direction?: EntryDirection;
  detail?: string | null;
  parsed_ledger?: Ledger;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ParserBar({ bookId, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const { parserPreview, parserInput, updateParserInput, submitParsedEntry, clearParserState } =
    useEntryStore();
  const { ledgers } = useLedgerStore();
  const { settings } = useSettingsStore();

  const [overrides, setOverrides] = useState<Overrides>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const bookLedgers = ledgers.filter((l) => l.book_id === bookId && l.status === 1);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync override fields from preview when preview changes
  useEffect(() => {
    if (!parserPreview) return;
    setOverrides((prev) => ({
      entry_date: prev.entry_date ?? (parserPreview.parsed_date ?? todayString()),
      amount: prev.amount ?? (parserPreview.parsed_amount ?? undefined),
      cat_direction: prev.cat_direction ?? (parserPreview.parsed_direction ?? undefined),
      detail: prev.detail !== undefined ? prev.detail : (parserPreview.parsed_detail ?? undefined),
      parsed_ledger: prev.parsed_ledger ?? (parserPreview.parsed_ledger ?? undefined),
    }));
  }, [parserPreview]);

  function handleInput(value: string) {
    const defaultDirection = settings?.cat_default_entry_direction ?? 'sub';
    const weekStartDay = settings?.week_start_day ?? 1;
    const weekendStartDay = settings?.weekend_start_day ?? 6;
    updateParserInput(value, { book_id: bookId, defaultDirection, weekStartDay, weekendStartDay });
    // Reset overrides when input changes so they re-sync from new preview
    setOverrides({});
    setSubmitError(null);
  }

  // Ledger suggestion logic: detect unresolved #token
  const hashToken = (() => {
    const tokens = parserInput.trim().split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (last?.startsWith('#') && parserPreview?.parsed_ledger === null) {
      return last.slice(1);
    }
    return null;
  })();

  function handleSelectLedger(ledger: Ledger) {
    const tokens = parserInput.trim().split(/\s+/);
    tokens[tokens.length - 1] = `#${ledger.alias ?? ledger.ledger_name}`;
    const newInput = tokens.join(' ');
    handleInput(newInput);
    if (inputRef.current) {
      inputRef.current.value = newInput;
      // Belt and braces: the suggestion button cancels mousedown so focus never
      // leaves, but if anything else did steal it, take it back inside the tap
      // handler — the only place a WebView will honour a programmatic focus.
      inputRef.current.focus();
    }
    setOverrides((prev) => ({ ...prev, parsed_ledger: ledger }));
  }

  async function handleSubmit() {
    if (!parserPreview) return;
    const result = await submitParsedEntry({ book_id: bookId, preview: parserPreview, overrides });
    if (result.success) {
      setOverrides({});
      setSubmitError(null);
      onClose();
    } else {
      setSubmitError(result.error ?? 'Failed to add entry');
    }
  }

  function handleCancel() {
    clearParserState();
    setOverrides({});
    onClose();
  }

  const hasErrors =
    !parserPreview ||
    parserInput.trim() === '' ||
    parserPreview.errors.length > 0 ||
    (!parserPreview.parsed_amount && overrides.amount === undefined) ||
    (!parserPreview.parsed_ledger && !overrides.parsed_ledger);

  const effectiveDate = overrides.entry_date ?? parserPreview?.parsed_date ?? todayString();
  const effectiveAmount =
    overrides.amount !== undefined ? overrides.amount : (parserPreview?.parsed_amount ?? '');
  const effectiveDirection =
    overrides.cat_direction ?? parserPreview?.parsed_direction ?? (settings?.cat_default_entry_direction ?? 'sub');
  const effectiveDetail =
    overrides.detail !== undefined ? overrides.detail : (parserPreview?.parsed_detail ?? '');
  const effectiveLedger = overrides.parsed_ledger ?? parserPreview?.parsed_ledger ?? null;

  const allMessages = [
    ...(parserPreview?.errors ?? []),
    ...(parserPreview?.warnings ?? []),
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
      {/* Text input row */}
      <div className="relative flex items-center gap-2 px-4 py-3">
        <input
          ref={inputRef}
          type="text"
          value={parserInput}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="today 50 #groceries coffee"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <button
          onClick={handleCancel}
          className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Close parser"
        >
          ✕
        </button>

        {/* Ledger suggestion dropdown */}
        {hashToken !== null && (
          <LedgerSuggestion
            ledgers={bookLedgers}
            filter={hashToken}
            onSelect={handleSelectLedger}
          />
        )}
      </div>

      {/* Override fields */}
      <div className="grid grid-cols-5 gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-700">
        {/* Date */}
        <div className="flex flex-col gap-1">
          <label htmlFor="parser-date" className="text-xs text-gray-500 dark:text-gray-400">Date</label>
          <input
            id="parser-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setOverrides((p) => ({ ...p, entry_date: e.target.value }))}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>

        {/* Ledger */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">Ledger</label>
          <select
            value={effectiveLedger?.ledger_id ?? ''}
            onChange={(e) => {
              const found = bookLedgers.find((l) => l.ledger_id === e.target.value) ?? undefined;
              setOverrides((p) => ({ ...p, parsed_ledger: found }));
            }}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="">—</option>
            {bookLedgers.map((l) => (
              <option key={l.ledger_id} value={l.ledger_id}>
                {l.icon} {l.ledger_name}
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={effectiveAmount}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setOverrides((p) => ({ ...p, amount: isFinite(val) && val > 0 ? val : undefined }));
            }}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>

        {/* Direction */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">Dir</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setOverrides((p) => ({ ...p, cat_direction: 'add' }))}
              className={`flex-1 rounded border px-1 py-1 text-xs ${
                effectiveDirection === 'add'
                  ? 'border-green-500 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
              }`}
            >
              add
            </button>
            <button
              type="button"
              onClick={() => setOverrides((p) => ({ ...p, cat_direction: 'sub' }))}
              className={`flex-1 rounded border px-1 py-1 text-xs ${
                effectiveDirection === 'sub'
                  ? 'border-red-500 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                  : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
              }`}
            >
              sub
            </button>
          </div>
        </div>

        {/* Detail */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">Detail</label>
          <input
            type="text"
            value={effectiveDetail ?? ''}
            onChange={(e) => setOverrides((p) => ({ ...p, detail: e.target.value || null }))}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Warnings / errors */}
      {allMessages.length > 0 && (
        <div className="px-4 pb-1">
          {allMessages.map((msg, i) => (
            <p
              key={i}
              className={`text-xs ${
                parserPreview?.errors.includes(msg)
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-yellow-600 dark:text-yellow-400'
              }`}
            >
              {parserPreview?.errors.includes(msg) ? '✗' : '⚠'} {msg}
            </p>
          ))}
        </div>
      )}

      {submitError && (
        <div className="px-4 pb-1">
          <p className="text-xs text-red-600 dark:text-red-400">✗ {submitError}</p>
        </div>
      )}

      {/* Action row */}
      <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
        <button
          onClick={handleCancel}
          className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={hasErrors}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add ✓
        </button>
      </div>
    </div>
  );
}
