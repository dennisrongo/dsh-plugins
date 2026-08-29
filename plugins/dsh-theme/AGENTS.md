# AGENTS.md — @dennisrongo/dsh-theme

Themes, accents and font pairings for the dsh web UI, as `ctx.theme` override layers plus a
`settings.section` page. Read `README.md` for what it does and how to add a theme; this file
covers the things that will bite you.

**Mostly a client plugin.** The host half exists for exactly one reason — inlining the
first-paint bootstrap — and mounts no service, no settings namespace, and no route. CSS
classes are prefixed `dshth-`; service access is per-fiber via `export const inject =
['slots', 'theme']`.

## The harness API this is built on

`@deepseek-ai/dsh-client-ui-theme` provides `ctx.theme`; `@deepseek-ai/dsh-client-ui-layout`
owns the `ThemePresenter` that projects a snapshot onto the DOM. Facts worth not
re-discovering:

- The presenter writes tokens as **inline** properties on `<body>` with no name filtering, so
  any custom property works — `--dsw-*`, `--ds-font-family-code`, `--shiki-*` — and an inline
  write beats every stylesheet rule.
- `var()` substitution for the alias layer resolves against **body's own computed value**, so
  overriding a `--dsw-static-*` ramp slot cascades into every alias built on it, and
  overriding `--dsw-font-family` cascades into all ~200 composed typography tokens. Both
  verified in a live browser.
- `overrideTokens(source, pairs)` keeps one layer per source and **replaces** it when the same
  source overrides again. That is the whole preview mechanism: no stacking bookkeeping, and
  no way to leak a half-applied palette.
- Layers compose in registration order, later winning per token. `accent` is registered after
  `palette` deliberately.

## Rules that are not obvious

- **Never `register()` a theme and `setTheme('<custom-id>')`.** `setTheme` only persists
  `light`/`dark`/`system`; a custom id lives in memory. Worse, `ThemeRuntime` subscribes to
  its settings scope and `adopt()` overwrites the preference with the durable value whenever
  that scope changes — and the scope derives from a describe mirror that re-reads on ANY
  `settings/document-updated` and on `connection/reset`, publishing fresh object identities
  each time. So a custom-id selection is snapped back to a built-in by the next settings
  write anywhere in the app. Token override layers are immune, because they are independent
  of `preference`. This is why a theme is a layer here, not a registered id.
- **That drift is loopback-only, which makes it worse.** `settingsScope.bind` constructs its
  controller with `connection.isLoopback ? 'host' : 'memory'`. On a non-loopback connection
  the scope reports `unavailable`, so `adopt()` early-returns and the drift never happens —
  a custom-id implementation would test clean in a remote browser and fail on localhost.
- **The same gate is why selection is not in the settings document.** A memory-mode scope's
  writes silently no-op, so a Host settings namespace would lose the selection for every
  remote browser. Staying off the settings document also means this plugin cannot trigger the
  adopt cycle above by saving its own preference.
- **Selection rides a COOKIE, not localStorage, because of DSH Desktop.** The Desktop serves
  the UI from a new ephemeral port every launch (observed live on 43127), and localStorage is
  origin-scoped with the port in the origin — so a localStorage-only plugin forgets the theme
  on every Desktop restart. That is not theoretical: it is the bug that forced
  `dsh-mission-control` to grow a host half. Cookies are not isolated by port (RFC 6265 §8.5),
  so they survive the relaunch, and they do not care whether the Desktop loads `127.0.0.1` or
  `localhost`. localStorage is still written and read as a fallback for embeds that refuse
  cookies. **The inlined bootstrap must read the cookie first too** — reading only
  localStorage there would leave the flash fix working on the CLI and failing on the Desktop,
  which is the surface that needs it. Verified by restarting the harness on a different port:
  localStorage empty at the new origin, theme still applied, bootstrap still painting.
- **The first-paint bootstrap is not optional.** Measured on a dev machine: DOMContentLoaded
  at 51 ms, plugin bundle executing at ~290 ms, and `#root` already carrying rendered content
  when `apply()` ran at 586 ms. Without the inlined script the shell shows the stock palette
  for roughly half a second on every load. The Host cannot read localStorage, so it inlines
  the DATA (a 15-token first-paint subset for every theme, ~7 kB) and the browser does the
  lookup. Keep that subset small; the full map is 110 tokens per variant.
- **The bootstrap depends on running after the harness's own.** It reads
  `body[data-ds-dark-theme]` to pick a mode, which `ui-theme`'s `bootThemeInjection` sets a
  row earlier. Verified in the served HTML: `data-ds-dark-theme` appears before
  `dsh-theme:theme`. It falls back to `prefers-color-scheme` and re-paints at
  `DOMContentLoaded`, so a reordering degrades rather than breaks.
