# Retruco frontend | [retru.co.ve](https://retru.co.ve)

A Spanish-language web client for Venezuelan Truco. Play one-on-one or in teams,
with guests, accounts, public or private tables, spectators, chat, voice, and CPU
opponents. The [Go backend](https://github.com/neiam00/retruco-backend) owns the
rules and match state.

The client uses SvelteKit, TypeScript, and Tailwind. See [DESIGN.md](DESIGN.md)
for interface guidance.

## Getting started

Install Node 26 and the pnpm version specified in `package.json`. Start the
backend with a migrated PostgreSQL database, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The development server proxies `/api` and
WebSocket connections to `127.0.0.1:8080`. Copy `.env.example` to `.env` only if
you need to override the defaults. Account registration and login require
Turnstile keys configured on the backend; guest play does not.

## Checks

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

The browser suite needs the frontend and backend running and a **disposable**
database: it creates accounts and matches and performs game actions. Set
`TEST_API_ORIGIN` if the backend is not at `http://127.0.0.1:8080`. For account
tests, configure the backend with Cloudflare's [Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/),
`APP_ENV=development`, and the frontend origin in `ALLOWED_ORIGINS`.

## Deployment

Configure separate backend origins and proxy secrets for preview and production
in Cloudflare Pages. Set your production branch in the Pages project settings.
Deploy a compatible backend before enabling a new browser CPU protocol.

The Cloudflare Pages build command is `pnpm build`, with output in
`.svelte-kit/cloudflare`. Leave `API_ORIGIN` empty to use the same-origin
`/api` proxy. Set `BACKEND_ORIGIN` to the backend HTTPS origin and
`API_PROXY_SECRET` to the same private value used by the backend. Configure the
backend's allowed origins for the deployed frontend. Do not point the backend
origin at the frontend itself.

`CARD_ASSET_ORIGIN` optionally points to a CDN containing `/cards/`;
`GOOGLE_ANALYTICS_ID` enables analytics. See `.env.example` for all variables.
`SITE_ORIGIN` optionally sets the public origin at build time, for example
`https://cards.example.com`. When set, public pages, `robots.txt`, and
`sitemap.xml` are prerendered with that origin. Leave it empty to render them
per request using the current hostname; this also works on custom domains and
preview deployments without new configuration. The WebSocket security policy
allows the corresponding origin. Rebuild after changing `SITE_ORIGIN`.

Voice requires HTTPS outside localhost and a TURN relay for networks that
cannot establish direct connections; see the backend's
[voice guide](https://github.com/neiam00/retruco-backend/blob/master/deploy/VOICE.md).

## Assets and CPU engine

Card artwork is based on [Spanish playing cards SVG](https://github.com/gjenkins20/spanish-playing-cards-svg);
see [attribution](static/cards/ATTRIBUTION.md). Edit `artwork/cards/*.svg` and
run `pnpm cards:build` to regenerate the WebP files and manifest. The build also
runs this conversion. Keep the generated content-hashed filenames when
publishing the deck to a CDN.

Edit `artwork/social-preview.html` and run `pnpm social:build` to regenerate the
social image; this requires Playwright Chromium. See
[the image license](static/og-image.LICENSE.md).

## Browser CPU

A dedicated Web Worker selects legal moves and signals for CPU seats. The
server validates each action against the current game state. The built-in
TypeScript heuristic plays by default. The [backend ML project](https://github.com/neiam00/retruco-backend/tree/master/ml)
trains and exports optional learned policies.

To serve an approved policy, set `VITE_CPU_ML_ENABLED=true` and point
`VITE_CPU_MODEL_MANIFEST` at its same-origin manifest when building. The bundle
contains `manifest.json`, `policy.bin` and `policy.wasm`. The worker checks
the approval flag, model format, encoder, choice policy and both SHA-256
digests. A loading or inference failure selects the heuristic for that session.

Recurrent policies keep separate hand memory for each CPU seat. The server
records the observations each seat was allowed to see, including off-turn
events. On reconnect or a controller handoff the worker replays that journal
in pages, then resumes decisions at the acknowledged cursor. The centralized
training critic stays on the training machine.

When the Go heuristic changes, regenerate the native parity fixture from the
backend checkout and run the frontend tests:

```sh
go run ./cmd/cpu-fixtures > ../frontend/src/lib/cpu/testdata/native-policy.json
```

## Local CPU evaluation

Check out the backend beside this repository as `../backend`. Install Docker,
Go, the project dependencies and Playwright Chromium. Set `BUNDLE` to an exported
candidate bundle, then run from the frontend checkout:

```sh
pnpm exec playwright install chromium
node scripts/test-cpu-integration.mjs "$BUNDLE" output/cpu-review --human-review
```

The launcher starts a disposable PostgreSQL database, builds the local API,
and runs a loopback Vite server with the selected model. It finishes a 1v1 and
a 2v2 browser match before printing the address for interactive play. Use a
fresh output directory for each session. Ctrl+C stops its local services.

Omit `--human-review` to run the browser recovery tests, including controller
handoff, server restart, and fallback for damaged or unavailable assets.
`CPU_SOAK_MATCHES` sets the number of rematches per mode (default 2).
The development worker can load an evaluation bundle on loopback. Production
builds require an approved manifest even if the evaluation flag is set.

To exercise that production check or measure a candidate with its matching
benchmark cases:

```sh
VITE_CPU_ML_ENABLED=true VITE_CPU_EVALUATION=true VITE_CPU_MODEL_MANIFEST=/cpu/release/manifest.json pnpm build
node scripts/check-cpu-production.mjs
node scripts/benchmark-cpu.mjs "$BUNDLE" "$CASES_JSON" output/cpu-benchmark/report.json 200
```

The benchmark records startup, inference latency and memory use. Recurrent
cases include replay of a full hand journal. Device emulation is reported
separately from direct worker measurements. Build releases from a clean
checkout so local preview assets in `static/cpu-evaluation/` stay local.

## License

The project code is available under the [MIT License](LICENSE). Separately
licensed third-party material retains its own terms and notices:

- The card artwork in `artwork/cards/` and its generated WebP copies are
  licensed under CC BY-SA 3.0; see [card attribution](static/cards/ATTRIBUTION.md).
- The social preview image is licensed under CC BY-SA 3.0; see its
  [license and attribution](static/og-image.LICENSE.md).
- The vendored UI components have their own [MIT license](src/lib/components/ui/LICENSE.md).
- The bundled Go runtime is covered by the [Go license](src/lib/cpu/vendor/LICENSE.GO).
- Nunito Variable is distributed under the SIL Open Font License. Other
  dependencies are subject to their respective licenses.
