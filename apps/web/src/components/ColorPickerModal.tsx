import React from 'react';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#64748b', '#78716c', '#1e293b', '#0f172a',
];

interface Props {
  currentColor: string | null;
  onSelect: (color: string | null) => void;
  onClose: () => void;
}

export default function ColorPickerModal({ currentColor, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-sm rounded-t-xl bg-white p-6 shadow-xl dark:bg-gray-800 sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Pick a Color
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <button
          onClick={() => { onSelect(null); onClose(); }}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          No Color
        </button>

        <div className="grid grid-cols-8 gap-2">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => { onSelect(color); onClose(); }}
              style={{ backgroundColor: color }}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                currentColor === color
                  ? 'scale-110 ring-2 ring-blue-500 ring-offset-2'
                  : ''
              }`}
              aria-label={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export { PRESET_COLORS };
