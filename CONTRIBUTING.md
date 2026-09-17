# Contributing

Thanks for the interest — but please read this before opening anything.

## Pull requests are not being accepted right now

This is a personal project with a single maintainer. **Unsolicited pull
requests will be closed without review.** That is not a judgement on the code
in them; there is simply no review capacity, and merging outside contributions
carries a copyright and maintenance cost this project is not set up to absorb
yet. This policy may change — this file is the source of truth for it.

## What *is* welcome

**Bug reports.** If something is broken, an issue with clear reproduction steps
is genuinely useful. Include:

- which build you are on (`.deb`, `.AppImage`, `.apk`) and its version
- your OS / Android version
- what you did, what you expected, what happened instead
- whether Device Sync was involved, and if so how many devices

**Feature ideas** are fine to file too, with no promise that any will be built.

**Questions** about how something works: open an issue, or read
[`docs/sync/DESIGN.md`](docs/sync/DESIGN.md) first if it is sync-related.

## Forking

You are free to fork and modify Ledger — that is the whole point of the
GPL-3.0 license. If you distribute your modified version, you must publish
its source under the same license. See [`LICENSE`](LICENSE).

## If you are working on this repo anyway

```bash
npm install
npm run typecheck    # tsc --noEmit over all 7 tsconfigs
npm test             # jest, all 5 projects
```

Both must pass — CI runs them on every push, and the release pipeline refuses
to package a tag that fails either. Commit messages are validated by a
`commit-msg` hook: conventional type, first line ≤ 64 characters, no trailing
period.
