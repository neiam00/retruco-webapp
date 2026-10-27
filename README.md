# Retruco frontend

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

The Cloudflare Pages build command is `pnpm build`, with output in
`.svelte-kit/cloudflare`. Leave `API_ORIGIN` empty to use the same-origin
`/api` proxy. Set `BACKEND_ORIGIN` to the backend HTTPS origin and
`API_PROXY_SECRET` to the same private value used by the backend. Configure the
backend's allowed origins for the deployed frontend. Do not point the backend
origin at the frontend itself.

`CARD_ASSET_ORIGIN` optionally points to a CDN containing `/cards/`;
`GOOGLE_ANALYTICS_ID` enables analytics. See `.env.example` for all variables.
When hosting under another domain, also review the site metadata, sitemap,
robots file, social preview, and content security policy for deployment-specific
URLs. Voice requires HTTPS outside localhost and a TURN relay for networks that
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

CPU decisions run in a browser Worker using the Go engine and its matching WASM
runtime. The server validates every move. To update both files from a backend
checkout, run `pnpm update:cpu /path/to/retruco-backend`, then run the checks
above. Human-only matches do not load the CPU module.

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
