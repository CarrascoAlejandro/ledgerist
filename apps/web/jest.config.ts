const config = {
  displayName: 'web',
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^sql\\.js$': '<rootDir>/../../packages/database/__mocks__/sql-noop.ts',
    // Pin React to single CJS instances to avoid ESM/CJS dual-module hazard
    '^react$': '<rootDir>/../../node_modules/react/index.js',
    '^react/jsx-runtime$': '<rootDir>/../../node_modules/react/jsx-runtime.js',
    '^react-dom$': '<rootDir>/../../node_modules/react-dom/index.js',
    '^react-dom/client$': '<rootDir>/../../node_modules/react-dom/client.js',
    '^@ledger/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@ledger/database$': '<rootDir>/../../packages/database/src/index.ts',
    '^@ledger/stores$': '<rootDir>/../../packages/stores/src/index.ts',
    '^@ledger/sync$': '<rootDir>/../../packages/sync/src/index.ts',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: { allowImportingTsExtensions: false, noEmit: false, jsx: 'react-jsx' },
    }],
  },
  testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
};
export default config;
