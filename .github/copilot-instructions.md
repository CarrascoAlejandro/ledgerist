# Repository contribution guidelines

## Project overview
- Monorepo using npm workspaces.
- Apps live in `apps/` (primary UI in `apps/web`).
- Shared logic lives in `packages/` (`shared`, `database`, `stores`).

## Development workflow
- Install dependencies: `npm install`.
- Run tests: `npm test` (or `npx jest --testPathPattern="apps/web"` for web-only).
- Type-check: `npm run typecheck` (or `npx tsc -p apps/web/tsconfig.json --noEmit`).
- Build web app: `npm run build`.

## Coding standards
- Keep changes minimal and focused.
- Follow existing TypeScript patterns and strict typing rules.
- Reuse existing utilities and stores before adding new helpers.
- Avoid adding new dependencies unless required; update `package.json` and lockfile together.
- Do not commit generated artifacts (for example, `dist/` or `node_modules/`).

## Testing expectations
- Add or update tests when behavior changes, using existing Jest setup.
- Keep tests near related code (see existing `__tests__` folders).
