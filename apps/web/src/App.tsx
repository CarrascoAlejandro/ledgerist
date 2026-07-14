import React, { Suspense, lazy } from 'react';
// HashRouter: the desktop shell loads the app over file://, where a path-based
// router can never match (the pathname is the on-disk path to index.html).
import { HashRouter, Routes, Route } from 'react-router-dom';
import DashboardScreen from './screens/DashboardScreen.js';

const BookOverviewScreen = lazy(() => import('./screens/BookOverviewScreen.js'));
const AppSettingsScreen = lazy(() => import('./screens/AppSettingsScreen.js'));
const SyncScreen = lazy(() => import('./screens/SyncScreen.js'));

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>}>
        <Routes>
          <Route path="/" element={<DashboardScreen />} />
          <Route path="/book/:bookId" element={<BookOverviewScreen />} />
          <Route path="/settings" element={<AppSettingsScreen />} />
          <Route path="/settings/sync" element={<SyncScreen />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
