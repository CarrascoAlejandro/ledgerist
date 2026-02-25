import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@ledger/stores';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AppSettingsScreen() {
  const navigate = useNavigate();
  const { settings, loading, toggleDarkMode } = useSettingsStore();

  useEffect(() => {
    useSettingsStore.getState().loadSettings();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-blue-600 dark:text-blue-400"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Settings</h1>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className="text-gray-500 dark:text-gray-400">Loading…</span>
          </div>
        )}

        {!loading && settings && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Dark Mode
                </span>
                <input
                  type="checkbox"
                  checked={settings.dark_mode === 1}
                  onChange={(e) => toggleDarkMode(e.target.checked)}
                  className="h-4 w-4 cursor-pointer"
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Default Entry Direction
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                  {settings.cat_default_entry_direction}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Week Starts On
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {DAY_NAMES[settings.week_start_day]}
                </span>
              </div>
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-600">
          Ledger Project v0.0.1
        </p>
      </main>
    </div>
  );
}
