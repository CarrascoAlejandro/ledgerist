/**
 * Minimal sql.js stub for web component tests that don't use real SQL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const initSqlJs = async (): Promise<any> => ({
  Database: class {
    exec() { return []; }
    run() {}
    export() { return new Uint8Array(); }
    close() {}
  },
});

export default initSqlJs;
