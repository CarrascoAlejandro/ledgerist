/**
 * sql.js mock for stores test environment.
 * Loads the real sql.js using jest.requireActual and provides wasmBinary
 * directly to bypass jsdom's browser-mode detection in Emscripten.
 * Tests that need real SQL must use @jest-environment node to get sql-wasm.js.
 */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const initSqlJs = async (opts: Record<string, unknown> = {}): Promise<any> => {
  const wasmBinary = fs.readFileSync(
    path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
  );
  // jest.requireActual bypasses this mock and returns the real sql.js module
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actualModule = jest.requireActual<any>('sql.js');
  const actualInit = actualModule.default ?? actualModule;
  return actualInit({ ...opts, wasmBinary });
};

export default initSqlJs;
