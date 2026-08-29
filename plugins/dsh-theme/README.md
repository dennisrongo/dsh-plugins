# @dennisrongo/dsh-theme

Themes, accents and fonts for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI.

Twelve curated palettes — Bumble Bee, Catppuccin, Citron, Claude, Everforest, Gruvbox, Nord,
One, Rosé Pine, Sakura, Solarized, Tokyo Night — plus eight accent colours, a contrast slider,
a UI scale slider and three fonts (two of them bundled), picked from a **Themes** page in
Settings with the whole app previewing live before you commit.

Every theme ships **both** a light and a dark palette, so it layers over your existing
Light/Dark/System choice instead of replacing it. Switch appearance and the theme follows;
leave it on System and it follows the OS.

Hovering a theme — or arrowing onto it — swaps its one-line description for its full authored
palette, sixteen swatches from background through to syntax colours, each with its role and
hex on the tooltip. It replaces the blurb rather than adding a row, so the grid never
reflows, and the theme's name stays visible while you read the colours. Nothing is applied on
hover; that is a local reveal, not a preview.

## How it works

The harness ships a theme runtime (`ctx.theme`) whose `overrideTokens(source, tokens)` keeps
one token layer per source string and replaces it wholesale when the same source overrides
again. This plugin uses four independent layers:

| Layer | Tokens | What it sets |
| --- | --- | --- |
| `…dsh-theme:palette` | 110 | Surfaces, text, borders, states, markdown, scrollbars, syntax |
| `…dsh-theme:accent` | 17 | Primary fill and hover, model labels and chips, selection row, bubble tint, hover wash |
| `…dsh-theme:font` | 2 | `--dsw-font-family` and `--ds-font-family-code` |
| `…dsh-theme:scale` | 1 | `--dshth-ui-scale`, read by one injected `zoom` rule |

Layers compose per token, so theme × accent × font × scale costs the SUM of those lists
rather than their product — and each layer recolours or restyles whatever is underneath
without knowing about the others.

The font layer is two tokens because one choice drives both faces: every one of the harness's
~200 composed typography tokens is declared as `… var(--dsw-font-family)`, so overriding that
one name restyles the whole UI, and `--ds-font-family-code` does the same for code.

A small first-paint bootstrap is inlined into the page by the host half, so a themed harness
does not flash the stock palette on load.

### Where the selection is kept

In a **cookie** (`dsh-theme=<theme>.<accent>.<font>.-.<contrast>.<scale>`; field 4 is a
reserved placeholder from the retired code-font axis, kept so the later fields never shift), with
`localStorage` written and read as a fallback. Fields fall back individually, so a cookie
written before an axis existed still parses — it just takes the default for the field it
lacks. Renamed theme ids resolve through `THEME_ALIASES`, so `high-contrast` still finds
Bumble Bee rather than silently resetting anyone to stock.

That is not arbitrary. **DSH Desktop serves the UI from a new ephemeral port on every
launch**, and `localStorage` is origin-scoped — the port is part of the origin — so a
localStorage-only plugin forgets your theme every time you restart the Desktop. Cookies are
*not* isolated by port (RFC 6265 §8.5), so one set on `127.0.0.1` is read back whatever port
the next launch picks. It also sidesteps whether the Desktop loads `127.0.0.1` or
`localhost`, since the cookie belongs to whichever host the page is on.

Verified by restarting the harness on a different port: `localStorage` came back empty at the
new origin and the theme was still applied, from the cookie, including the pre-paint
bootstrap.

The harness settings document was considered and rejected: `settingsScope` writes silently
no-op on a non-loopback connection, so the selection would persist on the developer's machine
and vanish for anyone on a remote browser.

## Installing on Windows and macOS

The published install is the same command on both, and needs nothing else:

```bash
dsh plugin add @dennisrongo/dsh-theme
```

Nothing about it is platform-specific, by construction:

- **no runtime dependencies and no peer dependencies** — `npm pack` ships
  `lib/`, `cordis.patch.yml` and this README, nothing more;
- **no install scripts** — no `postinstall`, no native module, nothing to compile;
- **the fonts are inside the bundle**, so no OS-level font installation happens
  on either platform;
- line endings are pinned to LF by the repo's `.gitattributes`, so `lib/client.js`
  is byte-identical wherever it is built (verified: 0 CRLF pairs).

### DSH Desktop

The Desktop keeps its own `DSH_HOME`, separate from the CLI's, so install once
per profile per surface:

| | Desktop harness home |
| --- | --- |
| Windows | `%APPDATA%\dsh-desktop\harness` |
| macOS | `~/Library/Application Support/dsh-desktop/harness` |

