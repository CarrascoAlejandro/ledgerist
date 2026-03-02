import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import { createWebConnection, runMigrations } from '@ledger/database';
import type { IDBConnection } from '@ledger/database';
import { setDB } from '@ledger/stores';

async function init() {
  let db: IDBConnection;

  if (typeof window !== 'undefined' && 'electronAPI' in window) {
    const { ElectronRendererConnection } = await import('@ledger/database');
    db = new ElectronRendererConnection();
  } else {
    db = await createWebConnection('ledger', { persist: true });
  }

  await runMigrations(db);
  setDB(db);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

init().catch(console.error);
