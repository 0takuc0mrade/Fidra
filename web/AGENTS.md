# AGENTS.md — Fidra Frontend Design Rules

Fidra must feel like a serious, polished product, not a generic AI-generated interface.

The goal is simple: clean product design, strong typography, disciplined spacing, accessible UI, and zero visual slop.

## Non-Negotiables

Do not use:

- Glassmorphism
- Frosted glass cards
- Transparent blurred panels
- `backdrop-blur`
- Random glowing blobs
- Generic SaaS-purple hero sections
- Excessive gradients
- Neon cyberpunk styling unless explicitly requested
- Floating abstract orbs
- Overused AI startup visuals
- Low-contrast text
- Tiny unreadable labels
- Random shadows
- Inconsistent spacing
- Icon spam
- Placeholder marketing fluff
- Layouts that only work at one screen size

If a design choice feels decorative but does not improve clarity, hierarchy, usability, or brand trust, remove it.

## Design Direction

Use a modern product/editorial style:

- Solid backgrounds
- Strong type hierarchy
- Clear layout grids
- Calm neutral surfaces
- One restrained accent color
- Subtle borders
- Soft, minimal shadows
- Generous whitespace
- Clear actions
- Real product states

Fidra should feel credible, quiet, sharp, and intentional.

## Core Principles

### 1. Hierarchy First

Before building a screen, identify:

- The primary action
- The secondary action
- The main information
- Supporting information
- Metadata
- Loading, empty, error, and success states

A user should understand the page in 3 seconds.

### 2. Spacing Is Design

Use a consistent spacing scale:

- 4px
- 8px
- 12px
- 16px
- 24px
- 32px
- 48px
- 64px
- 96px

Do not eyeball random margins. Crowded UI is bad UI unless density is intentional and well-structured.

### 3. Typography Carries the Product

Use typography to create structure before adding decoration.

Rules:

- Use one primary font family unless there is a strong reason not to.
- Body text should be comfortably readable.
- Avoid tiny gray text.
- Headings should be clear, not absurdly huge by default.
- Use font weight intentionally.
- Avoid too many text sizes.

Suggested scale:

- Page title: 32–48px
- Section title: 24–32px
- Card title: 18–22px
- Body: 15–17px
- Supporting text: 13–15px
- Metadata: 12–13px

### 4. Color Must Have a Job

Use color for:

- Primary actions
- Status
- Data meaning
- Highlights
- Brand identity

Avoid using many saturated colors in the same view.

Prefer:

- Neutral backgrounds
- High-contrast text
- One clear accent color
- Muted supporting colors
- Calm status colors

### 5. Components Must Feel Consistent

Buttons, cards, inputs, modals, tables, navigation, badges, and alerts must feel like one system.

Keep consistent:

- Border radius
- Padding
- Border color
- Shadow style
- Font size
- Hover state
- Disabled state
- Focus state

Do not create five different card styles on the same page.

## Layout Rules

Use:

- Max-width containers for content-heavy pages
- Grids for dashboards and card layouts
- Flexbox for local alignment
- Clear page sections
- Consistent vertical rhythm
- Mobile-first responsive behavior

Avoid:

- Centering everything
- Full-width text blocks
- Giant hero sections with little substance
- Cards floating without alignment
- Unbalanced columns
- Random decorative sections

## Buttons

Buttons must have clear intent.

Use:

- One primary button per major section
- Secondary buttons for alternative actions
- Ghost/text buttons for low-priority actions

Buttons need:

- Clear labels
- Proper padding
- Visible hover states
- Visible focus states
- Disabled states
- Loading states when async

Avoid vague labels like:

- Submit
- Click here
- Continue

Prefer specific labels like:

- Create project
- Connect wallet
- Run verification
- Save changes
- View report
- Review changes

## Cards

Cards should group related information, not decorate the page.

A good card has:

- Clear title
- Useful content
- Optional action
- Consistent padding
- Subtle border
- Minimal shadow

Avoid cards inside cards inside cards.

## Forms

Forms must be easy to complete.

Rules:

- Labels must be visible.
- Inputs must have clear focus states.
- Errors must be specific.
- Required fields should be obvious.
- Related fields should be grouped.
- Do not rely only on placeholder text.
- Show helper text where useful.
- Preserve user input when validation fails.

## Tables and Data Views

For dashboards, admin screens, and data-heavy pages:

- Align numbers properly.
- Use readable row height.
- Make table headers clear.
- Use badges for status.
- Include empty states.
- Include loading skeletons where useful.
- Avoid cramming too many columns.
- On mobile, convert tables into stacked cards where needed.

## Navigation

Navigation must answer:

- Where am I?
- Where can I go?
- What is the main thing I can do?

Rules:

