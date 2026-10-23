# Optimization and gameplay pass — 2026-10-23

Changes are local to the frontend and backend repositories. No deployment was performed.

## Images and loading

The 41-card deck went from **5,484,892 to 3,781,800 bytes (31.05% smaller)**.
Every individual card is at least 28.57% smaller. The source SVGs and 576px
output width are retained. Sharp near-lossless WebP at quality 70 and effort 6
replaces lossless encoding. Opaque pixels differ by at most 2/255 per RGB
channel; the worst per-card opaque-pixel PSNR is 49.18 dB. The build still
rejects transparent interiors. Rounded edge alpha can change by up to 2/255.
Original and optimized coin, figure, and back artwork were inspected side by
side at 288px display width with no visible loss of detail.

Content hashes changed with the image bytes. Existing immutable one-year
card caching remains appropriate; upload the new deck before deploying when
using an external card CDN. The adapter also supplies immutable caching for
hashed JavaScript, CSS, fonts, and WASM. API responses remain `no-store`.

The mobile lobby now mounts four ambient cards instead of downloading eight
and hiding four with CSS. Reduced-motion mode mounts none of this decorative
artwork. Resizing and changing the motion preference update the visible set.
The normal Latin Nunito font is preloaded from HTML to remove its CSS discovery
waterfall; its URL matches the existing font face and retains content hashing.

## Gameplay and layout

Short landscape screens now use the side-by-side table/hand layout from 520px
width, including 568×320. Previously that size squeezed the tabletop into the
small space above the hand. The right-side details panel becomes expandable on
short desktops as well as smaller widths. Chat height is bounded by the space
below the header, with its input/send controls retained inside the viewport.
Chat input uses 16px text to avoid iOS focus zoom. Safe-area insets are reserved
around the active game.

At narrow lobby widths, table identity/metadata keep a usable minimum basis and
the actions wrap below them. Previously a populated 320px lobby squeezed the
host and rules beside the buttons into a tall, barely readable column. The
regression check fails before this change and passes afterward. Selected voice
settings now use the same primary color as the lobby and other public pages.

New regression cases cover 568×320, 768×1024, 1024×768, and 1194×400 alongside
the existing 320×568, 390×664, 844×390, 1280×650, and 1440×900 cases. Chat
clipping was reproduced before the fix at three landscape sizes. Controls,
card collisions, and document scroll height are checked. History and long
secondary menus retain internal scrolling as specified by DESIGN.md; they do
not expand the game page.

## Backend measurements

Local Go benchmarks on Apple M5, Go 1.27.3. These are microbenchmarks and local
database measurements, not production end-to-end latency guarantees. Timing
comparisons use six-run medians; no formal significance test was performed.

| Operation                              |      Before |       After | Result                                 |
| -------------------------------------- | ----------: | ----------: | -------------------------------------- |
| Four-player legal actions, active turn |    26.27 µs |     8.89 µs | 66% less time                          |
| Legal actions, truco response          |    29.89 µs |     9.49 µs | 68% less time                          |
| Legal actions, waiting/caller team     | about 25 µs | about 28 ns | No candidate validation or allocations |
| Rate limiter, 10,000 active clients    | about 52 µs | about 43 ns | No full client-map scan                |
| Save match, two human members          |      140 µs |      130 µs | Membership writes batched              |
| Save match, four human members         |      187 µs |      115 µs | 38% less time, 57 → 36 allocations     |

Legal action generation skips impossible action families while keeping `Apply`
as the final validator. A temporary independent comparison against Git HEAD
matched all 7,496 ordered action lists across 48 complete seeded games, both
player counts, targets, flor modes, and all seats. A retained regression test
covers teammate responses and off-turn interruptions of pending truco.

Rate-limit windows have identical durations and are inserted under one mutex,
so an ordered expiry queue removes only expired windows. Capacity and remaining
client budgets are preserved. Match persistence uses one membership INSERT
instead of one per member, within the existing transaction. Tests cover rollback
on an invalid member, duplicates, retries, and empty membership lists. Single
member saves had roughly 4% array-encoding overhead in the local sample.

