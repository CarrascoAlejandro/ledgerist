import { useState } from 'react';
import { useLedgerStore, useEntryStore, useBookStore } from '@ledger/stores';
import type { Ledger } from '@ledger/shared';
import ConfirmDialog from './ConfirmDialog.js';
import EmojiPickerModal from './EmojiPickerModal.js';
import ColorPickerModal from './ColorPickerModal.js';

interface Props {
  ledger: Ledger;
  onClose: () => void;
}

export default function LedgerSettingsModal({ ledger, onClose }: Props) {
  const { renameLedger, setLedgerAlias, setLedgerColor, setLedgerIcon, deleteLedger } = useLedgerStore();
  const { getEntriesForLedger } = useEntryStore();
  const book = useBookStore.getState().books.find((b) => b.book_id === ledger.book_id);
  const isBookClosed = book?.is_closed === 1;

  const [ledgerName, setLedgerName] = useState(ledger.ledger_name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alias, setAlias] = useState(ledger.alias ?? '');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [currentIcon, setCurrentIcon] = useState(ledger.icon);
  const [currentColor, setCurrentColor] = useState<string | null>(ledger.ledger_color ?? null);

  const entryCount = getEntriesForLedger(ledger.ledger_id).length;

  async function handleRename() {
    const result = await renameLedger({ ledger_id: ledger.ledger_id, ledger_name: ledgerName });
    if (result.success) {
      setNameError(null);
    } else {
      setNameError(result.error ?? 'Failed to rename ledger');
    }
  }

  async function handleSetAlias() {
    const result = await setLedgerAlias({
      ledger_id: ledger.ledger_id,
      alias: alias.trim() === '' ? null : alias.trim(),
      book_id: ledger.book_id,
    });
    if (result.success) {
      setAliasError(null);
    } else {
      setAliasError(result.error ?? 'Failed to set alias');
    }
  }

  async function handleDelete() {
    await deleteLedger({ ledger_id: ledger.ledger_id, book_id: ledger.book_id });
    onClose();
  }

  async function handleSelectIcon(emoji: string) {
    const result = await setLedgerIcon({ ledger_id: ledger.ledger_id, icon: emoji });
    if (result.success) setCurrentIcon(emoji);
  }

  async function handleSelectColor(color: string | null) {
    const result = await setLedgerColor({ ledger_id: ledger.ledger_id, color });
    if (result.success) setCurrentColor(color);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center">
        <div className="w-full max-w-sm rounded-t-xl bg-white p-6 shadow-xl dark:bg-gray-800 sm:rounded-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Ledger Settings
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>

          {/* Rename */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Ledger Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ledgerName}
                onChange={(e) => setLedgerName(e.target.value)}
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

          {/* Alias */}
          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Alias <span className="font-normal text-gray-400">(used as #alias in parser)</span>
            </label>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-md border border-gray-300 px-3 dark:border-gray-600 dark:bg-gray-700">
                <span className="text-sm text-gray-400">#</span>
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value.replace(/\s/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetAlias()}
                  placeholder="alias"
                  className="flex-1 bg-transparent py-2 pl-1 text-sm focus:outline-none dark:text-gray-100"
                />
              </div>
              <button
                onClick={handleSetAlias}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save
              </button>
            </div>
            {aliasError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{aliasError}</p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              Aliases are unique per book. Leave empty to clear.
            </p>
          </div>

          {/* Icon */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Icon
            </label>
            <button
              onClick={() => !isBookClosed && setShowEmojiPicker(true)}
              disabled={isBookClosed}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-xl transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
              aria-label="Change icon"
            >
              {currentIcon}
            </button>
          </div>

          {/* Color */}
          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Color accent
            </label>
            <button
              onClick={() => !isBookClosed && setShowColorPicker(true)}
              disabled={isBookClosed}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 transition hover:scale-110 disabled:opacity-50 dark:border-gray-600"
              style={{ backgroundColor: currentColor ?? undefined }}
              aria-label="Change color"
            >
              {!currentColor && <span className="text-xs text-gray-400">∅</span>}
            </button>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Danger Zone
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete Ledger
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Ledger"
          message={
            entryCount > 0
              ? `This ledger has ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}. All entries will be permanently deleted. Continue?`
              : 'Delete this ledger? This action cannot be undone.'
          }
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {showEmojiPicker && (
        <EmojiPickerModal
          currentIcon={currentIcon}
          onSelect={handleSelectIcon}
          onClose={() => setShowEmojiPicker(false)}
        />
      )}

      {showColorPicker && (
        <ColorPickerModal
          currentColor={currentColor}
          onSelect={handleSelectColor}
          onClose={() => setShowColorPicker(false)}
        />
      )}
    </>
  );
}
