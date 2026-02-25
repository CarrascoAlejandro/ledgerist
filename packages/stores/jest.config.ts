const config = {
  displayName: 'stores',
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@ledger/shared$': '<rootDir>/../shared/src/index.ts',
    '^@ledger/database$': '<rootDir>/../database/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: { allowImportingTsExtensions: false, noEmit: false },
    }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
export default config;
