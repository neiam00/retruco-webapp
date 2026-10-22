# Retruco design system

Retruco is a place to play Venezuelan truco. The lobby should look like a card
room: a name, a way to sit down, and tables to join. Spanish cards provide the
personality. Keep the interface direct, familiar, and useful.

## Direction and references

The October 2026 redesign takes two concrete cues from the supplied references:

- Yuno puts a compact entry panel beside a generous public-table browser. Its
  background cards fall slowly, behind the controls.
- Naipia uses the Spanish deck as its illustration. Individual cards drift around
  a stable fan, and a small developer credit sits at the bottom.

Use a restrained version of these patterns, with Retruco's own identity. Do not
copy their logos, authentication providers, or features we do not support. Avoid
large marketing heroes, ornamental stamps, sparkles, oversized slogans, gradient
text, frosted panels, and decorative badges with no useful meaning.

## Typography and copy

Keep **Nunito Variable** throughout, including headings, buttons, numbers,
metadata, and dialogs. Do not introduce Georgia or another display font.

- Body: 14–16px, with 1.5–1.65 line height for explanatory text.
- Main lobby title: about 34px, weight 750, slightly tight letter spacing.
- Panel titles: 24–26px, weight 700–750.
- Labels: 13–14px, weight 650; keep secondary text readable.
- Buttons: 14–16px, weight 650–750.

Use sentence case and concise Spanish. Prefer “Crear una mesa”, “Opciones de
mesa”, and “Todavía no hay mesas abiertas” over promotional copy. Explain the
next action only when it is not obvious. Avoid all-caps captions and strings of
pills. Source identifiers remain English.

## Palette and surfaces

The lobby, rules, credits, settings, and account dialogs use a dark palette:

| Role                   | Color     |
| ---------------------- | --------- |
| Page                   | `#101312` |
| Panel                  | `#1a1e1c` |
| Text                   | `#edf0ec` |
| Secondary text         | `#a6b0a9` |
| Primary action         | `#bad9c2` |
| Text on primary action | `#172b1e` |
| Secondary control      | `#29312c` |
| Border                 | `#354039` |
| Input border           | `#455149` |
| Input error            | `#ffb4a9` |

Use the shared CSS variables, including in secondary pages. Panels use a thin
border and 12–16px corners. Controls use 8–9px corners. Inputs have a solid dark
surface. Selected options use a visible fill and `aria-pressed`; do not rely on
color alone. Use flat buttons without a thick simulated bottom edge. Keep card
faces opaque and preserve their original white paper and artwork.

## Lobby composition

On desktop, use a centered layout up to 1320px wide. A small top bar holds account,
rules, settings, and animation controls. Below it, a roughly 360px setup panel
sits beside the flexible table browser with a 24px gap.

The setup panel contains:

1. Retruco's card mark, title, and one-line description.
2. Display name or current identity.
3. Player count and target score.
4. A native “Opciones de mesa” disclosure for CPU seats, flor, spectator voice,
   and public/private settings. Values survive closing the disclosure.
5. The primary create action.
6. An invitation-code field and join action.
7. An unobtrusive account link.

The table browser contains its title and count, refresh, name search, sort,
hide-full and hide-CPU filters, then real table rows. Rows prioritize the host,
occupancy, rules, CPU presence, and join/watch controls. An empty list has a small
Spanish-card fan, a plain explanation, and room to breathe. Do not turn empty
space into another marketing section.

At 760px and below, stack setup before the table browser. Use 14–20px outer
margins, allow normal vertical scrolling, and never introduce horizontal
scrolling. At very narrow widths, filters become a single column. Controls and
text retain their size rather than shrinking the whole lobby.

## Background cards and motion

Use a bounded set of eight randomly selected Spanish cards, chosen once per
lobby visit. They fall slowly over 30–48 seconds with small lateral drift and
rotation. At mobile widths, display only four. Keep them dim and behind the
panels, never above inputs or text. The small empty-state card fan is stationary.

- Render existing content-hashed WebP assets through `cardURL`; no runtime SVG
  card rendering. Keep original SVG files as editable artwork sources, then
  regenerate WebP when artwork changes.
- Animate only transforms. No per-frame Svelte updates, JavaScript animation
  loops, filters, large blurred layers, or repeated randomization/decoding.
- Pause while the document is hidden or an account/history dialog is open.
- Provide a visible pause/resume control. With reduced motion enabled, remove
  ambient animation entirely.
- Decorative cards are hidden from assistive technology and ignore pointer
  events. They must not affect layout, tab order, or document scroll bounds.
- Hover feedback stays immediate: about 80ms for control colors. Do not add
  spring effects or moving hit targets to buttons.

Card dealing and play animations in a match remain meaningful game feedback.
They must show the authoritative state promptly and never delay legal actions.

## Match screen

The active match retains green felt, the established seat geometry, and its
viewport-fitting table/hand/action dock. The lobby's ambient cards do not run in
a match. Preserve the measured Safari rendering improvements.

Keep deck and vira to the dealer's right, large enough to recognize, clear of
player badges and played cards. Countdown and turn text must not obscure card
values. Gameplay cards are opaque; hand labels stay below end-of-game overlays.
Cards on the table and cards in hand have distinct spaces.

Primary canto replies stay visible. Secondary raises, chat, voice, and history
can use expandable panels on small screens. Long menus scroll within their own
panels, not by pushing the hand or reply buttons outside the viewport. Clear a
player's canto bubble when their card turn ends; retain the full canto history.
Reserve stable rows for card actions and canto replies so switching between them
does not resize the tabletop. Place history, card sound, signals, and chat in a
vertical toolbar on the right, clear of the hand, with at least 44px touch targets.
Keep connection status separate below the play area.

Team labels are “Nosotros” and “Ellos” for seated players and “Equipo 1” and
“Equipo 2” for spectators. Declarations remain explicit choices; presentation
must not silently change a legal action or conceal a legal omission.

## Accessibility, errors, and states

Use the existing shadcn-svelte primitives and native elements where appropriate.
Keep visible keyboard focus, labels, at least 44px interaction targets, and
accessible names for icon buttons. Native disclosures must work with keyboard
and touch. Dialogs trap focus, restore it on dismissal, and remain readable on
short screens.

Place input-related errors directly below their fields, associate them with
`aria-describedby`, focus the first invalid field, and clear errors on editing.
General failures use a focused, readable alert. A failed table request is an
error with retry, never an empty list. Background refreshes must not steal focus.
Loading, no tables, and no filter matches are separate states.

## Footer and attribution

The lobby footer appears after the content, centered and readable. On short or
mobile pages it follows the normal document flow; it never covers controls.
Use exactly:

Desarrollado por [neiam00](https://github.com/neiam00) @ [Hyaxe](https://hyaxe.com) | 2026

Keep “Créditos y cartas” available beside or below this credit. Preserve the
Spanish deck's attribution and CC BY-SA 3.0 license. Use local DiceBear avatars
and Lucide functional icons.

## Verification

Inspect desktop and mobile screenshots, with empty and populated tables. Check
keyboard access, account dialogs, expanded room options, filtering, invitation
codes, and inline errors. Verify ambient motion, pause/resume, reduced motion,
and navigation away from the lobby in WebKit as well as Chromium. Run Svelte
checks, ESLint, formatting, and relevant existing browser tests. No background
redesign may regress active-match layout or card rendering performance.
