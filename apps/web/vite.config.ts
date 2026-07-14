import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/sql.js/dist/sql-wasm.wasm', dest: 'assets' },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@ledger/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@ledger/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@ledger/stores': path.resolve(__dirname, '../../packages/stores/src/index.ts'),
      '@ledger/sync': path.resolve(__dirname, '../../packages/sync/src/index.ts'),
    },
  },
  optimizeDeps: { include: ['sql.js', 'sql.js/dist/sql-wasm.js'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
