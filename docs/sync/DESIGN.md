# Inter-Device P2P Sync — Design

Phase 6 of the Ledger project: synchronize books, ledgers, and entries between a
user's devices **without any central server holding ground truth**. Devices sync
peer-to-peer, git-style; when the same row was changed on both sides, the most
recent write wins.

This document describes how the end product behaves. Implementation is phased
(see [Implementation phasing](#implementation-phasing)); nothing in this
document is built yet.

**Diagrams** (PlantUML sources in this directory — render with an IDE PlantUML
extension or <https://www.plantuml.com/plantuml>):

| Diagram | Shows |
|---|---|
| [`components.puml`](components.puml) | Packages, the three shells, transports |
| [`schema.puml`](schema.puml) | Sync metadata tables + new columns |
| [`pairing-sequence.puml`](pairing-sequence.puml) | First-time device pairing |
| [`session-sequence.puml`](session-sequence.puml) | A full sync session |
| [`merge-activity.puml`](merge-activity.puml) | Per-row merge decision + post-passes |
| [`session-state.puml`](session-state.puml) | Sync session lifecycle |

---

## 1. Goals and non-goals

**Goals (v1):**

- **LAN-first, zero external servers.** The desktop (Electron) hosts a
  WebSocket server; mobile/browser/other desktops connect as clients on the
  same network. No signaling server, no relay, no account.
- **Manual trigger.** Sync happens when the user taps "Sync now" on the Sync
  screen. (Auto-sync-on-connect is a named future extension.)
- **N devices, pairwise.** Any device pairs with any other, like git remotes —
  no hub, no special device. Syncing any pair must converge the whole set
  eventually (syncs are transitive).
- **Row-level last-write-wins (LWW).** Each row carries a hybrid logical clock
  (HLC) version; on collision the higher version wins and the loser is recorded
  in a visible conflict log.

**Non-goals / explicitly not synced:**

- `app_settings` — dark mode, week start, default entry direction are
  per-device preferences. Cross-device surprise ("my phone's parser flipped
  direction because I changed my desktop") outweighs convenience. Costs nothing
  to add later.
- `ledgers.balance` — derived data. It never travels on the wire and is always
  recomputed from entries after a merge (§6, post-pass B).
- Sync metadata tables (`sync_*`, `_migrations`) — never on the wire except as
  protocol fields (cursors, device identity).
- In-memory Zustand state (navigation, parser previews).
- v1 provides no Internet transport, but the transport seam (§7) is designed so
  one (WebRTC + minimal signaling) can be added without touching the protocol.

---

## 2. Sync metadata schema (migration `002_sync`)

Added through the existing runner in `packages/database/src/migrations.ts`,
generalized from the single `001_init` to an ordered migration list. Migration
code runs in TypeScript, so it can generate UUIDs in JS and bind them as
parameters.

### 2.1 New columns on synced tables (`books`, `ledgers`, `entries`)

```sql
ALTER TABLE books ADD COLUMN version_hlc TEXT;       -- LWW version (§3)
ALTER TABLE books ADD COLUMN origin_device_id TEXT;  -- device of last write
CREATE INDEX idx_books_version_hlc ON books(version_hlc);
-- same for ledgers, entries
```

`app_settings` gets nothing (not synced). `created_at` / `updated_at` are
untouched and remain display-only.

### 2.2 New tables

```sql
-- Single-row device identity, seeded by migration code with crypto.randomUUID()
-- and a platform-derived default name ("Desktop", "Android", "Browser").
CREATE TABLE sync_local (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','utc'))
);

CREATE TABLE sync_peers (
  peer_device_id TEXT PRIMARY KEY,
  peer_name TEXT NOT NULL,
  shared_key TEXT NOT NULL,            -- base64 32-byte pairing key (§4)
  last_address TEXT,                   -- "host:port" hint; may go stale
  applied_through_seq INTEGER NOT NULL DEFAULT 0,  -- cursor into THAT PEER's change log
  last_synced_at TEXT,
  paired_at TEXT DEFAULT (datetime('now','utc')),
  status INTEGER DEFAULT 1 CHECK (status IN (0,1)) -- 0 = unpaired (kept for history)
);

-- Compacted change log: exactly one row per ever-changed domain row.
CREATE TABLE sync_change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- AUTOINCREMENT: monotone even after DELETE
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  UNIQUE(table_name, row_id)
);

CREATE TABLE sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('lww','unique_name','unique_alias','transfer_repair')),
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  peer_device_id TEXT NOT NULL,
  winner TEXT NOT NULL CHECK (winner IN ('local','remote')),
  loser_snapshot TEXT NOT NULL,        -- JSON of the losing row version
  resolved_at TEXT DEFAULT (datetime('now','utc')),
  seen INTEGER DEFAULT 0 CHECK (seen IN (0,1))
);
```

### 2.3 Change tracking: triggers own the log, app code owns the version

**SQLite triggers** maintain `sync_change_log`; **application code** stamps
`version_hlc` / `origin_device_id`. Rationale:

- Triggers run identically on all three engines (sql.js, better-sqlite3,
  @capacitor-community/sqlite) and guarantee *no mutation path is ever missed*
  — including the merge path itself. Applying peer B's change on device A
  re-registers the row in A's log at a fresh local `seq`, so device C later
  picks it up from A. **This is what makes sync transitive.**
- Triggers cannot generate an HLC (SQLite triggers can't modify `NEW`, and
  keeping clock state in SQL is fragile), so version stamping must come from
  app code regardless — a `syncStamp()` helper in
  `packages/database/src/queries.ts` appends
  `version_hlc = ?, origin_device_id = ?` to every INSERT/UPDATE of the three
  synced tables.

Per synced table, `AFTER INSERT` and `AFTER UPDATE` triggers (example):

```sql
CREATE TRIGGER trg_entries_changelog_ins AFTER INSERT ON entries BEGIN
  DELETE FROM sync_change_log WHERE table_name='entries' AND row_id=NEW.entry_id;
  INSERT INTO sync_change_log(table_name,row_id) VALUES('entries', NEW.entry_id);
END;
-- identical body for AFTER UPDATE
```

DELETE-then-INSERT (not UPSERT) is deliberate: `AUTOINCREMENT` guarantees a
fresh `seq` strictly greater than any ever issued. No `AFTER DELETE` trigger —
the app only soft-deletes (`status = 0`), which is an UPDATE.

**Exception:** balance-only `UPDATE ledgers SET balance = …` statements must
*not* stamp a new `version_hlc` (balance is device-local, §6 post-pass B). The
trigger still logs the row, which is harmless — it just re-sends an otherwise
unchanged ledger row once.

### 2.4 Backfill

Migration 002 performs two backfills so pre-sync data participates normally:

1. **Versions**: `version_hlc` derived from existing timestamps
   (`updated_at ?? created_at`, encoded per §3 with logical counter `0000` and
   this device's id), `origin_device_id` = this device.
2. **Change log seeded** with one row per existing row in `books`, `ledgers`,
   `entries`. This makes the protocol uniform: a brand-new peer with cursor `0`
   receives everything as an ordinary delta — **no special bootstrap-snapshot
   code path**.

Safety net: the delta collector lazily stamps any row with
`version_hlc IS NULL` (a mutation path that forgot to stamp) from
`updated_at ?? created_at` before sending, and logs a dev warning.

---

## 3. Hybrid logical clock (HLC)

The existing `updated_at` has 1-second resolution and trusts the wall clock —
unusable for LWW. Instead every write is stamped with an HLC encoded as a
fixed-width, **lexicographically ordered** TEXT value (string compare == HLC
compare):

```
<physical millis, 15-digit zero-padded>-<logical counter, 4-hex>-<device_id first 8 chars>
e.g. 001751803254123-0003-3f9a12bc
```

15 decimal digits covers year ~33,000; the 4-hex counter allows 65k writes per
millisecond (overflow bumps the physical part by 1 ms — standard HLC behavior).

Implemented as a pure, dependency-free singleton in
`packages/shared/src/sync/hlc.ts` (usable from `database`, `stores`, `sync`):

- `now()` — `physical = max(Date.now(), last.physical)`; same physical →
  `counter + 1`, else `counter = 0`.
- `receive(remoteHlc)` — advance local state to `max(local, remote)`. **The
  merge loop calls this for every remote row applied.** This defuses
  wall-clock skew: after one sync, a slow-clocked device's subsequent edits are
  stamped ahead of everything it has seen, so *"I saw your edit and then
  edited" always wins*.
- Startup seeding: `max(MAX(version_hlc) across the three tables, Date.now())`
  — no persistence table needed.
- The device-id suffix makes every HLC globally unique, so ordering is total
  and deterministic: equal HLCs cannot occur between different devices.

`created_at` / `updated_at` keep their current behavior and are used only for
display; sync ignores them (except the one-time backfill).

---

## 4. Pairing

Roles: the **host** is whichever device can accept connections (Electron
desktop in v1); the **joiner** is any device. See `pairing-sequence.puml`.

1. Host Sync screen → "Pair new device". Host generates a random 32-byte
   `pairing_secret` and shows a **QR code** encoding
   `ledger-sync://pair?v=1&host=192.168.1.20&port=44321&device=<host_device_id>&secret=<base64url>`
   plus the same string as copyable text. The offer expires after 2 minutes or
   one successful use.
2. Joiner scans (Capacitor barcode plugin) or pastes the string, opens
   `ws://host:port`, and sends
   `pair_request { device_id, device_name, proof: HMAC(secret, "pair-v1" || joiner_id || host_id) }`.
3. Host verifies the proof and replies
   `pair_accept { device_id, device_name, proof: HMAC(secret, "pair-v1" || host_id || joiner_id) }`;
   the joiner verifies it — mutual authentication.
4. Both derive the **long-lived pairing key**
   `K = HKDF-SHA256(secret, salt="ledger-sync-v1", info=sort(device_id_a, device_id_b))`
   and insert a `sync_peers` row. The joiner stores the host's `last_address`;
   the host stores `NULL` (it cannot dial a phone/browser back in v1).

Because the full 32-byte secret rides in the QR code, no PAKE is needed. The
manual-entry fallback uses the same full string — long, but copy-pasteable.
A short 6-digit code is deliberately **not** offered in v1: without PAKE it
would be brute-forceable. (Future extension if typing UX matters.)

**Unpairing**: set `sync_peers.status = 0` locally (keeps conflict history
attributable); a best-effort `unpair` message is sent if a session happens to
be open. The other side discovers on next connect (`error{unknown_peer}`) and
prompts to remove or re-pair. **Re-pairing** replaces the row with a fresh key
and resets `applied_through_seq` to 0 — safe, because re-applying deltas is
idempotent (§5.4).

---

## 5. Sync session protocol

JSON messages inside encrypted binary WebSocket frames. Only
`hello` / `challenge` / `auth` / `auth_ok` / `error` travel in plaintext. See
`session-sequence.puml` and `session-state.puml`.

### 5.1 Handshake and channel security

```
C→S  hello      { v: 1, device_id, nonce_c }        // 16-byte random nonces
S→C  challenge  { device_id, nonce_s }              // or error{unknown_peer}
C→S  auth       { mac: HMAC(K, "auth-c" || nonce_c || nonce_s) }
S→C  auth_ok    { mac: HMAC(K, "auth-s" || nonce_s || nonce_c) }
```

Both sides derive session keys `HKDF(K, nonce_c || nonce_s)` → two AES-256-GCM
keys (one per direction) with monotone counter nonces. All subsequent frames
are `[8-byte counter | GCM ciphertext]`. Replay across sessions is impossible
(fresh nonces); replay within a session is impossible (counters must strictly
increase). All crypto is WebCrypto (`crypto.subtle`), available in all three
shells. A protocol-version mismatch returns `error{protocol_version}` and the
UI suggests updating the app.

### 5.2 Delta exchange — pull, then push

Each device keeps, per peer, `applied_through_seq`: the highest `seq` **of that
peer's change log** it has fully applied. A session is two mirrored transfers:

```
C→S  sync_begin   { cursor }                        // "send me your log > cursor"
S→C  changes      { table: 'books',   rows: [...] } // batches of ≤ 500 rows
S→C  changes      { table: 'ledgers', rows: [...] } // strictly books → ledgers → entries
S→C  changes      { table: 'entries', rows: [...] }
S→C  changes_done { through_seq }                   // sender's MAX(seq), snapshotted at sync_begin
C→S  apply_ack    { through_seq }                   // only after ALL batches applied + cursor persisted
```

…then the same exchange with roles swapped, then `C→S sync_complete`, close.
Each row travels complete (minus `ledgers.balance`) including `version_hlc`
and `origin_device_id`. Sender-side collection is a join:

```sql
SELECT r.* FROM sync_change_log l JOIN entries r ON l.row_id = r.entry_id
WHERE l.table_name = 'entries' AND l.seq > :cursor AND l.seq <= :snapshot;
```

**Echo suppression** (optimization, not correctness): skip rows whose
`origin_device_id` equals the receiving peer's id.

### 5.3 Why table-ordered batches are FK-safe

The compacted log's key invariant: compaction only ever moves a row's `seq`
*up*. So every row changed after the peer's cursor is in the delta, and every
row *not* in the delta is unchanged since the cursor — the receiver already
has it. A parent (book/ledger) referenced by an incoming entry is therefore
either already present or arrives in an earlier table batch of the same delta.
Soft deletes keep parent rows physically present, so tombstoned parents cannot
break foreign keys either.

### 5.4 Idempotency and crash safety

- Each batch is applied in one `IDBConnection.transaction` (supported by all
  four drivers).
- The cursor advances **only** in the same transaction that completes the apply
  of the final batch — never partially.
- Connection drops mid-pull → cursor unchanged → next session re-requests the
  same delta. Applying a row whose `version_hlc` is not strictly greater than
  the local one is a no-op, so re-application is harmless.
- Drop after the pull but before the push → data flowed one way; cursors record
  exactly that; the next session completes the other direction. LWW convergence
  needs no cross-device transactionality.
- Local writes made *during* a session are excluded by the `seq <= snapshot`
  bound and simply go out next time.

---

## 6. Merge algorithm

Receiver-side pipeline per table batch, inside one transaction. See
`merge-activity.puml`.

1. **Advance the clock**: `hlc.receive(row.version_hlc)` for every incoming row.
2. **Per-row LWW decision** (by primary key):
   - Not present locally → INSERT verbatim — remote `version_hlc` /
     `origin_device_id` are preserved, never re-stamped.
   - Present and `remote.version_hlc > local.version_hlc` → full-row UPDATE
     (remote version fields preserved). If content differs and
     `local.origin_device_id ≠ remote.origin_device_id`, record a
     `sync_conflicts(kind='lww', winner='remote')` row with the losing local
     row snapshotted as JSON.
   - Present and `remote.version_hlc <= local.version_hlc` → skip. Record
     `kind='lww', winner='local'` only when content differs and origins differ.
   - Applies use plain INSERT/UPDATE, so the change-log triggers fire →
     transitivity for free.
3. **Tombstones**: `status` is an ordinary column, so delete-vs-edit resolves
   by the same row-level LWW — no special casing.
4. **UNIQUE collisions** (checked before writing, i.e. a *different* PK already
   holds the same unique value):
   - `books.name`: the row with the **losing** HLC is renamed to
     `name + ' (' + first 4 chars of its origin_device_id + ')'` (counter
     suffix on repeat). If the local row loses, the rename is a normal local
     edit (fresh HLC, logged) so it propagates and converges; if the incoming
     row loses, it is inserted already renamed. Record `unique_name`.
   - `ledgers(book_id, alias)`: the losing row's `alias` is set to `NULL`
     (SQLite unique indexes treat NULLs as distinct). Record `unique_alias`.
5. **Post-pass A — transfer-group repair** (after the entries batch, same
   transaction): for each `transfer_group_id` touched by the batch where both
   entries exist locally but disagree on `status` or `amount`, copy the field
   from the higher-HLC entry to its pair as a fresh stamped local edit; record
   `transfer_repair`. If only one entry of a group exists locally, do nothing
   (the UI already tolerates missing pairs). Partial arrival *within* one delta
   cannot happen: any operation on a pair touches both rows, so both sit above
   any given cursor.
6. **Post-pass B — balance recompute** (same transaction): for every
   `ledger_id` referenced by the batch,

   ```sql
   UPDATE ledgers SET balance = (
     SELECT COALESCE(SUM(CASE cat_direction WHEN 'add' THEN amount ELSE -amount END), 0)
     FROM entries WHERE ledger_id = :id AND status = 1
   ) WHERE ledger_id = :id;
   ```

   matching `entryStore.calculateLedgerBalance()` semantics. This UPDATE does
   **not** stamp `version_hlc` — balance is derived, device-local state.
7. After the session the engine emits an event; Zustand stores re-fetch so the
   UI shows merged data, and the Sync screen surfaces
   `sync_conflicts WHERE seen = 0` as "N conflicts resolved, kept newer
   version".

**Why this converges**: full-row LWW keyed on a totally-ordered, globally
unique version is a state-based CRDT (a LWW register per row) — merge is
commutative, associative, and idempotent, so any pairwise sync order reaches
the same state. Repairs and unique-collision resolutions are expressed as
ordinary stamped local edits, so they converge through the same mechanism.

---

## 7. Architecture and transports

See `components.puml`. New workspace package **`packages/sync`** (depends on
`@ledger/database` + `@ledger/shared`, no React):

```
packages/sync/src/
  engine/SyncEngine.ts        # orchestrates a session over a PeerChannel + IDBConnection
  engine/collector.ts         # delta queries against sync_change_log
  engine/merge.ts             # §6 pipeline
  engine/pairing.ts           # pairing handshake (host + joiner)
  protocol/messages.ts        # discriminated-union message types (protocol v1)
  protocol/secureChannel.ts   # HMAC auth + HKDF + AES-GCM framing (WebCrypto)
  transport/types.ts          # PeerChannel / TransportClient / TransportServer
  transport/wsClient.ts       # browser / Capacitor / renderer WebSocket client
  transport/electronRelay.ts  # renderer-side PeerChannel over IPC events
```

The engine never touches WebSocket APIs; it consumes:

```ts
interface PeerChannel {
  send(frame: Uint8Array): Promise<void>;
  onFrame(cb: (frame: Uint8Array) => void): void;
  onClose(cb: (reason?: string) => void): void;
  close(): Promise<void>;
}
interface TransportClient { connect(address: string): Promise<PeerChannel>; }
interface TransportServer {
  start(port: number): Promise<{ host: string; port: number }>;
  onConnection(cb: (ch: PeerChannel) => void): void;
  stop(): Promise<void>;
}
```

Crypto framing wraps a `PeerChannel` (a `SecureChannel` decorator), so a future
Internet transport — WebRTC `RTCDataChannel` plus a minimal signaling service —
is just another `PeerChannel` implementation; the protocol is byte-stream
agnostic.

**Electron**: a `ws`-based `TransportServer` runs in the **main process** (the
only shell that can listen), but the `SyncEngine` runs in the **renderer** —
one engine implementation for all platforms, reusing the renderer's existing
`IDBConnection`. Main relays raw frames over IPC (`sync:server-start/stop/info`,
events `sync:conn-opened` / `sync:frame` / `sync:conn-closed`, invoke
`sync:send`), exposed in `preload.ts` beside the existing `db` surface. Main
stays dumb: no keys, no protocol — encryption happens in the renderer above the
relay. A desktop can also dial out as a plain WebSocket client, so
desktop↔desktop works.

**Capacitor / browser**: client-only, via the webview's native `WebSocket`.

**Consequences stated plainly:**

- In v1, phone↔phone and browser↔browser cannot sync directly (neither can
  listen); they converge transitively through a desktop.
- **Android mixed-content caveat**: `capacitor.config.ts` sets
  `androidScheme: 'https'`, so `ws://` to a LAN address is mixed content —
  requires a cleartext allowance scoped to private ranges (verify early in
  implementation). App-layer AES-GCM keeps payloads encrypted regardless of
  the `ws://` transport.
- The browser shell must run on `localhost` or https for `crypto.subtle`.

**New dependencies**: `ws` (desktop main), a QR renderer (e.g. `qrcode`) in
web, a barcode scanner plugin in mobile. Zero external infrastructure.

**Security honesty**: the scheme provides mutual authentication,
confidentiality, and replay protection on the LAN. It does **not** provide
forward secrecy (ephemeral ECDH could be added inside the same handshake later
without protocol redesign). Pairing keys rest in SQLite in plaintext — the same
trust level as the financial data itself, which is unencrypted at rest today.

---

## 8. UI surface

- New route `/settings/sync` (lazy, like existing routes) linked from the
  Settings screen; `navigationStore` gains a `sync` screen.
- New `packages/stores/src/syncStore.ts`:
  `{ deviceId, deviceName, peers[], serverStatus, sessionsByPeer: { phase, progress, error }, unseenConflictCount }`
  with actions `loadSyncState`, `renameDevice`, `startPairingHost`,
  `completePairingJoin(payload)`, `syncNow(peerId)`, `syncAll()`,
  `unpair(peerId)`, `loadConflicts`, `markConflictsSeen`.
- **SyncScreen**: editable device name + id; desktop-only server card
  (listening `host:port`, start/stop); paired-device list with name,
  "last synced 2 hours ago", per-peer **Sync now** with phase/progress and a
  result toast ("Pulled 12, pushed 3, 1 conflict resolved — kept newer
  version"); **Sync all**; **Pair new device**.
- **PairDeviceModal**: host mode renders QR + copyable string + expiry
  countdown; join mode offers Scan QR / paste field.
- **ConflictLogModal**: `sync_conflicts` newest-first — kind, human-readable
  row description, winner, timestamp, expandable loser JSON. Read-only in v1
  ("restore losing version" is a future extension).
- Platform gating reuses the `main.tsx` detection style (`window.electronAPI`
  → can host; `window.Capacitor` → scanner available).

---

## Implementation phasing

| Phase | Scope | Key tests |
|---|---|---|
| **6a** | Migration `002_sync` (columns, tables, triggers, backfills, device identity); migration-runner list; HLC module; `syncStamp()`; consolidate `entryStore`'s inline SQL into `queries.ts` (pre-existing TODO) and stamp all mutation sites | Trigger fires on every mutation path (sql.js); seq monotonicity across delete/reinsert; HLC ordering/overflow/receive; backfill correctness; **verify triggers on the Capacitor driver on-device** |
| **6b** | `packages/sync` engine, collector, merge, protocol types, in-memory `LoopbackChannel` | **The crown jewel**: two/three independent in-memory sql.js DBs driven through real store mutations, synced via loopback, then byte-for-byte table comparison (minus balance) + recomputed-balance equality. Scenarios: concurrent edit; delete-vs-edit both orders; transfer-pair repair; `books.name` / alias collisions; 3-device transitivity (final sync is an empty delta); crash injection after every message type; 1-hour clock skew; cursor-0 re-pair idempotence |
| **6c** | `secureChannel`, WS client, Electron main WS server + IPC relay + preload surface, pairing end-to-end | Crypto test vectors, tamper/replay rejection; pairing over real sockets |
| **6d** | syncStore, SyncScreen, PairDeviceModal, ConflictLogModal, routing | Component tests per existing patterns |
| **6e** | Hardening: ~50k-entry perf on sql.js (batch sizing, a bulk mode that suppresses per-write IndexedDB persistence), Android cleartext verification, unpair/re-pair flows, doc finalization against as-built | Perf harness; on-device Android sync |

## Future extensions (named, not designed)

Auto-sync-on-connect · mDNS discovery · WebRTC Internet transport (new
`PeerChannel` + minimal signaling) · conflict "restore losing version" ·
short-code PAKE pairing · key-at-rest hardening (Electron `safeStorage`,
Android Keystore).

## Open questions (recorded, not blocking)

1. **Browser-shell durability**: browsers can evict IndexedDB; a synced browser
   profile that loses data recovers by re-syncing — confirm that story is
   acceptable.
2. **Manual pairing string length**: acceptable given QR is the primary path?
3. **Conflict log depth**: is read-only (no restore) enough for v1?