```bash
dsh plugin --profile web add @dennisrongo/dsh-theme
```

Restart the Desktop afterwards; the page appears in Settings → Themes exactly as
it does in the browser. Both surfaces here run the same harness version
(`0.1.1-rc.2`), and the Desktop bundle provides `ctx.theme`, `overrideTokens`
and the `settings.section` slot, so nothing is CLI-specific.

### From a clone

`pnpm install` at the repo root, then `node scripts/anchor.mjs` — that script is
portable Node and resolves the harness through `npm root -g` first, with
platform fallbacks for both. Add the `file:` dependency and the
`dsh.profile.bundles` row to the profile's `package.json`, and the plugin
mounts.

Only the live-reload convenience is Windows-only: `scripts/dev-link.ps1`
replaces the profile's materialised copies with junctions. On macOS, either
re-run `pnpm install` in the profile after a build, or symlink the package
directory into the profile's `node_modules/@dennisrongo/` by hand — the plugin
itself does not care which.

> **Tested on Windows only.** The code has no platform-specific paths and the
> resolver handles macOS, but the macOS Desktop layout above is from its
> documented convention rather than a machine this was run on.

## Adding a theme

A theme is data. Write `src/themes/<id>.ts`:

```ts
import type { ThemeSpec } from '../types.ts'

export const midnight: ThemeSpec = {
  id: 'midnight',
  label: 'Midnight',
  blurb: 'One line, shown under the name in the picker.',
  variants: {
    dark: {
      bg: '#0b1020', surface: '#141a2e', overlay: '#1d2540',
      fg: '#e6ebff', muted: '#b9c2e0', faint: '#8792b8',
      border: '#2a3354',
      accent: '#7aa2f7', error: '#f7768e', success: '#9ece6a', warn: '#e0af68',
      code: {
        bg: '#080c18', comment: '#6b7394', keyword: '#bb9af7', string: '#9ece6a',
        constant: '#ff9e64', function: '#7aa2f7', parameter: '#e0af68',
        punctuation: '#b9c2e0', link: '#7dcfff',
      },
    },
    light: { /* the same shape, authored against the light base palette */ },
  },
}
```

Add it to `THEMES` in `src/themes/index.ts`, then `pnpm test`. Nothing else needs to know it
exists — the picker, the preview, the persisted selection and the first-paint bootstrap all
iterate that array.

Roughly fifteen colours per variant is the whole job; the builder in `src/tokens.ts` derives
the 110 custom properties the harness actually reads, including the alpha ladders for
borders and hovers, the inverted tooltip chrome, elevation shadows, and the `--shiki-*`
syntax set. `sidebar`, `accentFg`, `bubble` and `info` are optional and derived when omitted.

### Where `accent` shows up

On the send button, model labels and chips, mission-control's tags and its pomodoro pulse,
the selected session row, hover washes, primary buttons and the chat-bubble tint.

That list is long deliberately, and it was measured rather than guessed. The obvious home for
an accent is `--dsw-alias-brand-primary` — but a colour scan of every element on a themed page
found **zero** carrying it, because the current dsh UI paints almost nothing with that token.
The send button reads `--dsw-alias-button-info-fill`; model labels, chips and (through
`--mc-accent`) mission-control's tags and pomodoro pulse read
`--dsw-alias-state-business-primary`; the transcript reads `--dsw-static-blue-*` directly.
Routing the accent to those, plus an accent-tinted selection row, is what put it on the
surfaces you actually look at.

