# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built auth surface (sign-in, sign-up, forgot-password, reset-password) on 2026-09-05, seed c0609038. The dashboard and other authenticated pages predate this record; where they differ, this file describes the auth surface only and the product-wide tokens in `app/globals.css` `@theme` remain authoritative.

## World

One quiet centered sheet on a deep field, in the manner of an Apple ID sign-in: the page has no marketing panel, no collage, nothing beside the task. Brand teal is spent on exactly three things: the primary button, the focus ring, and the captcha's solved state. Everything else is white, gray, and hairline.

## Color

| role | value | notes |
|---|---|---|
| ground | `#050505` (`--color-gray-900`) | page field, sampled flat |
| aurora | one teal glow: `rgba(15,237,190,.22)` radial at 50% 72% of an 82vh band plus a wider `.18` lobe at the page foot, blurred 40px, masked upward | its core sits behind the card's lower third so the card's blur has something to read; no second colour |
| card | `#141414` at 85% (`bg-gray-800/85`) with `backdrop-filter: blur(24px) saturate(140%)` | 1px `white/8` edge |
| control fill | `white/4`, hover `white/6` | inputs, selects, captcha track |
| control edge | `white/8`, hover `white/14`, focus `teal-400/70` | |
| text | title `#fff`, label `--color-gray-400` (#CCDADC), muted `--color-gray-500` (#9095A1) | |
| accent | `--color-teal-400` #0FEDBE | primary button, focus ring, solved state, caret, selection |
| danger | `--color-red-500` #FF495B | field errors, failed captcha |
| menu | `#1a1c20` | select/popover surfaces |

## Type

Geist via `next/font` (`--font-geist-sans`) with the CJK fallback stack in `@theme`. Title 28px mobile / 30px desktop, semibold, tracking -0.02em, `text-balance`. Subtitle 15px gray-500. Labels 13px medium gray-400. Inputs and buttons 15px. Fineprint and status 12px gray-500. Section heading inside a long form (sign-up "Investor profile") is a 15px semibold h2 above a hairline, never a kicker.

## Shape and depth

Card radius 28px with 32px desktop / 28px mobile padding; form rows on a 16px gap; controls 12px radius (`rounded-xl`); menus 16px; captcha stage 16px. Depth is one long soft shadow on the card (`0 30px 80px -30px black/90` plus a faint teal lift) and a teal-tinted drop on the primary button. No inset highlights, no bevels, no glow rings.

## Components

- `.auth-page` / `.auth-aurora` / `.auth-header` / `.auth-card-wrap` / `.auth-card` / `.auth-footer` (fineprint + contact): the page shell. The sign-in card, header and footer fit a 1440x900 viewport without scrolling; sign-up is the one form that scrolls.
- `.form-title` `.form-subtitle` `.form-body` `.form-field` `.form-label` `.form-input` `.form-error` `.form-help` `.form-links` `.form-footer` `.form-group-title`: form vocabulary.
- `.primary-btn`: 48px teal, dark text, presses to 0.985 scale.
- `.footer-link`: gray-400, white on hover with underline.
- `.select-trigger` `.country-select-trigger` `.auth-menu` `.auth-menu-item`: selects share one chevron (`ChevronDown`); the country select tags each row with its ISO code in mono gray instead of an emoji flag.
- `.captcha` family: server-rendered puzzle stage (320x120 image, procedural market scene in product palette), a 48px track with a white 44px handle, and a status line that only occupies space when it has text. States are driven by `data-state` on `.captcha`: loading, ready, dragging, verifying, solved, failed, throttled, unavailable.

## Pending state

After a successful sign-up the form is replaced in place by a centered notice: 56px teal-tinted circle with an hourglass icon, the title, a subtitle naming the email, a quieter hint line, and a "back to sign in" link under the hairline. No form, no button: there is nothing to do but wait.

## Motion

One authored moment: solving the captcha (fill bar settles, teal badge scales in over the hole). Card entrance is a 600ms ease-out rise on load. Failed drops shake the track once. Everything respects `prefers-reduced-motion`.

## Browser surfaces

Caret is teal in every field. Text selection inside `.auth-page` is teal at 32% with white text. Autofill is repainted to the control fill so Chrome's yellow never shows. Focus rings are 3px teal at 20 to 40% alpha, never the browser default.

## Copy

All strings live under `auth.*` in `messages/zh-CN.json` and `messages/en.json` with identical key trees. Errors name the recovery: throttled messages state the wait in minutes, captcha failures say a new puzzle is coming.
