# Ledgerist

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
| UI | React 18, Tailwind CSS v3, React Router v6 |
| State | Zustand stores (book, ledger, entry, settings, navigation) |
| Database (web) | sql.js (SQLite compiled to WebAssembly), runs entirely in the browser |
| Database (desktop) | better-sqlite3 (native SQLite via Electron IPC) |
| Database (mobile) | @capacitor-community/sqlite (native SQLite on Android) |
| Build | Vite 5 (web), esbuild (desktop) |
| Packaging | electron-builder (.deb / .AppImage), Capacitor 8 (Android) |
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
│   ├── stores/               # Zustand stores
│   └── sync/                 # P2P sync engine, protocol, transports
├── assets/
│   └── icon.svg              # Icon source of truth — see Icons
├── scripts/
│   └── generate-icons.mjs    # Rasterises icon.svg for every shell (`npm run icons`)
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
| Linux | `~/.config/Ledgerist/ledger.db` |
| macOS | `~/Library/Application Support/Ledgerist/ledger.db` |
| Windows | `%APPDATA%\Ledgerist\ledger.db` |

> These are the paths for a **packaged** build, where the directory comes from
> electron-builder's `productName`. An unpackaged `npm run desktop` uses the
> package name instead, so dev data lives in `~/.config/@ledger/desktop/`
> — a separate database from the installed app's.

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

| Platform | Artifact | Status |
|----------|----------|--------|
| Linux | `.deb` package + `.AppImage` | Supported — built and published by CI |
| Windows | `.exe` NSIS installer | **Out of scope** — config present, build it yourself |
| macOS | `.dmg` image | **Out of scope** — config present, build it yourself |

Run `build:desktop` on each target platform — cross-compilation is not
supported for native modules.

> **Windows and macOS are not currently released.** The electron-builder
> config still declares `nsis` and `dmg` targets, so `npm run build:desktop`
> on a Windows or macOS machine should produce an installer, but neither is
> built by CI, neither is tested, and neither would be code-signed — Windows
> SmartScreen and macOS Gatekeeper will both warn on an unsigned installer.
> Only the Linux and Android artifacts below are official.

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

- **JDK 21** (a full JDK, not a JRE — Gradle needs `javac`; headless
  `openjdk-21-jre` installs fail with "does not provide the required
  capabilities: [JAVA_COMPILER]". Prefer a standard distribution such as
  Temurin: GraalVM's `jlink` breaks the Android `JdkImageTransform` step.
  E.g. `JAVA_HOME=~/.sdkman/candidates/java/21.0.6-tem npm run mobile:android`)
- Android Studio (or the Android SDK command-line tools) with `ANDROID_HOME` set,
  including platform 36 and build-tools 36
  (`sdkmanager "platforms;android-36" "build-tools;36.0.0"`)
- An emulator or a device with USB debugging enabled

### One-time setup

The native `android/` project is **gitignored** and regenerated from the
Capacitor config (no manual native edits are required):

```bash
npm run build                                  # cap requires apps/web/dist to exist
cd apps/mobile && npm run add:android
```

`add:android` runs `cap add android` followed by `prepare-android.mjs`, which
patches the generated project (idempotent — rerun any time with
`npm run prepare:android -w @ledger/mobile`):

- `android:usesCleartextTraffic="true"` on `<application>` — Android API 28+
  blocks cleartext traffic, which includes the `ws://` LAN connections Device
  Sync uses (payloads are app-layer AES-GCM encrypted regardless). The WebView
  mixed-content side is already handled by `android.allowMixedContent` in
  `capacitor.config.ts`.
- `minSdkVersion 26` — required by `@capacitor/barcode-scanner`'s native
  library, or the Gradle manifest merger fails.
- `versionName` / `versionCode` derived from the package version
  (`versionCode = major*10000 + minor*100 + patch`), so release APKs upgrade
  in place.

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

## Icons

`assets/icon.svg` is the single source of truth. Everything else is generated:

```bash
npm run icons          # rasterises assets/icon.svg into all three shells
```

| Output | Size(s) | Consumed by |
|--------|---------|-------------|
| `apps/desktop/build/icon.png` | 1024 | electron-builder, for `.ico`/`.icns` conversion if Windows/macOS are ever built |
| `apps/desktop/build/icons/NxN.png` | 16 → 1024 | electron-builder Linux — installed into `/usr/share/icons/hicolor/NxN/apps/` |
| `apps/mobile/assets/icon*.png` | 1024 | `capacitor-assets`, which writes the real mipmaps into `android/` |
| `apps/web/public/favicon.*` | svg, 96, 180, 512 | the browser build, linked from `index.html` |

Two non-obvious constraints are baked into the generator — read its header
comment before changing sizes:

