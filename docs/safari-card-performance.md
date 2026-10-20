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
