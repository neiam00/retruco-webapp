# Retruco design system

Retruco is a Venezuelan card table for friends. Its visual center is the Spanish
deck, with a warm club atmosphere and clear, deliberately chosen declarations.
All product text is Spanish; source identifiers remain English.

## References inspected

- Naipia: a compact entry panel, guest-first play, code joining, warm dark tones,
  and a fan of Spanish cards establish the game before registration.
- Yuno: a distinct public-table browser beside the entry panel, restrained
  surfaces, rounded controls, and clear separation between lobby and game.
- The supplied Yuno video: green felt, seats surrounding a central table,
  highlighted active player, and a hand anchored near the viewer.

Retruco adopts those interaction patterns with its own cream, forest-green, and
terracotta palette. It does not reproduce either product's logo or copy.

## Color and typography

Use a warm ivory page (#f4efe3), forest text (#173d31), emerald felt (#154f3b),
and terracotta primary actions (#a8432c). Cream controls on felt keep cards and
actions legible. Muted text remains visibly distinct from disabled controls.
Headings use Georgia for a familiar printed-card character; body text uses a
system sans-serif stack. Small uppercase labels are reserved for table metadata.

## Layout

The lobby has a concise masthead, a prominent invitation to play, a card fan,
and a two-column play form/public-table browser. At narrow widths these become
one column, with the play form before the browser. Avoid horizontal scrolling.

The match fills the viewport with dark green felt, a soft vignette, and faint
oval table markings, following the supplied Yuno gameplay video. Compact player
badges sit around the perimeter; the active player has a gold outline and turn
sticker. Played cards occupy the center in positions relative to their owners.
A faint counterclockwise ring reinforces play direction. The deck and vira sit
beside the play area. The viewer's hand fans out along the bottom edge.

Scores and connection information occupy the top corners. Chat is a floating
panel opened from the bottom corner. Declarations and señas use compact controls
that open dialogs; selecting a declaration still requires the next game action.
On mobile the same table arrangement contracts, and the hand and action dock
remain near the bottom. The lobby retains its warm ivory background.

## Components and interactions

Use official shadcn-svelte components for standard controls, forms, dialogs,
and buttons. Custom Svelte components are reserved for the SVG card/table
visualization and game-specific compositions, as required by the rendering spec.
Keep focus indicators, accessible names, at least 44px interaction targets, and
reduced-motion support. Dialogs trap focus and restore it on dismissal.

Declarations are manual choices, reset after each submitted action. Never
silently add flor wording or prevent a legal omission. Pegado explicitly asks
for bottom (second round) and top (third round), then requires confirmation.
Show connection status, server-authoritative countdowns, pending canto, and
refusal consequences. Disconnects do not stop the countdown.

## Assets and motion

Use the requested Spanish SVG deck, retaining attribution and CC BY-SA 3.0.
Images use their original aspect ratio. DiceBear avatars are generated locally
from display names. Use Lucide for functional icons. Motion is subtle and short;
no animation may delay a legal action or hide the authoritative state.

## Empty, error, and loading states

An empty browser invites the user to create the first table. Network failures
show an actionable retry and never masquerade as an empty list. Reconnecting
disables action submission until a new authorized snapshot arrives. A table
waiting for players prominently exposes its invitation code and sharing link.
