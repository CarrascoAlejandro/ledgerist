# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                 # root install (npm workspaces)
npm run dev                 # Vite dev server for the web app (localhost:5173)
npm run build               # web build → apps/web/dist
npm run desktop             # build web + electron main/preload, then launch Electron
npm run build:desktop       # + electron-builder installers → apps/desktop/dist-electron
npm run mobile:android      # build web + cap sync + cap run android
npm run typecheck           # tsc --noEmit over all 7 tsconfigs (there is no linter)
npm test                    # jest, all 5 projects
npm run test:watch
```

Running a subset of tests (the root jest config uses `projects`, so plain path
filters work across all of them):

```bash
npx jest --selectProjects sync                    # one project: shared|database|stores|sync|web
npx jest packages/sync/__tests__/merge            # by path fragment
npx jest -t "converges after three devices"       # by test name
SYNC_PERF=1 npx jest --selectProjects sync perf   # the perf suite is env-gated and skipped by default
```

Commit messages are validated by a local `commit-msg` hook. A commit is
rejected unless all of the following hold:

- first line is **≤ 64 characters**, including `type(scope): `
- format is `type(scope): description`; the scope is optional
- type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`,
  `merge`
- the first line does not end with a period
- the message contains neither "github" nor "gitlab" anywhere (case-insensitive)

The hook lives in `.git/hooks/`, so it is per-clone and not distributed with
the repo.

## Architecture

npm-workspaces monorepo: one React app (`apps/web`) shipped in three shells
(browser, Electron, Capacitor/Android), over four interchangeable SQLite drivers.

```
packages/shared    domain types, date/math/validation utils, HLC (no deps)
packages/database  IDBConnection interface + drivers + migrations + ALL SQL
packages/stores    Zustand stores — the business-logic layer (no React)
packages/sync      P2P sync engine, protocol, transports (no React, no UI)
apps/web           React 18 + Tailwind + React Router; screens/ and components/
apps/desktop       Electron main + preload (SQLite over IPC, WS sync relay)
apps/mobile        Capacitor config + prepare-android.mjs
```

**Workspace packages are consumed as TypeScript source, never built.** Each has
`"main": "./src/index.ts"`; resolution is wired three times and all three must be
kept in sync when adding a package: `apps/web/vite.config.ts` aliases,
`moduleNameMapper` in `apps/web/jest.config.ts` and `packages/sync/jest.config.ts`,
and the tsconfig paths.

**ESM with explicit extensions.** Relative imports in `.ts`/`.tsx` sources must end
in `.js` (`import { getDB } from './db.js'`) even though the file is `.ts` — Vite,
ts-jest ESM, and `moduleResolution: "Bundler"` all depend on this.

### Database layer

`IDBConnection` (`packages/database/src/connection.ts`) is the only DB surface the
rest of the app sees: `query` / `run` / `transaction(ops[])` plus an optional
`beginBulk`/`endBulk` window. Four implementations:

| Shell | Driver | Storage |
|---|---|---|
| Browser | `createWebConnection` (sql.js/WASM) | serialized to IndexedDB on every write |
| Electron renderer | `ElectronRendererConnection` | IPC → better-sqlite3 in main |
| Electron main | `createDesktopConnection` | native file in the OS user-data dir |
| Android | `createCapacitorConnection` | `@capacitor-community/sqlite` |

`apps/web/src/main.tsx` picks the driver at startup by sniffing
`window.Capacitor` / `window.electronAPI`, then calls `runMigrations(db)` and
`setDB(db)`. The factories in `packages/database/src/index.ts` are deliberately
lazy `await import(...)` wrappers so native modules and `import.meta.url` never
load in the wrong environment (including Jest).

**All SQL lives in `packages/database/src/queries.ts`.** Reads go through
`createQueries(db)`; writes are built as `DBOperation`s by `buildOps` and composed
by the stores into a single `db.transaction([...])`. Do not write inline SQL in
stores or components.

