import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardScreen from './screens/DashboardScreen.js';
import BookOverviewScreen from './screens/BookOverviewScreen.js';
import AppSettingsScreen from './screens/AppSettingsScreen.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardScreen />} />
        <Route path="/book/:bookId" element={<BookOverviewScreen />} />
        <Route path="/settings" element={<AppSettingsScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
