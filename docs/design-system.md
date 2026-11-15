# Atmosphere design system

Rules for the x-locale UI. Tokens and utilities live in `frontend/src/styles.css`. Daylight is `:root`. Nightfall is `.dark`.

## 1. Colour

- Components use semantic tokens only (`background`, `card`, `popover`, `primary`, `accent`, `muted`, `destructive`, `warning`, `border`, `ring`). Raw ramps (`azure`, `haze`, `ember`) only feed those tokens.
- No hex, no Tailwind palette colours, and no inline colour styles in components. Brand marks (for example the Microsoft logo) are the only exception.
- Text on a fill uses that fill's foreground: `bg-X` with `text-X-foreground`.
- Soft tinted chips use `bg-accent text-accent-foreground`, never `text-primary` on a `bg-primary/N` wash.
- Alert or danger chips are filled: `bg-destructive` or `bg-warning` with their foreground.

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
- If the same override appears in three places, make it a token.
- A new token gets values for both modes in the same change.

## 5. Scales

- Spacing, sizing, radius, type size, shadow, duration and easing come from their scales.
- An arbitrary value (for example `h-[18.4px]`) is allowed only with a one-line comment saying why. If the same value appears twice, add it to the scale.

## 6. Tags and data colour

- Tags use the eight Atmosphere tones through `--tag-*`. The stored value is the Daylight colour, and `tagSwatchColor()` maps it to the variable.
- Each tone needs at least 3:1 against the card in both modes.

## 7. Surfaces

- Sticky chrome uses `sky-chrome`, and cards use `card`.
- Each surface level is a token, not a one-off mix of colour, opacity and blur.

## 8. Motion

- Durations and easings come from the motion tokens (for example `ease-drift`).
- Everything respects `prefers-reduced-motion`, turning off both the animation and any delay.

## 9. Components

- Reuse the shadcn primitives in `components/ui`. Change the variant there rather than overriding classes in a feature.
- A pattern used in three or more places becomes a variant or a component.

## 10. Adding to the system

- A new token needs a name, values for both modes, its measured contrast, and a note in this doc.
- Check existing tokens first to avoid near-duplicates.

## Known follow-ups

These are out of scope for the current fix-up:

- Duration tokens.
- Panel and wash consolidation.
- A z-index scale.
- An icon-size rule.
- Merging `empty.tsx` and `empty-state.tsx`.
- Removing the unused `--chart-*` and `--draft` tokens.
- Limiting the tag picker to presets.