- Active states must be clear.
- Labels must be understandable.
- Do not overload navigation with too many items.
- Mobile navigation must be usable.
- Important actions should not be hidden.

## Motion and Interaction

Use motion sparingly.

Good motion:

- Confirms an action
- Helps transition between states
- Makes the interface feel responsive

Bad motion:

- Distracts
- Slows users down
- Exists only to look flashy

Animations should be short, subtle, and purposeful.

## Accessibility

Every frontend must meet basic accessibility standards.

Requirements:

- Good color contrast
- Keyboard navigability
- Visible focus states
- Semantic HTML
- Proper labels
- Alt text for meaningful images
- Buttons for actions, links for navigation
- No interaction that requires hover only
- No tiny click targets

## Responsive Design

Every screen must work on:

- Mobile
- Tablet
- Desktop

Check:

- Text wrapping
- Button stacking
- Navigation behavior
- Grid collapse
- Form usability
- Table behavior
- Touch target sizes

Do not design desktop first and ignore mobile.

## Content Quality

Do not write generic AI marketing copy.

Avoid phrases like:

- Unlock the power of...
- Seamless experience
- Revolutionary platform
- Supercharge your workflow
- Next-generation solution
- All-in-one platform
- Empowering users

Prefer concrete, useful copy.

Bad:

> Unlock seamless decentralized identity with our revolutionary verification platform.

Good:

> Verify ownership, attach supporting evidence, and generate a shareable proof for review.

## Landing Page Rules

If building a landing page, include:

- Clear headline
- Specific subheadline
- Primary CTA
- Product screenshot or realistic UI mock
- Problem section
- How it works
- Key features
- Trust/proof section if real proof exists
- FAQ or objections section
- Final CTA

Avoid fake testimonials, fake logos, and fake metrics unless explicitly provided.

## Dashboard Rules

If building a dashboard, prioritize clarity over decoration.

A good dashboard has:

- Clear page title
- Important summary metrics
- Recent activity
- Primary action
- Status indicators
- Empty, loading, and error states
- Useful filters where needed

Avoid decorative charts with meaningless data.

## Web3/Crypto UI Rules

For crypto-related Fidra interfaces:

- Make wallet state obvious.
- Show network clearly.
- Show transaction status clearly.
- Use human-readable amounts.
- Avoid overwhelming users with raw hashes.
- Provide explorer links where useful.
- Explain irreversible actions.
- Make errors understandable.
- Do not make everything look like a DeFi casino.

Prefer trustworthy fintech styling over loud crypto styling.

## AI Product UI Rules

For AI-related Fidra interfaces:

- Show what the AI is doing.
- Show sources, confidence, or reasoning summaries where useful.
- Make user control obvious.
- Allow review before final actions.
- Make errors recoverable.
- Avoid magical black-box interfaces.
- Do not overuse sparkles, gradients, or AI glow.

## Implementation Standards

When creating or modifying frontend code:

1. Reuse existing components before creating new ones.
2. Preserve the existing design system if one exists.
3. Create reusable components for repeated UI patterns.
4. Keep styling consistent.
5. Avoid unnecessary dependencies.
6. Do not introduce visual clutter.
7. Test responsive behavior.
8. Keep markup semantic.
9. Ensure interactive elements have accessible states.
10. Remove unused placeholder content.

## Tailwind Guidance

If using Tailwind CSS:

- Use consistent spacing utilities.
- Use design tokens where available.
- Avoid random arbitrary values.
- Avoid excessive gradients.
- Avoid `backdrop-blur`.
- Avoid huge shadows.
- Prefer `border`, `bg`, `text`, `ring`, and subtle `shadow-sm`.
- Keep class names readable.
- Extract repeated patterns into components.

Preferred card style:

```tsx
<div className="rounded-2xl border bg-white p-6 shadow-sm">
  ...
</div>
```

Preferred button style:

```tsx
<button className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2">
  ...
</button>
```

Do not use styles like:

```tsx
<div className="rounded-3xl bg-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/30">
  ...
</div>
```

## Design Review Checklist

Before finalizing frontend work, verify:

- Does the page have a clear focal point?
- Is the primary action obvious?
- Is the spacing consistent?
- Is the typography readable?
- Is the color usage restrained?
- Does it work on mobile?
- Are loading, empty, and error states handled?
- Are buttons and inputs accessible?
- Does the design avoid glassmorphism?
- Does it avoid generic AI/SaaS slop?
- Would this look acceptable in a real startup demo?
- Would a user understand what to do without explanation?

## Quality Bar

Fidra should look like a serious product built by a thoughtful team.

Not flashy.
Not generic.
Not overdesigned.
Not boring.

Clean, sharp, useful, and credible.

When in doubt, remove decoration, improve spacing, strengthen typography, and make the user's next action clearer.