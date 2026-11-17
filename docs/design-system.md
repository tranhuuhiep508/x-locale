# Atmosphere design system

Rules for the x-locale UI. Tokens and utilities live in `frontend/src/styles.css`. Daylight is `:root`. Nightfall is `.dark`.

## 1. Colour

- Components use semantic tokens only (`background`, `card`, `popover`, `primary`, `accent`, `muted`, `destructive`, `destructive-soft`, `warning`, `border`, `ring`). Raw ramps (`azure`, `haze`, `ember`) only feed those tokens.
- No hex, no Tailwind palette colours, and no inline colour styles in components. Brand marks (for example the Microsoft logo) are the only exception.
- Text on a fill uses that fill's foreground: `bg-X` with `text-X-foreground`.
- Soft tinted chips use `bg-accent text-accent-foreground`, never `text-primary` on a `bg-primary/N` wash.
- Danger chips are filled: `bg-destructive` or `bg-warning` with their foreground. The destructive Alert is `text-destructive` on `card`, and its description uses the same colour. Success and info alerts are filled.
- Known exceptions, still in the product: the login terminal showcase and the import JSON sample use `haze-*` and `azure-*` utilities; the login glow is `bg-azure-400/8`; dialog, alert-dialog and sheet backdrops use `bg-haze-950/40`; a tag swatch sets its colour inline because the stored value is data.

## 2. Contrast (WCAG AA)

- Measure the real rendered pair: text against what is actually behind it, after opacity and layering.
- Text needs at least 4.5:1. Icons, borders, focus rings and swatches need at least 3:1. A borderline 4.49 fails.
- Check Daylight and Nightfall in every state: default, hover, focus, active, selected. Disabled is exempt but must still look disabled.

## 3. Opacity

- Text people read is never faded. Use `text-muted-foreground` when it needs to look quieter.
- Opacity is fine on aria-hidden separators, borders, the disabled state, and washes behind text that still passes.

## 4. Modes

- Dark mode is mainly a token remap in `.dark` in `styles.css`.
- A `dark:` override in a component is fine when one state really behaves differently between modes (for example a hover that darkens in light and lightens in dark).
- If the same override appears in three places, make it a token. Primary hover is `--primary-hover`: 88% primary mixed toward black in Daylight, and primary at 80% in Nightfall. Buttons, link badges and the batch stepper all use it.
- A new token gets values for both modes in the same change.

## 5. Scales

- Spacing, sizing, radius, type size, shadow and easing come from their scales. Duration tokens are a known follow-up.
- An arbitrary value (for example `h-[18.4px]`) is allowed only with a one-line comment saying why. If the same value appears twice, add it to the scale.

## 6. Tags and data colour

- Tags use the eight Atmosphere tones through `--tag-*`. The stored value is the Daylight colour, and `tagSwatchColor()` maps it to the variable.
- Each tone needs at least 3:1 against the card in both modes.

## 7. Surfaces

- Sticky chrome uses `sky-chrome`, and cards use `card`.
- Each surface level is a token, not a one-off mix of colour, opacity and blur.

## 8. Motion

- Easings that exist come from the motion tokens (for example `ease-drift`). Duration tokens are a known follow-up, so durations are not a scale yet.
- Everything respects `prefers-reduced-motion`, turning off both the animation and any delay.

## 9. Components

- Reuse the shadcn primitives in `components/ui`. Change the variant there rather than overriding classes in a feature.
- A pattern used in three or more places becomes a variant or a component.

## 10. Adding to the system

- A new token needs a name, values for both modes, its measured contrast, and a note in this doc.
- Check existing tokens first to avoid near-duplicates.

## Typography and ledger

- `--font-heading` (Bricolage Grotesque) is for titles and KPI gauges. `--font-sans` (Geist) is for UI copy and translations. `--font-mono` (IBM Plex Mono, `tabular-nums`, up to `font-semibold`) is for keys, locale codes, slugs and counters. Use the semantic scale (`text-3xs` through `text-3xl`) and the `eyebrow` utility.
- Sticky headers use `sky-chrome` (`--app-header-height`). `sky-panel` is the card surface (`bg-card`) plus a small shadow. The strings ledger uses opaque `.string-row-*` rows. Edited, removing and selected rows keep a 3px left bar; a base row uses a 2px bar on hover.

## Tokens added with the fix-up

Measured as the rendered pair (Daylight / Nightfall). Text floor is 4.5:1. Icons, borders, focus rings and swatches floor is 3:1.

- `--success` on `--success-foreground`: 8.90:1 / 9.43:1. `--info` on `--info-foreground`: 8.01:1 / 10.05:1. `--warning` on `--warning-foreground`: 8.08:1 / 9.49:1. `--destructive` on `--destructive-foreground`: 4.98:1 / 5.75:1, and that solid pair is for actions such as destructive buttons. `--destructive-soft` on `--destructive-soft-foreground`: 6.83:1 / 9.38:1. Sonner toasts use the neutral `--popover` / `--popover-foreground` surface with `--border` and `--shadow-lg` across all types; semantic status is carried by the leading icon (`text-success-foreground`, `text-info-foreground`, `text-warning-foreground`, `text-destructive`).
- `--ring` stays azure-500. `focus-ring` draws a 2px outline of it. The lowest pair is 3.02:1 on accent in Daylight and 4.20:1 on accent in Nightfall. On a `muted/55` wash over the card it is 3.13:1 / 5.30:1.
- `--tag-*-ink` is sun in Daylight and haze-950 in Nightfall. Sun on the Daylight swatches is 3.36–9.10:1. Haze-950 on the Nightfall swatches is 5.73–11.04:1. `tagCheckColor()` returns that ink.
- `--row-hover`, `--row-selected` and `--row-removing` are a light mix of the card with haze, azure, or destructive (97% card in Daylight; 94%, 92% and 90% in Nightfall). The weakest text on the row states is primary on the deleted hover at 4.52:1 in Daylight and destructive on the edited hover at 4.69:1 in Nightfall. `--missing-foreground` is at least 4.75:1 in Daylight and 4.73:1 in Nightfall on every row state, including edited and deleted hover. The left bar still carries the meaning.
- `--primary-hover` is the shared primary hover for the default button, the default badge link, and the batch stepper.
- Sonner action buttons use the compact `sm` button sizing, `--primary` / `--primary-foreground`, `--primary-hover`, and the standard `focus-ring` outline (`--ring`) against `--popover`. Cancel buttons use `--secondary` / `--secondary-foreground`.

Badge variants `soft` (accent), `warning`, `public` and `code` (muted mono) are the chips. Button variant `soft` is the same accent fill for actions such as Generate with AI.

## Known follow-ups

These are out of scope for the current fix-up:

- Duration tokens.
- About 48 uncommented arbitrary values. Add the one-line comment rule 5 requires, or move a repeated value onto the scale.
- Panel and wash consolidation.
- A z-index scale.
- An icon-size rule.
- Merging `empty.tsx` and `empty-state.tsx`.
- Removing the unused `--chart-*` and `--draft` tokens.
- Limiting the tag picker to presets.