The complete canto history still grows with the match and is sent in snapshots.
An incremental history protocol remains a possible larger improvement; history
was retained to preserve reconnect behavior. No other material unbounded cache
or room-lifecycle leak was found in the scoped backend review.

## Dependencies

Updated DiceBear core 9.4.2 → 9.4.3, Lucide Svelte 1.59.0 → 1.61.0,
bits-ui 2.19.5 → 2.20.0, typescript-eslint 8.71.2 → 8.72.0,
Vite 8.3.4 → 8.3.5, Wrangler 4.151.2 → 4.151.3, and
Backblaze blazer 0.8.0 → 0.9.0; lockfiles were refreshed.

SvelteKit 3.1.0 and TypeScript 6.0.3 remain paired. TypeScript 7 is outside
the requested compatibility range. DiceBear core 10 is outside bottts 9.4.2's
declared peer range, so core uses the latest compatible 9.x release.
The existing `runed@0.35.1` peer warning still names SvelteKit 2 through bits-ui;
it is not suppressed. Other direct dependencies were already current.

## Validation

The cross-browser layout/account suite passed 187 tests with two intentional
touch-device hover skips. Desktop and mobile live multiplayer checks passed
after stale assertions were aligned with the existing menus and pause status.
The seating test exposed an actual hydration race: entry controls could accept
input before the formatting handler was attached. Name/code inputs and entry
buttons now wait for hydration. Inputs remain editable during pending requests.
The original seating test passes against the production build with this fix.

All public pages (lobby, rules, credits, settings) were checked at 320, 768, and
1440px widths in the production build: no horizontal overflow in the 12 cases.

The full backend `go test -race ./...` suite passes with the disposable
PostgreSQL database enabled. `go vet ./...`, WASM tests, and browser-engine
build pass. The rebuilt WASM executable sections and JS runtime match the
vendored copies; only the Go build ID changes, so the release artifact was not
rewritten with an uncommitted source reference.

Svelte checking reports no errors or warnings. The 32 frontend unit tests,
ESLint, Prettier, and the production Vite/Cloudflare build pass. Svelte autofixer
reports no issues in changed components; existing optional style suggestions
in MatchRoom were left outside this optimization change.

### Production loading and cache check

Measured the built Cloudflare Pages application through local Wrangler, using
Chromium, three cold/warm pairs on `/reglas`, without network or CPU throttling.
The local machine was also running browser validation. These numbers are a
cache/loading diagnostic, **not a production-network benchmark or a measured
before/after speedup**.

| Metric                     | Cold median | Warm median |
| -------------------------- | ----------: | ----------: |
| TTFB                       |      3.1 ms |      3.2 ms |
| DOMContentLoaded           |     20.7 ms |      6.9 ms |
| First contentful paint     |       56 ms |       24 ms |
| Subresource transfer bytes |     119,252 |         300 |

The Latin font was discovered by the HTML preload about 6.5 ms into navigation;
its warm transfer was zero bytes. Fetching a card twice transferred 191,570
bytes including response overhead, then zero bytes on the second fetch.
Observed response policies: HTML `public, max-age=0, must-revalidate`, cards
`public, max-age=31536000, immutable`, API health/session `no-store`.

### Final live-browser verification

The remaining 24 isolated production-browser cases passed, including full
two-/four-seat mobile CPU matches, WebKit animations and Retina rendering,
concealed burns, account flow, room expiry, card audio, and desktop/mobile Opus
voice with synthetic microphones. The two mobile voice cases initially used
controls inside the closed details panel; the tests now open/close that panel
through its buttons while retaining the microphone, push-to-talk, chat-focus,
permissions, and cleanup checks. Both pass in the final rerun.

The initial combined live run exhausted the existing localhost per-IP admission
limits. Final live checks were split by spec/project, restarting only the
disposable API between batches. No production rate limits were changed or
tests disabled to make them pass. Additional focused production runs verified
seating, hydration, narrow rows, landscape cutting/spectating, and input editing
while a request is pending. Twelve production-page screenshots covered lobby,
rules, credits, and settings at phone, tablet, and desktop widths.

The existing SvelteKit peer-range warning described above remains the only
dependency compatibility caveat. Cloud upload/deployment and physical-device
network measurements were outside this local pass.
