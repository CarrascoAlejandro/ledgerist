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
| Database | sql.js (SQLite compiled to WebAssembly), runs entirely in the browser |
| Build | Vite 5 |
| Tests | Jest 29, ts-jest, @testing-library/react |
| Language | TypeScript 5 (strict) |

---

## Project Structure

```
ledger-project/
├── apps/
│   └── web/                  # React app (Vite)
│       ├── src/
│       │   ├── components/   # BookCard, LedgerSection, ParserBar, …
│       │   ├── screens/      # DashboardScreen, BookOverviewScreen, AppSettingsScreen
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── __tests__/        # Component tests
├── packages/
│   ├── shared/               # Domain types (Book, Ledger, Entry, AppSettings) + utils
│   ├── database/             # IDBConnection, WebDBConnection, runMigrations, createQueries
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

There are currently **131+ tests** across 8 suites:

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

The database lives entirely in memory via sql.js and is persisted to the browser's
`IndexedDB` between sessions. No data is sent to any server.
