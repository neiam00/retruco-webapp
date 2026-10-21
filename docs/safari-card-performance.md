# Safari card rendering

Measured on October 20, 2026, on the development Mac using Playwright WebKit
27.2. A private four-seat match ran three CPU players in the existing Go WASM
Worker. The human seat submitted legal actions through the real WebSocket API.
The following samples cover ten seconds of active gameplay, including dealing,
card movement, and hand transitions. These are local development-server
measurements, not production-network or physical-phone measurements.

| Metric                         | Original SVG deck | Lossless WebP deck |
| ------------------------------ | ----------------: | -----------------: |
| Median frame interval          |             17 ms |              17 ms |
| 95th-percentile frame interval |            698 ms |              18 ms |
| Longest frame interval         |          1,065 ms |              33 ms |
| Frames longer than 50 ms       |                17 |                  0 |
| Median CPU decision round trip |              3 ms |               4 ms |

A second SVG run reached a 1,200 ms frame gap. Removing CSS filters helped but
left 563 ms stalls. Hiding the game surface restored smooth frame pacing while
the Worker continued making decisions, isolating the problem to rendering.

The original traced SVG deck totals 72,658,699 bytes; its back alone is
11,381,463 bytes. The generated 576px lossless WebP deck totals 5,763,588 bytes,
with a 298,420-byte back. Editable SVGs remain in `artwork/cards`; they are no
longer published or loaded during gameplay. The browser comparison of the
original and converted king of coins preserved the artwork and transparency.

`tests/card-motion.spec.ts` now measures real animation frames and requires the
95th percentile to stay below 100 ms. A negative control served the original SVG
bytes in place of the WebP responses: the two-player WebKit test failed on that
assertion with a 1,120 ms 95th percentile. Restoring WebP passed. The WebKit
project in `playwright.config.ts` runs the card-motion and card-sound suites.

The final production-build check used the same local API and WebKit profile:
606 frames in ten seconds, 18 ms at the 95th percentile, a 25 ms maximum, and
zero frames over 50 ms. CPU decisions had a 3 ms median and an 11 ms maximum.
Production-build WebKit tests passed for two/four-player motion and sound;
Chromium desktop/mobile two-player motion checks also passed.

## Follow-up: missing flights and Retina rendering

The next pass kept the WebP artwork and addressed the animation lifecycle.
Scrolling had cancelled every flight, and snapshots ending a hand or match
skipped the final card entirely. Flights could also start before their images
decoded. A two-player negative control observed six confirmed plays but only
five flights; two flights started without decoded pixels and one was cancelled.

Flights now live in an absolute layer inside the table, so scrolling moves them
with the cards. Image decoding completes before animation starts, with bounded
waiting and cleanup for failed or cancelled requests. Card positions are read
as one batch before writing styles, and ancestor rotations are cached within
that measurement. Redundant drop-shadow filters and simultaneous introductory
flips were removed. The result panel waits for the last flight, and the CPU
waits for dealing to finish before submitting its already-computed move.

The compiled build was checked on the same Mac at a 1280 × 650 CSS-pixel
viewport and device pixel ratio 2. The four-seat case delayed every card image
response by 650 ms to exercise cold image delivery. The real backend and Go
WASM CPU Worker ran throughout.

| Production-build test | Frame interval p95 | Maximum | Completed played-card flights |
| --------------------- | -----------------: | ------: | ----------------------------: |
| WebKit, two seats     |              18 ms |   30 ms |                           6/6 |
| WebKit, four seats    |              18 ms |   35 ms |                         12/12 |
| Chromium, two seats   |            16.7 ms | 16.8 ms |                           4/4 |
| Chromium, four seats  |            16.7 ms | 16.8 ms |                         12/12 |

Different deals can end after different numbers of plays. The regression test
compares flights with the confirmed public plays, including the hand-ending
card, rather than assuming a fixed number. None of these flights was cancelled
or started without decoded image pixels. All ten compiled-build motion, sound,
and renderer checks passed across WebKit and Chromium. The new
`tests/renderer.spec.ts` requires a frame-interval p95 below 50 ms and scrolls
during the first play to protect against the original cancellation bug.

A direct check in the user's native Safari, using a private local four-seat CPU
match and the compiled build, sampled 1,202 frames over 20 seconds: p95 18 ms,
maximum 30 ms, at device pixel ratio 2. All 20 observed card flights completed,
with zero cancellations and zero undecoded starts. The inspector was closed
during frame sampling. This was a local test, not a production-network test.

System load was controlled before these final samples. Earlier in this pass,
even an empty WebKit page had a 249 ms p95; after the user paused other games,
the empty-page control returned to 17 ms. Those earlier scheduling stalls are
not attributed to Retruco, and these measurements do not guarantee frame timing
while other workloads compete for the display.