- **Emit at the alias level, not the ramp level.** 21 of the 89 alias tokens are literal rgba
  rather than `var(--dsw-static-*)` — every mask, `border-l1..l4`, `bg-skeleton`, and all the
  `interactive-bg-hover*` fills — so a ramp-only recolour leaves exactly the layer that makes
  a theme legible keyed to the stock palette. The two base mappings also assign conflicting
  roles to the same slot (`neutral-bluish-50` is a code-block background in light and primary
  label text in dark), so no single ramp fill serves both. Five raw ramp slots ARE emitted
  because `ui-conversation` and `ui-trajectory` read them directly: `deepseek-500`,
  `deepseek-200`, `blue-500`, `blue-450`, `neutral-bluish-400`.
- **`--dsw-alias-brand-primary` is a trap: the UI barely paints with it.** It reads like the
  place an accent belongs, and stock uses it for `button-primary-fill`, but a scan of every
  element on a themed page found ZERO carrying that colour — a vivid accent routed only there
  is applied and invisible, which reads to a user as "the theme isn't working". dsh's most
  prominent accent surface is the send button, which reads
  `--dsw-alias-button-info-fill`, so the accent drives that (`legibleFill` in `color.ts`).
  Verify with a colour scan, not by reading the stylesheet — the tokens' names do not predict
  which ones are used.
- **The send button hardcodes `color: rgb(255,255,255)`** in its own rule
  (`.uV2eYG_primary`), which no custom property can override. Any accent routed to that fill
  must therefore stay dark enough for a white icon — that is what `legibleFill` solves, and
  why it targets **3:1** (the content is a 16×16 SVG, so WCAG's non-text bar applies, not
  4.5:1). At 4.5 the window closes for light accents on dark themes and every dark theme's
  primary control goes muddy. It optimises two competing bars at once: darkening a light
  accent fixes the icon and breaks the button's edge against a dark page.
- **An accent is only as good as the tokens that paint it — verify by scanning, not reading.**
  A colour scan of every element found ZERO carrying the accent when it went only to
  `brand-primary`. The surfaces that actually show it are `button-info-fill` (send button),
  `state-business-primary` (model labels, chips, and via `--mc-accent` mission-control's tags
  and pomodoro pulse), `--dsw-static-blue-450/500` (transcript), and the selected session row.
  Two of those need solvers, not constants: `legibleFill` for the fill under a hardcoded white
  icon, `legibleTint` for the row under body text. A flat 0.22 tint failed five light variants
  and revealed the old grey lift was already under AA on two — lifting a surface toward the
  text spends the headroom a tint needs, so the row tints from the plain sidebar colour.
- **The cookie is POSITIONAL, so field 3 is a reserved placeholder — do not reclaim it.**
  The format is `theme.accent.font.-.contrast.scale`. Field 3 held the code font before that
  axis merged back into `font`; removing the slot would shift `contrast` and `scale` left and
  silently mis-read every stored selection. `parseSelection` falls back FIELD BY FIELD, which
  is what lets axes be APPENDED without invalidating anyone's choice. Appending is safe;
  renumbering is not.
- **Fonts are one axis and the non-default faces are bundled.** A named face that is not
  installed falls through silently and looks exactly like a setting that did nothing — the
  original report that started this. Bundling removes the failure mode instead of labelling
  it: the faces travel inside `client.js` as data URLs, because the harness serves no route
  for a `.woff2`. esbuild's `dataurl` loader does the inlining (`build/build.mjs`), so the
  binaries stay out of the repo and are pinned to lockfile-resolved `@fontsource/*` packages.
  **Bundling is redistribution, so only OFL-1.1 faces qualify.** Berkeley Mono is a paid
  licence: it is named in the Default stack for owners and must never be bundled — the suite
  asserts that, and the ~124 kB face budget.
- **Renaming a theme id needs an alias, or it is data loss.** The id is persisted, so a bare
  rename silently resets everyone who had it selected — they reopen on the stock palette with
  no explanation. `high-contrast` → `bumble-bee` (the name stopped describing a palette once
  contrast became its own axis) is aliased in `THEME_ALIASES`, which `findTheme` follows AND
  the bootstrap emits as an extra table key so the pre-rename cookie still paints on the first
  frame. Keep entries there forever; they cost a line.
- **Do not "improve" a bundled stack by dropping its named face — the face is the point.**
  The stack behind it exists only for the case where a data URL somehow fails to decode.
- **Contrast is a palette TRANSFORM, not a layer.** It adjusts the authored colours and the
  builder derives everything downstream from the adjusted values, which is what keeps the
  surface ladder coherent at every level — a separate layer would have to re-derive the same
  110 tokens anyway. It moves surfaces, text and borders only: accents, states and syntax
  colours stay exactly as authored, because "any palette at any legibility" is the entire
  reason the axis exists. The suite asserts both halves of that.