`transaction()` takes a prebuilt op array and cannot read mid-transaction — build
ops from data already fetched.

Rows are **soft-deleted** (`status = 0`, an UPDATE); nothing issues `DELETE` on
domain tables. Every query filters `status = 1`.

### Sync (read `docs/sync/DESIGN.md` before touching anything sync-related)

Peer-to-peer LAN sync of `books`/`ledgers`/`entries` with row-level
last-write-wins on a hybrid logical clock. The design doc is finalized against
the as-built system, including an "As-built notes" section of deviations.

Invariants that are easy to break from ordinary feature work:

- **Every INSERT/UPDATE on `books`, `ledgers`, `entries` must carry the sync
  stamp** — splice `STAMP_COLS`/`STAMP_VALS`/`STAMP_SET` into the SQL and spread
  `syncStamp()` into the params (`packages/database/src/syncStamp.ts`). An
  unstamped mutation silently loses LWW races.
- **Except balance.** `ledgers.balance` is derived, device-local state:
  `buildOps.updateLedgerBalance` is intentionally unstamped and balance never
  travels on the wire. `app_settings` is not synced at all.
- SQLite triggers maintain `sync_change_log` on every mutation path (including
  the merge path — that is what makes sync transitive). Schema changes to synced
  tables need matching trigger/migration work in
  `packages/database/src/migrations/002_sync.ts`.
- New migrations are appended to `MIGRATIONS` in
  `packages/database/src/migrations.ts`; `runMigrations` also seeds the
  process-wide sync context (device id + HLC) at the end.

The `SyncEngine` runs in the renderer on **all** platforms and consumes a
`PeerChannel`; only the transport differs. Electron main owns the `ws` server
(port 45680, falling back through 45689) and relays raw frames over IPC —
it holds no keys and knows no protocol; encryption (`SecureChannel`,
AES-GCM over an HMAC/HKDF handshake) happens in the renderer.

### UI and state

Zustand stores hold all business logic and return `ActionResult<T>`
(`{ success, error?, code? }`) rather than throwing; components stay thin.
`packages/stores` must never import React. The plain-text entry parser lives in
`entryStore.parseTextInput` (not in the `ParserBar` component).

`App.tsx` uses `HashRouter` — the desktop shell loads over `file://`, where a
path router can never match. Routes other than the dashboard are `lazy()`.

`apps/desktop/src/preload.ts` is the full renderer-visible native surface
(`window.electronAPI.db` and `.sync`); adding a capability means touching
`main.ts` (`ipcMain.handle`), `preload.ts`, and the consumer together.

### Mobile specifics

`apps/mobile/android/` is gitignored and regenerated. After `cap add android`,
`prepare-android.mjs` re-applies (idempotently) `usesCleartextTraffic`,
`minSdkVersion 26`, and a `versionCode` derived from the package version. Never
hand-edit the generated native project — patch that script instead. Requires a
full JDK 21 (Temurin; GraalVM's jlink breaks `JdkImageTransform`).

## Icons

`assets/icon.svg` is the source of truth; `npm run icons`
(`scripts/generate-icons.mjs`) rasterises it into `apps/desktop/build/`,
`apps/mobile/assets/` and `apps/web/public/`. Never hand-edit a generated PNG.

Two traps the generator already works around, documented in its header:
electron-builder needs the `build/icons/NxN.png` set for Linux (a lone
`icon.png` installs to the unreadable `hicolor/0x0/apps/`), and the Capacitor
adaptive-icon foreground must be scaled *up* to a tight crop because
`capacitor-assets` applies its own `android:inset="16.7%"`.

`apps/desktop/build/` is force-unignored in `.gitignore` — the bare `build/`
rule would otherwise swallow it.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml` (deb + AppImage + exe +
signed APK → draft release). Bump the root version *and* each app workspace
version together; see the README's "Releases" section for the exact sequence and
the Android signing secrets.
