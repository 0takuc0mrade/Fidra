# Design — Fidra V1

A locked product design system for Fidra's embedded instant-payout protocol. The
system covers the Worker and Platform routes. Fidra V0 remains
historical product evidence and keeps its existing visual language.

## Genre

Modern-minimal infrastructure. The product should feel like a precise money
instrument, not a consumer wallet, trading terminal, or generic admin template.

## Physical scene

A worker checks an available payout on a phone in daylight. A platform operator
reviews exposure and settles obligations from a laptop in a bright operations
room. The default surface is therefore light, quiet, and high-contrast; dark mode
is supported for preference, not used as shorthand for financial technology.

## Macrostructure family

- Worker and platform routes: **Workbench** — the task and its verified state are
  the page. Headings stay functional; controls sit beside the records they affect.
- Marketing and V0 routes: outside this system's scope.

## Theme

Cobalt-on-light, adapted to Fidra's existing monochrome mark and blue action
identity. Cobalt is a signal used for active navigation, primary actions, links,
and focus—not decoration.

- Paper: cool engineered near-white
- Ink: cool charcoal
- Accent: electric cobalt, below 5% of the viewport
- Rules: visible one-pixel dividers; depth comes from structure, not shadows
- State colours: always paired with text or an icon

Canonical values live in `src/tokens.css`.

## Typography

- Display: Space Grotesk, 600, normal
- Body and controls: Inter, 400–600
- Protocol values and addresses: JetBrains Mono, 400–600
- Product headings use a fixed rem scale; no fluid dashboard typography
- Monetary and accounting values use tabular figures

## Spacing

Four-point named scale from `--space-3xs` through `--space-3xl`. Components use
the named tokens; dense records use smaller steps than page-level sections.

## Motion

- State feedback only: button press, tab/row state, drawer entrance, and loaders
- No orchestrated page reveal and no decorative scroll animation
- Enter with `--ease-out`; exit with `--ease-in`
- Reduced motion collapses spatial transitions to an opacity change of 150ms or less

## Component voice

- Side-rail navigation, with V1 tasks before a clearly separated Legacy V0 group
- Six-pixel controls and ten-pixel major surfaces; no pill-shaped cards
- One primary action per task region
- Tables become labelled records on narrow screens instead of horizontal sheets
- Success is silent when the resulting protocol state is visible
- Errors state what failed and leave the next corrective action visible

## Per-page hierarchy

- Worker: available payout → eligibility → worker approval → Arc receipt
- Platform: operating state → capital ledger → claims or settlement action

## What pages must share

- Fidra mark, cobalt signal, typography, field and button geometry, focus rings,
  status vocabulary, side-rail shell, and page-width rhythm
- The same loading, error, empty, disabled, and confirmed states

## What pages may differ

- Worker may give the payout figure more visual weight.
- Platform may use denser tables and forms.

## Accessibility contract

- Minimum 44px touch targets
- Visible `:focus-visible` rings on every control
- Body and placeholder text meet WCAG AA contrast
- No state relies on colour alone
- No clickable label wraps to two lines
- Verified at 320, 375, 414, and 768 CSS pixels