- **UI scale is `zoom`, and that is not a shortcut.** A font-size control cannot work from a
  plugin: the harness sets `font-size` literally in 305 places and through a token in 44, so
  scaling the typography tokens moves a seventh of the UI and leaves the rest. The only lever
  that reaches hardcoded px without naming dsh's hashed CSS-module classes is `zoom`. It rides
  `--dshth-ui-scale` through the normal layer, so preview and revert need no special case, and
  the one rule that reads it is injected at ACTIVATION rather than on panel mount — otherwise
  the scale would not apply until the settings page had been opened once.
- **Both `{ light, dark }` values are mandatory.** `overrideTokens` throws a teaching error on
  a bare string. Repeat the value when a token is scheme-invariant (the font layer does).
- **`settings.section` labels are functions.** `resolveSlotLabel(entry.options.label)` — the
  shipped registrants all pass `() => string`. A bare string is untested here.
- **No transitions, ever.** An animated palette swap is a `prefers-reduced-motion` violation
  and a repaint amplifier across 350 custom properties. The bundle suite asserts `transition:`
  is absent.

## Layout

```
src/color.ts        sRGB parse/mix/alpha + WCAG luminance & contrast (used by the
                    builder AND the test; no DOM, so it runs under Node)
src/types.ts        Palette / ThemeSpec / FontSpec / AccentSpec — the authoring model
src/tokens.ts       Palette → 110 custom properties. The heart; see its module doc
src/themes/*.ts     one file per theme, ~15 colours per variant
src/fonts.ts        3 fonts (2 bundled); one layer setting both faces
src/contrast.ts     the contrast axis: a palette transform, not a layer
src/scale.ts        the UI scale axis: one token + one injected zoom rule
src/detect.ts       which family a stack resolves to here (only the Default entry needs it)
src/font-faces.ts   the bundled OFL faces, inlined as data URLs at build time
src/accents.ts      9 accents + the 9-token layer
src/layers.ts       the three layer sources, applySelection/retractAll
src/storage.ts      the cookie (+ localStorage fallback) and why it is a cookie
src/boot.ts         the inlined first-paint script (host side)
src/client.tsx      the Themes page + plugin body
src/index.ts        host half: index-inject listener + ESM re-exports for the test
```

## Verification

`pnpm test` builds, then runs both suites — 125 catalogue checks and 73 bundle checks. The
catalogue suite collects every failure before exiting, because adding a theme usually trips
several contrast floors at once and a fail-fast suite turns that into a build-fix-build loop.

Neither suite proves the plugin works in a harness. For that:

```bash
node scripts/verify.mjs --port=38111       # from the repo root, against a running profile
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  http://127.0.0.1:38111/plugins/@dennisrongo/dsh-theme/client.js
curl -s http://127.0.0.1:38111/ | grep -c 'dsh-theme:theme'   # 1 = bootstrap is inlined
```

Then in the UI: Settings → Themes renders, picking a theme repaints the whole app, Revert and
closing the modal both restore the committed selection, Apply survives a reload, and flipping
Light/Dark in General swaps the theme's variant without touching the selection. All of those
were confirmed in a browser against a live profile, and the light/dark flip is the one worth
re-checking after a dsh upgrade — it is the behaviour the whole layer design buys.

## Gotchas

- The catalogue suite imports `lib/index.js` and the bundle suite reads `lib/client.js` as
  **text**; both are stale unless you build first, which is why `test` runs the build. The
  client half is deliberately never imported — it is a browser bundle wrapped in
  `window.__ModuleLoader__.load` and importing it under Node fails by design.
- Several themes deviate slightly from their upstream palettes, always in the same direction
  and always commented: light-mode syntax colours and a few secondary greys are darkened to
  clear the contrast floors. Solarized and Everforest needed the most. Do not "restore" them
  to the canonical hex without re-running the suite.
- `--dsw-font-family` is declared on `:root` upstream while the presenter writes to `<body>`;
  that is fine, because everything visible is a body descendant and body's own computed value
  wins. Confirmed in the browser.
- The `system` font pairing appends `monospace` to the harness's own code stack, which
  otherwise ends on CJK faces with no generic tail. It is the one deviation from stock and
  only applies when nothing above it resolved.
- **`document.fonts.check()` cannot tell you whether a font is installed.** It answers `true`
  for any family name — including `"Totally Not A Real Font"` — because falling back always
  succeeds. `src/detect.ts` uses the width probe instead: put the candidate in front of a
  generic and see whether `measureText` moves. Verified against a nonsense name (false) and
  Arial/Georgia (true).
- **Font presets can collapse into each other on a given OS, and that reads as a bug.** On
  stock Windows, `humanist` resolves to Segoe UI Variable Text while `system` resolves to
  Segoe UI — visually near-identical, so applying it looks like nothing happened. The fix is
  disclosure, not different stacks: each row shows its resolved family and flags one that
  matches the System preset's. Do not "fix" a collapse by dropping the good face from a
  stack; the stack is right, the machine just lacks the preferred font.
