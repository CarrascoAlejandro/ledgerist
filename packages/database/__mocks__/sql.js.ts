// Mock for sql.js — not needed in connection interface tests
const initSqlJs = async () => ({
  Database: class {
    exec() { return []; }
    run() {}
    export() { return new Uint8Array(); }
    close() {}
  },
});

export default initSqlJs;
