import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardScreen from './screens/DashboardScreen.js';

const BookOverviewScreen = lazy(() => import('./screens/BookOverviewScreen.js'));
const AppSettingsScreen = lazy(() => import('./screens/AppSettingsScreen.js'));
const SyncScreen = lazy(() => import('./screens/SyncScreen.js'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>}>
        <Routes>
          <Route path="/" element={<DashboardScreen />} />
          <Route path="/book/:bookId" element={<BookOverviewScreen />} />
          <Route path="/settings" element={<AppSettingsScreen />} />
          <Route path="/settings/sync" element={<SyncScreen />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
