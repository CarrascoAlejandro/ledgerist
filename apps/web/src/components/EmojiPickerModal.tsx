import React from 'react';
import { EMOJI_POOL } from '@ledger/stores';

interface Props {
  currentIcon: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPickerModal({ currentIcon, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-sm rounded-t-xl bg-white p-6 shadow-xl dark:bg-gray-800 sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Pick an Icon
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
          {EMOJI_POOL.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onSelect(emoji); onClose(); }}
              className={`flex h-9 w-9 items-center justify-center rounded-md text-xl transition-transform hover:scale-110 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                currentIcon === emoji
                  ? 'scale-110 ring-2 ring-blue-500'
                  : ''
              }`}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
