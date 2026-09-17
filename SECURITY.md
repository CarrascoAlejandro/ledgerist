# Security Policy

## Supported versions

Ledger is pre-1.0 and ships as beta builds. Only the **most recent release** is
supported; fixes are not backported.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use private vulnerability reporting instead: go to the **Security** tab of this
repository → **Report a vulnerability**. That opens a private advisory only the
maintainer can see. (If the tab is not visible, enable it under Settings →
Code security → Private vulnerability reporting.)

Please include what you would put in any bug report — build, version, platform,
reproduction steps — plus the impact you think it has. Expect an
acknowledgement within a week or so; this is a personal project, not a staffed
product, so please be patient.

## What is in scope

The parts of Ledger where a vulnerability would actually matter:

- **Device Sync** — the pairing handshake (HMAC/HKDF), the `SecureChannel`
  AES-GCM transport, and the merge path. Anything that lets an unpaired device
  join a sync session, read plaintext off the wire, downgrade the handshake,
  or corrupt another device's data.
- **The Electron shell** — anything that escapes the renderer sandbox, abuses
  the `window.electronAPI` IPC surface exposed by `preload.ts`, or reaches the
  filesystem or the SQLite file outside the app's own data directory.
- **The Android build** — anything reachable by another app on the device,
  including the WebView configuration and the local sync listener.
- **SQL injection** or data corruption through the plain-text entry parser.

## What is not in scope

- **Unsigned installers.** The `.deb`, `.AppImage` and `.apk` are not
  code-signed by a recognised CA, so your OS will warn on install. This is a
  known, accepted trade-off of free distribution, not a vulnerability.
- **Cleartext `ws://` on the LAN.** Device Sync dials plain WebSockets, which
  is why the Android build sets `usesCleartextTraffic`. Payloads are
  encrypted at the application layer with AES-GCM; the transport itself is
  deliberately not TLS. Reports that amount to "the socket is not TLS" will be
  closed — reports that break the application-layer crypto will not.
- **Local attacks by someone who already has your unlocked device.** The
  SQLite database is not encrypted at rest. Ledger relies on the OS user
  account and the app sandbox for that.
- Anything in a dependency that is not reachable from Ledger's own code paths.

## Threat model, briefly

Ledger is local-first: there is no server, no account, and no data ever leaves
your devices except during an explicit, manually triggered LAN sync between
devices you have paired. The design, including the pairing and session
protocols, is documented in [`docs/sync/DESIGN.md`](docs/sync/DESIGN.md).
