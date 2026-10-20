# Retruco web app

Spanish-language Venezuelan Truco with Svelte 5, SvelteKit 3, TypeScript 6,
shadcn-svelte, Tailwind, and SVG cards. The authoritative engine lives in
[retruco-backend](https://github.com/neiam00/retruco-backend).
Read [DESIGN.md](DESIGN.md) before changing the interface.

## Develop and verify

Use Node 26 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Start the Go API at `127.0.0.1:8080` with a migrated PostgreSQL database. Vite
forwards `/api` and WebSockets, keeping cookies on the frontend origin. Public
environment variables are declared explicitly in `src/env.ts`; copy
`.env.example` only if you need overrides. Never commit real `.env` files.

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests require the API/database and Vite already running. Use a disposable
database: they create users and matches, play cards, send chat, and forfeit games.
The desktop/mobile suite covers four-player seating and declarations, a full
two-player hand, chat, reconnect, forfeit, account dialogs and rulebook layout.
It also verifies public-table joining, private-code joining, spectator perspective
switching, and account history after login in a fresh browser context.
Screenshots and traces are written to ignored output directories.

For the built edge proxy check, build first and run `pnpm exec wrangler pages dev
.svelte-kit/cloudflare --ip 127.0.0.1 --port 8788`. Supply `BACKEND_ORIGIN` and
`API_PROXY_SECRET` through an ignored `.dev.vars` file. Use a separate API and
disposable database, configure its matching secret, and allow
`http://127.0.0.1:8788` as an origin. Then run:

```sh
RETRUCO_EDGE_URL=http://127.0.0.1:8788 pnpm exec playwright test tests/edge-proxy.spec.ts --project=desktop
```

This test exercises real session cookies, WebSocket chat and reconnect through
the built Pages worker. It is skipped when `RETRUCO_EDGE_URL` is unset.

ESLint and Prettier enforce source readability. `bits-ui` currently pulls a
`runed` version whose peer range names SvelteKit 2; this project retains the
requested Kit 3. Build and dialog/browser checks pass, but inspect that peer
compatibility warning when upgrading rather than suppressing it.

## Deploy to Cloudflare Pages

Build command: `pnpm build`. Output: `.svelte-kit/cloudflare`. The adapter and
`wrangler.toml` configure Pages advanced mode. The lobby, rules and credits are
prerendered; match pages are dynamic and excluded from search indexing.

Set these public build values only as needed:

| Variable              | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `API_ORIGIN`          | Keep empty for the chosen same-origin `/api` deployment.  |
| `CARD_ASSET_ORIGIN`   | Optional public B2/CDN origin with files under `/cards/`. |
| `GOOGLE_ANALYTICS_ID` | Optional measurement ID; empty disables analytics.        |

Set these **private runtime secrets** in Pages production settings:

| Variable           | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `BACKEND_ORIGIN`   | HTTPS origin of the NGINX backend, without an `/api` suffix. |
| `API_PROXY_SECRET` | Same long random value configured in the Go API.             |

The hook forwards `/api/*`, preserving the browser's Origin, cookies and
WebSocket upgrades. It overwrites forwarding credentials and client addresses;
it does not follow backend redirects. Missing configuration returns a Spanish
503 response. The browser continues to use `https://retru.co.ve/api`.

Bind the `retru.co.ve` custom domain in Pages and configure the backend's allowed
origins to match it exactly. Configure the NGINX host using the backend runbook.
Do not point `BACKEND_ORIGIN` back at `retru.co.ve`, which would create a loop.
No deployment or cloud resources are created by `pnpm build`.

Analytics deliberately records `/mesa` without private match codes or query
strings. Chat, names, cards and command contents are never analytics properties.
Chat is retained in backend match snapshots by the user's explicit decision.

## Assets and scope

The Spanish SVG deck comes from
[gjenkins20/spanish-playing-cards-svg](https://github.com/gjenkins20/spanish-playing-cards-svg).
See `static/cards/ATTRIBUTION.md` and `/creditos` for attribution. Card faces have
an opaque ivory CSS backing because the source artwork contains transparent
regions. DiceBear avatars are generated locally and Lucide supplies UI icons.

P0 is online, server-authoritative play. It does not load a WASM engine. Voice
chat and local CPU matches belong to P1 and require a separate request.
