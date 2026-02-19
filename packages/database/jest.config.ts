const config = {
  displayName: 'database',
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^sql\\.js$': '<rootDir>/__mocks__/sql.js.ts',
    '^@ledger/shared$': '<rootDir>/../shared/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: { allowImportingTsExtensions: false, noEmit: false },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
export default config;