Two of those placements needed a solver rather than a constant. The send button hardcodes a
white icon in its own CSS, which no token can override, so the accent passes through
`legibleFill`, which walks outward from the
authored colour to the nearest shade where **both** the white icon and the button's own edge
against the page clear 3:1 — the non-text contrast bar, which is the right one because the
content is a 16×16 SVG rather than text. An accent that already clears both is left exactly
as authored (Solarized's `#268bd2` is untouched); Bumble Bee's `#ffd400` becomes `#ad9000`,
a gold that is unmistakably the theme's colour and still legible. The suite asserts both bars
for every theme, every variant, and every accent.

The selected session row is the mirror case: it is a BACKGROUND under body text, so
`legibleTint` applies the strongest accent tint that keeps `label-primary` above 4.5:1 on that
row, per theme. A flat tint failed five light variants — and exposed that the old neutral grey
lift was already under AA on two of them, because lifting a surface toward the text spends the
very headroom the tint needs.

`pnpm test` enforces contrast floors on every variant — 4.5:1 for primary and secondary text
against both `bg` and `surface`, 3:1 for tertiary text, accents, errors and every syntax
colour against the code background. All failures are reported together, so a new palette can
be corrected in one pass.

### Adding an accent or a font

An accent is one entry in `ACCENTS` (`src/accents.ts`), light and dark values, and the suite
checks both clear 3:1 on the base palette they target.

A font is one entry in `FONTS` (`src/fonts.ts`) **plus** its faces in `src/font-faces.ts` —
see [Fonts are bundled](#fonts-are-bundled) for the licence constraint that governs which
faces may ship. Every stack still ends in a generic family (the suite checks), which only
matters if a bundled face somehow fails to decode.

## Contrast and scale

Two sliders, both independent of which palette is selected.

**Contrast** pushes surfaces and text apart — backgrounds toward the nearer extreme, text
toward the farther one — and deliberately leaves accents, state colours and syntax colours
exactly where the theme author put them. That separation is the point: previously the only
way to get a highly legible UI was to pick the one theme authored that way and take its
colours with it. Now Sakura at Maximum keeps its `#f2a0bd` pink while its background drops
from `#1e181c` to `#090708`. The suite asserts that raising the level never lowers a measured
ratio, for every theme in both modes, and that the identity colours never move.

**UI scale** is `zoom` on `#root`, driven by `--dshth-ui-scale`. It is honestly a UI scale and
not a font-size control, because a font-size control is not achievable from a plugin here: the
harness sets `font-size` literally in **305** places and through a `--dsw-font-*` token in only
**44**, so scaling the typography tokens would move about a seventh of the UI and leave the
rest — strictly worse than doing nothing. Reaching the other 305 means overriding dsh's rules
by their hashed CSS-module class names, which change on every harness build. `zoom` scales the
rendered result instead, so hardcoded px, our plugins and dsh's own chrome all move together,
and it targets `#root` rather than a class name. The trade-off, stated plainly: padding,
control heights and the sidebar's width scale too, exactly like browser zoom.

## Fonts are bundled

One axis, not two: a font choice sets the interface face **and** the code face, because "use
this face for everything" is what people actually want from the setting.

| Entry | Ships with the plugin |
| --- | --- |
| Default | no — your OS sans, and the best mono you have |
| Geist Mono | yes |
| JetBrains Mono | yes |

The two named faces travel **inside `client.js` as data URLs**, so they render identically on
every machine with nothing to install. That is the whole reason the list is short and the
reason it is trustworthy: a named face you have not installed falls through silently and looks
exactly like a setting that did nothing, which is a failure mode bundling removes rather than
labels. Verified on a machine with neither font installed — both register as `@font-face`,
load on demand, and measurably resolve.

Cost: 6 faces (400/500/700 × 2 families, Latin subsets) ≈ **124 kB base64**, taking the bundle
from 70 kB to ~194 kB. Latin only, because the other subsets would roughly triple that for
glyphs this UI does not reach for.

**Bundling is redistribution, so only OFL-1.1 faces qualify.** Berkeley Mono is a paid licence
and is deliberately not shipped — it is named in the Default stack instead, so it resolves for
anyone who owns it. Adding a face means adding it to `font-faces.ts` and checking its licence
permits redistribution; the suite asserts the byte budget and that Berkeley never appears as a
bundled face.

## Single-mode themes

A theme with no honest counterpart palette can set `pinScheme: 'light' | 'dark'`. Selecting it
calls `ctx.theme.setTheme()` with that built-in preference, which flips
`body[data-ds-dark-theme]` — so the base palette's own alpha borders, the shiki base rules and
any third-party CSS keyed on that attribute all land in the right mode.

That write is durable, so merely *previewing* such a theme would otherwise leave your
Light/Dark setting changed after backing out. The page remembers the preference it opened
with and puts it back on Revert or on close, unless the theme you land on pins the scheme
itself.

Prefer authoring a real second variant; every theme shipped here does.

## Development

```bash
pnpm install          # at the repo root
pnpm run build        # esbuild dual build → lib/index.js + lib/client.js
pnpm test             # rebuilds first, then catalogue + bundle suites
pnpm run typecheck
```

`pnpm test` builds before asserting, because both suites read the **built** output — the
catalogue suite imports `lib/index.js` and the bundle suite reads `lib/client.js` as text.

Client-half edits deploy on a browser refresh once `scripts/dev-link.ps1` has junctioned the
package into a profile; the host half (the first-paint bootstrap) needs a profile restart.

## License

MIT © Dennis Rongo
