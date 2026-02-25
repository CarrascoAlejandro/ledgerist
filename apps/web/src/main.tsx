import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import { createWebConnection, runMigrations } from '@ledger/database';
import { setDB } from '@ledger/stores';

async function init() {
  const db = await createWebConnection('ledger', { persist: true });
  await runMigrations(db);
  setDB(db);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

init().catch(console.error);
