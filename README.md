# Retruco web app

Spanish-language Venezuelan Truco with Svelte 5, SvelteKit 3, TypeScript 6,
shadcn-svelte, Tailwind, and WebP cards generated from editable SVG artwork. The authoritative engine lives in
[retruco-backend](https://github.com/neiam00/retruco-backend).
Read [DESIGN.md](DESIGN.md) before changing the interface.

## Public site information

`static/llms.txt` publishes a concise Spanish overview and annotated links to the
public pages at `/llms.txt`, following the [llms.txt proposal](https://llmstxt.org/).
Keep it aligned with the lobby, rules, and credits when those pages change. It is
guidance for AI tools, not a replacement for `robots.txt` or `sitemap.xml`, and does
not promise search-ranking improvements.

The root layout supplies Open Graph, Twitter large-image cards, and Apple web-app
metadata. Social URLs use `https://retru.co.ve` and the current pathname, without
query strings or fragments. The shared preview is `static/og-image.png` (1200 × 630).
Edit `artwork/social-preview.html`, then run `pnpm social:build` to regenerate it
using the installed Nunito Variable font and the current card manifest. This
requires Playwright Chromium (`pnpm exec playwright install chromium`); normal
deployment builds serve the committed PNG and do not launch a browser.
Commit the updated PNG along with its source. The composite retains the cards'
CC BY-SA 3.0 license; see `static/og-image.LICENSE.md`.

## Develop and verify

Voice preferences live at `/configuracion`. Each match has an explicit audio
join control, with listening, open-mic, and push-to-talk modes. Hold V or the
on-screen button to talk; typing in inputs never activates the microphone.
Leaving audio or navigating away releases microphone tracks and connections.
Room creators choose whether spectators may speak; everyone may listen.
Voice requires microphone permission and HTTPS outside localhost.
Participants who both lack speaking permission remain visible in the roster but
do not create an audio connection to one another. Speakers still connect to
listeners so spectator listening behavior stays unchanged.

Game connections request transport version 2 with `?transport=2`. A complete
authorized snapshot starts each connection; later `game_update` messages replace
the current game view and append or reset retained chat/event histories. Stream
epoch and sequence gaps disable actions until a full snapshot resynchronizes the
client. Transport versions are independent of rules and CPU-engine versions.
Legacy full snapshots remain supported during backend rollout or rollback.
Healthy connections do not fetch a redundant HTTP snapshot. Rejected legacy
handshakes use one HTTP diagnostic to distinguish missing rooms and expired
sessions from transient failures. Reconnects use jittered exponential backoff,
keep retries within two seconds during the existing ten-second room grace,
honor server retry delays, and pause while offline. Returning online reconnects
immediately and cancels any queued retry.

`tests/match-stream.spec.ts` covers this protocol and reconnect lifecycle with
mocked sockets, without requiring an API or database. The unit reducer tests
cover history reconstruction and legacy snapshots.

`tests/voice.spec.ts` exercises native WebRTC with synthetic microphone audio.
Set `TEST_API_ORIGIN` when testing against a separate backend; it defaults to
`http://127.0.0.1:8080`. Production relay setup is documented in the backend's
`deploy/VOICE.md`.

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
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Browser tests require the API/database and Vite already running. Use a disposable
database: they create users and matches, play cards, send chat, and forfeit games.
The desktop/mobile suite covers four-player seating and declarations, a full
two-player hand, chat, reconnect, forfeit, account dialogs and rulebook layout.
It also verifies public-table joining, private-code joining, spectator perspective
switching, and account history after login in a fresh browser context.
Screenshots and traces are written to ignored output directories.
The WebKit project checks card animation frame pacing, concealed cards, and sound
controls. See [Safari rendering measurements](docs/safari-card-performance.md)
for the SVG regression and the WebP comparison.

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

## Account verification

Login and registration load Cloudflare Turnstile only when the account dialog opens. Configure
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the backend `.env`; the frontend
fetches the public key from `/api/turnstile`. Never put the secret in frontend
variables. Missing keys disable login and registration; guest play remains available. The backend validates every token through Siteverify before creating
an account or checking credentials, including the matching `register` or `login` action and hostname against `ALLOWED_ORIGINS`.
Expired, spent, or failed tokens must be replaced before retrying either form. Switching forms requires a fresh verification.

`registration-check.spec.ts` mocks the external widget SDK to exercise token
expiry, retries, dialog cleanup, and missing-token handling; Go API tests verify
Siteverify responses and that rejected requests never create users or sessions.
For the full account/multiplayer browser suite, use a disposable backend with
`APP_ENV=development` and Cloudflare's public dummy pair:

```dotenv
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Set `ALLOWED_ORIGINS` to your test frontend origin. Cloudflare returns synthetic
metadata for dummy credentials, so only this exact public pair and dummy token
in development use the verification success flag without action/hostname checks.
Production and real keys always require the configured hostname and matching action. Direct registration fixtures
use the public dummy token; real credentials are never committed to tests.
See [Cloudflare's testing guide](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

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
See `static/cards/ATTRIBUTION.md` and `/creditos` for attribution. Edit card designs
in `artwork/cards/*.svg`, then run `pnpm cards:build` and commit the generated
`static/cards/*.webp` files and `src/lib/card-assets.json`. Production builds also
run this conversion. Gameplay loads only the near-lossless, 576px-wide WebP copies:
the intricate SVG paths otherwise cause long rendering stalls in Safari.
The encoder uses near-lossless quality 70, preserving fine detail while reducing
the complete deck by 31% versus the previous lossless encoding. Opaque pixels
differ by at most 2/255 per RGB channel from the previous deck.
Content hashes in filenames prevent stale images after design changes. If using
`CARD_ASSET_ORIGIN`, upload the generated WebP deck before deploying the client.
The Cloudflare `_headers` rule serves card WebPs with
`Cache-Control: public, max-age=31536000, immutable`, allowing browsers to reuse
them for a year without revalidation. Keep the content-hashed filenames when
changing artwork; never replace the bytes at an existing card URL. The optional
B2 uploader sets the same cache policy. Attribution and HTML keep their normal
cache policies.
After the first valid room snapshot, the client warms all 41 public card images
in the background, including while players are waiting to join. Two low-priority
loads run at a time and decode asynchronously, yielding between cards. Decoded
images remain referenced for the room's lifetime and are released when leaving;
the HTTP cache persists. Warmup never blocks gameplay, and animations retain
their decode-before-start safeguard for an immediate deal or a failed preload.
The source SVGs include an opaque paper layer beneath the traced artwork. The
card build checks interior alpha and fails if transparent paper returns; only
the rounded outer corners retain transparency. CSS backing is a rendering fallback. DiceBear avatars are generated locally and Lucide supplies UI icons.

Online matches use the server-authoritative rules engine. P1 voice uses Opus
over WebRTC, with room-scoped signaling and optional coturn relay credentials
from the API.

## CPU rooms

Choose a CPU opponent for 1v1, or select any of the three other seats for CPU
players in 2v2. Unselected seats remain open for human players. The match browser
shows the number of CPU players. The creator's browser normally controls the
CPU; another connected human takes over after a disconnect. When everyone
disconnects, the match waits for a human to return.

One dedicated Worker handles all CPU seats assigned to that connection. The
server sends only the acting CPU's authorized view and validates every returned
move. The Go policy uses its own cards and visible plays; human opponents'
hidden cards and the deck never enter the Worker. Duplicate snapshots, old
revisions, revoked control, and late Worker errors cannot submit stale moves.
Human-only matches never download the WASM module.

Deploy the P1 backend before this frontend. The browser engine and its matching
Go runtime are checked into `src/lib/cpu/vendor` so Cloudflare builds need no Go
toolchain or backend checkout. The manifest records the backend commit,
toolchain, and SHA-256 hashes. The Go license is also shipped at
`/licenses/go.txt`.

To update the engine after committing backend changes:

```sh
pnpm update:cpu
# Or choose a different backend checkout:
pnpm update:cpu /path/to/retruco-backend
pnpm check
pnpm lint
pnpm test
pnpm build
```

The update command builds WASM and copies its exact `wasm_exec.js` runtime as a
pair. Never replace just one of those files. The engine rejects mismatched
protocol/rules versions. Its assets are bundled with content hashes and loaded
only after the server assigns CPU control. Worker failures show a retry action.

## CPU measurements

Measured on 2026-10-20 on an Apple M5 with Chromium 156.0.8078.4, using the
production build served locally. Each run used a fresh browser context.
The mobile profile used a Pixel 7 viewport with CDP 4× CPU throttling configured.
These are emulation results, not measurements from a physical phone.

| Profile              | Seats | Decisions | Worker startup | Median decision round trip |    P95 | Largest sampled WASM memory |
| -------------------- | ----: | --------: | -------------: | -------------------------: | -----: | --------------------------: |
| Desktop              |     4 |        84 |        22.8 ms |                     1.8 ms | 3.2 ms |                     5.5 MiB |
| Mobile emulation, 4× |     2 |        38 |        56.8 ms |                     3.5 ms | 6.9 ms |                       5 MiB |
| Mobile emulation, 4× |     4 |        42 |        47.8 ms |                     3.6 ms | 8.6 ms |                       5 MiB |

Startup includes Worker initialization, the local WASM fetch, and runtime
startup. The WASM download was 4,419,352 uncompressed bytes and took 5.2–8.1 ms
over localhost; this does not predict real mobile-network download time.
Decision round trips include serialization, Worker scheduling, Go execution,
and the reply, but exclude the intentional 650 ms pause before showing a move.
The longest observed round trip was 37.8 ms. Deals and decision counts differ
between runs, so these are descriptive samples, not a controlled speedup claim.

Memory was sampled after startup and between hands using CDP. WASM linear memory
was measured separately from the JavaScript heap; the latter reached about
0.83 MiB used and 2 MiB allocated. These counters do not include the entire
browser process or guarantee a universal peak. See
[`docs/cpu-performance.json`](docs/cpu-performance.json) for the raw measurements.
Go/WASM was chosen to share the rules, not because a JavaScript performance
advantage has been established.

`tests/cpu.spec.ts` reproduces complete CPU games, room permissions and handoff,
checks lazy loading, and attaches performance reports. Run against a disposable
API/database; tests create real matches. Existing human-only multiplayer tests
remain part of regression coverage.
