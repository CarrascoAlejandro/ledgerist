# Ledger Project

A personal finance tracker built as a browser-first app. All data is stored locally in an
in-browser SQLite database (via [sql.js](https://sql.js.org/)), so no server or account is
required.

---

## Features

### Books
- Create named financial books
- Each book shows its ledger count, closed status, and balanced status on the dashboard

### Ledgers
- Add multiple ledgers to a book (each gets a random emoji icon and a running balance)
- Collapse / expand each ledger to show or hide its entries
- Entry list footer shows total credits and current balance per ledger

### Entries (text parser)
- Open the ✏️ FAB on the Book Overview screen to enter transactions in plain text:
  ```
  today 50 #groceries coffee
  yesterday 1200 add #salary
  transfer 200 #checking to #savings
  ```
- Recognised tokens: relative/absolute dates, amount, `add`/`sub` direction, `#ledger` reference, free-text detail
- Type `#` to get a filtered ledger suggestion dropdown
- Override any parsed field (date, ledger, amount, direction, detail) before submitting
- Warnings and errors are shown inline

### Settings
- Toggle dark mode

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 19, Tailwind CSS v3, React Router v6 |
| State | Zustand stores (book, ledger, entry, settings, navigation) |
| Database (web) | sql.js (SQLite compiled to WebAssembly), runs entirely in the browser |
| Database (desktop) | better-sqlite3 (native SQLite via Electron IPC) |
| Database (mobile) | @capacitor-community/sqlite (native SQLite on Android) |
| Build | Vite 5 (web), esbuild (desktop) |
| Packaging | electron-builder (.dmg / .exe / .deb), Capacitor 6 (Android) |
| Tests | Jest 29, ts-jest, @testing-library/react |
| Language | TypeScript 5 (strict) |

---

## Project Structure

```
ledger-project/
├── apps/
│   ├── web/                  # React app (Vite)
│   │   ├── src/
│   │   │   ├── components/   # BookCard, LedgerSection, ParserBar, …
│   │   │   ├── screens/      # DashboardScreen, BookOverviewScreen, AppSettingsScreen
│   │   │   ├── App.tsx
│   │   │   └── main.tsx      # Detects Capacitor/Electron and switches DB driver automatically
│   │   └── __tests__/        # Component tests
│   ├── desktop/              # Electron wrapper
│   │   ├── src/
│   │   │   ├── main.ts       # Electron main process (DB init, IPC handlers, BrowserWindow)
│   │   │   └── preload.ts    # contextBridge — exposes window.electronAPI.db to renderer
│   │   └── dist/             # esbuild output (main.js, preload.js)
│   └── mobile/               # Capacitor wrapper (Android)
│       ├── capacitor.config.ts
│       └── android/          # Generated native project (gitignored — see Mobile App)
├── packages/
│   ├── shared/               # Domain types (Book, Ledger, Entry, AppSettings) + utils
│   ├── database/             # IDBConnection interface + drivers (web, desktop, renderer, capacitor)
│   └── stores/               # Zustand stores
├── package.json              # npm workspaces root
└── tsconfig.base.json
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Opens at `http://localhost:5173`.

### Build for production

```bash
npm run build
```

Output goes to `apps/web/dist/`.

---

## Desktop App (Electron)

The same React app runs inside Electron with a native SQLite database
(`better-sqlite3`) instead of the WebAssembly-based sql.js. Data is stored
in the OS user-data directory:

| Platform | Path |
|----------|------|
| Linux | `~/.config/Ledger/ledger.db` |
| macOS | `~/Library/Application Support/Ledger/ledger.db` |
| Windows | `%APPDATA%\Ledger\ledger.db` |

### Prerequisites

In addition to Node.js ≥ 18 and npm ≥ 9, you need the native build toolchain
for `better-sqlite3`:

- **Linux/macOS**: `gcc`/`clang` + Python 3 (usually already present)
- **Windows**: Visual Studio Build Tools with "Desktop development with C++"

### Run in development

Build the web app and launch Electron in one step:

```bash
npm run desktop
```

> The web bundle is written to `apps/web/dist/` and Electron loads it from
> there. Re-run the command after changing source files to pick up updates.

### Build an installer

```bash
npm run build:desktop
```

This builds the web app, compiles the Electron main/preload scripts, and
runs `electron-builder`. Installers are written to `apps/desktop/dist-electron/`:

| Platform | Artifact |
|----------|----------|
| Linux | `.deb` package |
| macOS | `.dmg` image |
| Windows | `.exe` NSIS installer |

Run `build:desktop` on each target platform — cross-compilation is not
supported for native modules.

### Type-check the desktop app

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```

---

## Mobile App (Android via Capacitor)

The same React app runs inside a Capacitor webview with a native SQLite
database (`@capacitor-community/sqlite`). `main.tsx` detects the native
platform via the injected `window.Capacitor` global and selects the
Capacitor driver instead of sql.js.

### Prerequisites

- **JDK 17** (exactly — Capacitor 6's Gradle 8.2 does not support JDK 21; if your
  default `java` is newer, point `JAVA_HOME` at a JDK 17 when building, e.g.
  `JAVA_HOME=~/.sdkman/candidates/java/17.0.11-tem npm run mobile:android`)
- Android Studio (or the Android SDK command-line tools) with `ANDROID_HOME` set
- An emulator or a device with USB debugging enabled

### One-time setup

The native `android/` project is **gitignored** and regenerated from the
Capacitor config (no manual native edits are required):

```bash
npm run build                                  # cap requires apps/web/dist to exist
cd apps/mobile && npx cap add android
```

### Run on a device or emulator

From the repo root:

```bash
npm run mobile:android
```

This builds the web app, syncs it into the native project, and launches
`cap run android` (which prompts for a target device/emulator).

Other scripts:

| Command | Effect |
|---------|--------|
| `npm run mobile:sync` | Build web + copy assets into `android/` without running |
| `npm run open:android -w @ledger/mobile` | Open the native project in Android Studio |

> Data is stored in a native SQLite file named `ledgerSQLite.db` (the plugin
> appends the `SQLite.db` suffix) inside the app's private databases directory.

---

## Testing

Run all tests across every package:

```bash
npm test
```

Run only the web app tests:

```bash
npx jest --testPathPattern="apps/web"
```

Run in watch mode:

```bash
npm run test:watch
```

There are currently **170 tests** across 11 suites:

| Suite | Package |
|-------|---------|
| types | `packages/shared` |
| date utils | `packages/shared` |
| math/validation utils | `packages/shared` |
| IDB connection | `packages/database` |
| queries | `packages/database` |
| stores | `packages/stores` |
| BookCard | `apps/web` |
| LedgerSection | `apps/web` |
| ParserBar | `apps/web` |

### Type-check only

```bash
npm run typecheck
# or, for the web app specifically:
npx tsc -p apps/web/tsconfig.json --noEmit
```

---

## Parser Syntax Reference

The text parser accepts space-separated tokens in any order:

| Token | Examples | Description |
|-------|----------|-------------|
| Date | `today`, `yesterday`, `monday`, `last week`, `2024-01-25` | When the entry happened |
| Amount | `50`, `1,200`, `$4.50`, `+50`, `-30` | Transaction amount (required) |
| Direction | `add`, `sub`, `+`, `-` | Credit (`add`) or debit (`sub`); defaults to `sub` |
| Ledger | `#groceries`, `#groc` | Ledger alias or name prefixed with `#` (required) |
| Detail | any remaining tokens | Free-text description |

**Transfer syntax:**
```
transfer <amount> #<source> to #<target>
```

---

## Data Storage

| Mode | Storage |
|------|---------|
| Browser | sql.js in-memory SQLite, persisted to `IndexedDB` between sessions |
| Desktop | Native SQLite file via `better-sqlite3`, stored in the OS user-data directory |
| Mobile (Android) | Native SQLite file (`ledgerSQLite.db`) via `@capacitor-community/sqlite`, stored in the app's private databases directory |

No data is ever sent to any server.