- **Linux needs the `icons/NxN.png` set, not just `icon.png`.** Handed a lone
  `icon.png`, electron-builder 24 installs it to `hicolor/0x0/apps/` — a path
  no desktop environment reads, so the app silently has no icon.
- **The Android foreground layer is scaled *up*, not down.** `capacitor-assets`
  emits `android:inset="16.7%"`, which already maps the source onto the
  adaptive icon's safe area. Pre-shrinking the art to fit the safe zone
  compounds with that inset and leaves a small logo adrift in background.

Android icons live in the gitignored `android/` tree, so they are regenerated
by `prepare-android.mjs` on every `add:android` / `prepare:android` — run
`npm run icons` first if the source art changed.

---

## Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request: `npm run typecheck`, `npm test`, then a web build. The release
pipeline runs the same checks as a `verify` gate before any packaging job
starts, so a tag that fails either cannot produce artifacts.

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

There are currently **297 tests** across 24 suites:

| Suite | Package |
|-------|---------|
| types / date / math / validation / HLC | `packages/shared` |
| IDB connection, queries, sync migration | `packages/database` |
| stores | `packages/stores` |
| sync engine: convergence, crash injection, crypto, pairing/session integration, hardening, perf (env-gated) | `packages/sync` |
| BookCard, LedgerSection, ParserBar, SyncScreen, PairDeviceModal, ConflictLogModal | `apps/web` |

### Type-check only

```bash
npm run typecheck
# or, for the web app specifically:
npx tsc -p apps/web/tsconfig.json --noEmit
```

---

## Releases (beta distribution)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all
distributable artifacts and attaches them to a **draft** GitHub Release:

| Artifact | Built on | Notes |
|----------|----------|-------|
| `Ledgerist_<version>_amd64.deb` | ubuntu runner | Debian/Ubuntu installer |
| `Ledgerist_<version>_x86_64.AppImage` | ubuntu runner | Portable — `chmod +x` and run, any distro |
| `Ledgerist_<version>.apk` | ubuntu runner | Signed release APK; sideload with "Install unknown apps" enabled |

The desktop artifact names come from electron-builder's
`artifactName: "${productName}_${version}_${arch}.${ext}"` in
`apps/desktop/package.json` — change it there and this table must follow.

A `verify` job type-checks and runs the full test suite before any packaging
job starts, so a tag that does not build cannot produce a release.

To cut a release:

```bash
npm version 0.2.0 --no-git-tag-version            # root
npm pkg set version=0.2.0 -w apps/web -w @ledger/desktop -w @ledger/mobile
git commit -am "chore: v0.2.0" && git tag v0.2.0
git push && git push --tags
```

Then review the draft release on GitHub and publish it.

### Android signing

The APK is signed with `apps/mobile/ledger-release.keystore` (gitignored,
passwords in the gitignored `apps/mobile/keystore.properties`). **Back both
files up outside this machine** — losing the keystore means testers must
uninstall/reinstall (the update signature won't match), and every future APK
must be signed with it.

The workflow reads four repository secrets (Settings → Secrets and variables →
Actions):

| Secret | Value |
|--------|-------|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 apps/mobile/ledger-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` from `keystore.properties` |
| `ANDROID_KEY_ALIAS` | `ledger` |
| `ANDROID_KEY_PASSWORD` | `keyPassword` from `keystore.properties` |

Note: the phone build installed via `npm run mobile:android` is a
debug-signed APK — a release APK cannot install over it (signature mismatch).
Uninstall the debug app first, or test releases on a different device.

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

---

## Device Sync

Peer-to-peer sync between your devices over the local network — no central
server ever holds the data. Devices pair via QR code (or a copyable code),
exchange deltas over an encrypted WebSocket channel, and merge with row-level
last-write-wins on hybrid logical clocks. Conflicts are resolved automatically
(newest change wins) and recorded in a per-device conflict log.

- Open **Settings → Device Sync** to pair devices and trigger a sync.
- The desktop app listens on port `45680` (fallback `45681–45689`) while open;
  phones, browsers, and other desktops connect to it. Devices that cannot
  listen (phone↔phone) converge transitively through a desktop.
- Sync is manual in v1 — tap **Sync now** with both apps open.

See the full design, behavior diagrams, and as-built notes in
[`docs/sync/DESIGN.md`](docs/sync/DESIGN.md).

---

## Contributing & Support

**Pull requests are not currently being accepted** — this is a personal
project with one maintainer. Bug reports with reproduction steps are very
welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Found a security problem? Do not open a public issue — see
[`SECURITY.md`](SECURITY.md) for private reporting and the threat model.

---

## License

Copyright (C) 2026 Alejandro Carrasco

Ledgerist is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License** as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [`LICENSE`](LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.

In practice: the app is free to use, and anyone who distributes a modified
version must publish their source under the same terms — so it stays free.
Note that the GPL is incompatible with the Apple App Store's terms, which rules
out shipping an iOS build there.
