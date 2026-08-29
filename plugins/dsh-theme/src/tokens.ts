/**
 * Palette → CSS custom properties.
 *
 * The harness ships three token layers on `<body>`: ~60 raw `--dsw-static-*`
 * ramp slots, 89 semantic `--dsw-alias-*` / `--dsw-specific-*` tokens that
 * mostly read `var(--dsw-static-*)`, and ~200 composed typography tokens that
 * read `var(--dsw-font-family)`. `ThemePresenter` writes a theme's tokens as
 * INLINE properties on `<body>`, which beat every stylesheet rule, and `var()`
 * substitution for the alias layer resolves against body's own computed value
 * — so overriding a ramp slot cascades into every alias built on it.
 *
 * This builder nonetheless emits at the ALIAS level, for two reasons found by
 * reading the shipped stylesheet:
 *
 *  1. 21 of the 89 alias tokens are literal rgba, not `var()` — every mask,
 *     `border-l1..l4`, `bg-skeleton`, and all the `interactive-bg-hover*`
 *     fills. They are black-alpha under the light palette and white-alpha
 *     under the dark one, so a ramp-only recolour leaves exactly the layer
 *     that makes a theme legible keyed to the stock palette.
 *  2. The two base mappings assign conflicting roles to the same ramp slot
 *     (`neutral-bluish-50` is a code-block background in light and primary
 *     label text in dark), so no single ramp fill can serve both.
 *
 * Five raw ramp slots ARE emitted, because `ui-conversation` and
 * `ui-trajectory` read them directly rather than through an alias.
 */
import { alpha, legibleFill, legibleTint, mix, readable } from './color.ts'
import { withContrast } from './contrast.ts'
import type { Mode, Palette, ThemeSpec, TokenMap, TokenPairs } from './types.ts'

/**
 * Fill in every optional palette field.
 * @param palette - the author's colours.
 * @param mode - which base palette this variant is authored against.
 * @returns the palette with all derivations resolved.
 */
function complete(palette: Palette, mode: Mode): Required<Omit<Palette, 'code'>> & { code: Palette['code'] } {
  const dark = mode === 'dark'
  return {
    ...palette,
    info: palette.info ?? palette.accent,
    // A sidebar that matches `bg` exactly reads as one undifferentiated slab;
    // one step away from the base gives the column an edge without a border.
    sidebar: palette.sidebar ?? (dark ? mix(palette.bg, '#000000', 0.25) : mix(palette.bg, palette.fg, 0.035)),
    accentFg: palette.accentFg ?? readable(palette.accent, palette.bg, palette.fg, '#ffffff', '#000000'),
    bubble: palette.bubble ?? (dark ? mix(palette.surface, palette.fg, 0.05) : mix(palette.bg, palette.accent, 0.1)),
  }
}

/** One authored colour and the role it plays, for display. */
export interface PaletteRole {
  /** Field name as the theme author wrote it. */
  role: string
  /** The effective value, with optional fields resolved. */
  color: string
}

/**
 * The authored palette as an ordered, labelled list — surfaces, then text,
 * then the line, then the accents and states.
 *
 * Optional fields are resolved through the same derivation the builder uses,
 * so a theme that omits `sidebar` still shows the colour it will actually get
 * rather than a blank.
 * @param palette - the author's colours for one mode.
 * @param mode - the base palette this variant is authored against.
 * @returns the roles in display order.
 */
export function paletteRoles(palette: Palette, mode: Mode): PaletteRole[] {
  const p = complete(palette, mode)
  return [
    { role: 'bg', color: p.bg },
    { role: 'sidebar', color: p.sidebar },
    { role: 'surface', color: p.surface },
    { role: 'overlay', color: p.overlay },
    { role: 'border', color: p.border },
    { role: 'fg', color: p.fg },
    { role: 'muted', color: p.muted },
    { role: 'faint', color: p.faint },
    { role: 'accent', color: p.accent },
    { role: 'info', color: p.info },
    { role: 'error', color: p.error },
    { role: 'success', color: p.success },
    { role: 'warn', color: p.warn },
    { role: 'code', color: p.code.bg },
    { role: 'keyword', color: p.code.keyword },
    { role: 'string', color: p.code.string },
  ]
}

/**
 * Build every token for one palette mode.
 * @param source - the author's palette for this mode.
 * @param mode - the base palette this variant sits on; changes the few
 * derivations whose direction is scheme-dependent (scrims, tooltip inversion).
 * @returns a flat token map ready to be paired with the other mode.
 */
export function buildTokens(source: Palette, mode: Mode): TokenMap {
  const p = complete(source, mode)
  const dark = mode === 'dark'
  const code = p.code
  const codeFg = code.fg ?? p.fg

  /** Step a surface toward the foreground — the "one level up" move. */
  const lift = (base: string, amount: number): string => mix(base, p.fg, amount)

  /** The accent as an interactive fill; see the token it feeds, below. */
  const infoFill = legibleFill(p.accent, p.bg)

  return {
    // --- backgrounds -----------------------------------------------------
    '--dsw-alias-bg-base': p.bg,
    '--dsw-alias-bg-layer-1': p.surface,
    '--dsw-alias-bg-layer-2': p.surface,
    '--dsw-alias-bg-layer-3': p.overlay,
    '--dsw-alias-bg-module-platform': lift(p.bg, 0.04),
    '--dsw-alias-bg-multi-select': lift(p.surface, 0.06),
    '--dsw-alias-bg-overlay': p.overlay,
    '--dsw-alias-bg-skeleton': alpha(p.fg, 0.07),

    // Scrims sit over arbitrary content (images, modals), so they stay
    // neutral black rather than following the palette; only the drop scrim,
    // which tints toward the app surface, is derived.
    '--dsw-alias-bg-mask-1': dark ? '#00000080' : '#0000003d',
    '--dsw-alias-bg-mask-2': dark ? '#00000033' : '#0000001f',
    '--dsw-alias-bg-mask-3': '#0000007a',
    '--dsw-alias-bg-mask-photo': '#000000e0',
    '--dsw-alias-bg-mask-drop': alpha(p.bg, 0.7),

    // --- borders ---------------------------------------------------------
    // Four ascending steps off one authored line colour. Alpha rather than
    // solid so borders composite correctly over any layer beneath them.
    '--dsw-alias-border-l1': alpha(p.border, 0.35),
    '--dsw-alias-border-l2': alpha(p.border, 0.55),
    '--dsw-alias-border-l2-darkmode-thin': alpha(p.border, 0.35),
    '--dsw-alias-border-l3': alpha(p.border, 0.7),
    '--dsw-alias-border-l4': alpha(p.border, 0.85),
    '--dsw-alias-border-inverted': alpha(p.fg, 0.06),
    '--dsw-alias-border-inverted2': alpha(p.fg, 0.09),

    // --- brand -----------------------------------------------------------
    // Stock uses the highest-contrast neutral here, because `brand-primary`
    // is what `button-primary-fill` reads. Pointing it at the accent is the
    // single change that makes a theme feel applied rather than tinted.
    '--dsw-alias-brand-primary': p.accent,
    '--dsw-alias-brand-primary-invert': p.fg,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': p.accent,
    '--dsw-alias-brand-text': p.fg,

    // --- buttons ---------------------------------------------------------
    '--dsw-alias-button-contrast-fill': mix(p.fg, p.bg, 0.12),
    '--dsw-alias-button-elevated-fill': p.overlay,
    '--dsw-alias-button-floating-fill': p.surface,
    '--dsw-alias-button-floating-hover': lift(p.surface, 0.07),
    '--dsw-alias-button-ghost-active-border': p.border,
    '--dsw-alias-button-ghost-active-fill': lift(p.surface, 0.08),
    '--dsw-alias-button-ghost-active-hover': lift(p.surface, 0.14),
    // The send button — dsh's single most prominent control — reads this
    // token, and its CSS hardcodes a white icon. Pointing it at the accent is
    // what makes a theme's identity visible at all: `brand-primary` and the
    // `deepseek-*` slots are barely painted by the current UI, so an accent
    // routed only there is applied but invisible. `legibleFill` finds the
    // nearest shade that keeps the white icon and the control's own edge both
    // above 3:1.
    '--dsw-alias-button-info-fill': infoFill,
    '--dsw-alias-button-info-hover': mix(infoFill, p.fg, 0.18),
    '--dsw-alias-button-primary-dimmed': mix(p.accent, p.bg, 0.72),
    // `button-primary-fill` is `var(--dsw-alias-brand-primary)` upstream and
    // is left alone so the indirection keeps working.
    '--dsw-alias-button-primary-hover': mix(p.accent, p.fg, 0.18),
    // Toolbar buttons float over media thumbnails, not over the app palette.
    '--dsw-alias-button-tool-bar-fill': '#54555780',
    '--dsw-alias-button-tool-bar-fill-invisible': '#1f1f1f5c',
    '--dsw-alias-button-tool-bar-hover': '#54555799',

    // --- interaction -----------------------------------------------------
    '--dsw-alias-interactive-bg-hover': alpha(p.fg, 0.07),
    // The name says accent; stock uses a neutral. Tinting it is free contrast-wise
    // (it is a wash under existing text) and shows the palette on every hover.
    '--dsw-alias-interactive-bg-hover-accent': alpha(p.accent, 0.22),
    '--dsw-alias-interactive-bg-hover-danger': alpha(p.error, 0.13),
    '--dsw-alias-interactive-bg-hover-solid': lift(p.surface, 0.07),
    '--dsw-alias-interactive-bg-active': alpha(p.fg, 0.12),

    // --- labels ----------------------------------------------------------
    '--dsw-alias-label-primary': p.fg,
    '--dsw-alias-label-secondary': p.muted,
    '--dsw-alias-label-tertiary': p.faint,
    '--dsw-alias-label-caption': mix(p.faint, p.bg, 0.2),
    '--dsw-alias-label-dimmed': mix(p.faint, p.bg, 0.5),
    '--dsw-alias-label-primary-bluish': p.fg,
    '--dsw-alias-label-primary-dimmed': mix(p.fg, p.bg, 0.12),
    // Text drawn ON the primary/brand fill.
    '--dsw-alias-label-primary-foreground': p.accentFg,
    // Text drawn on an inverted chip (tooltips, toasts).
    '--dsw-alias-label-primary-inverted': p.bg,

    // --- markdown --------------------------------------------------------
    '--dsw-alias-markdown-code-block': code.bg,
    '--dsw-alias-markdown-code-block-banner': lift(code.bg, 0.05),
    '--dsw-alias-markdown-code-segment-selected': lift(code.bg, 0.1),
    '--dsw-alias-markdown-code-segment-unselected': code.bg,
    '--dsw-alias-markdown-inline-code': lift(code.bg, 0.06),
    '--dsw-alias-markdown-citation': lift(p.surface, 0.07),
    '--dsw-alias-markdown-placeholder': lift(p.bg, 0.04),
    '--dsw-alias-markdown-tag': lift(p.surface, 0.05),

    // --- scrollbars ------------------------------------------------------
    '--dsw-alias-scrollbar-bg-l1': alpha(p.fg, 0.18),
    '--dsw-alias-scrollbar-bg-l2': alpha(p.fg, 0.22),
    '--dsw-alias-scrollbar-hover-l1': alpha(p.fg, 0.3),
    '--dsw-alias-scrollbar-hover-l2': alpha(p.fg, 0.34),

    // --- state -----------------------------------------------------------
    '--dsw-alias-state-error-primary': p.error,
    '--dsw-alias-state-error-secondary': mix(p.error, p.bg, 0.2),
    '--dsw-alias-state-success-primary': p.success,
    '--dsw-alias-state-success-secondary': mix(p.success, p.bg, 0.2),
    '--dsw-alias-state-success-tertiary': mix(p.success, p.bg, 0.82),
    '--dsw-alias-state-warn-primary': p.warn,
    '--dsw-alias-state-warn-secondary': mix(p.warn, p.bg, 0.2),
    '--dsw-alias-state-warn-tertiary': mix(p.warn, p.bg, 0.82),
    '--dsw-alias-state-warn-label': p.warn,
    // The "business" pair is dsh's second accent surface: model labels, chips,
    // and — through `--mc-accent` — mission-control's tags and its pomodoro
    // pulse. Pointing it at the theme accent rather than `info` is most of what
    // makes a palette visible outside the send button. It is used as TEXT on a
    // surface, so it takes the raw accent (already asserted ≥3:1 against the
    // page) rather than the darkened fill variant.
    '--dsw-alias-state-business-primary': p.accent,
    '--dsw-alias-state-business-tertiary': mix(p.accent, p.bg, 0.78),

    // --- floating chrome -------------------------------------------------
    // Stock inverts these against the page (a dark tooltip in light mode), so
    // the derivation inverts too and `label-primary-inverted` supplies the text.
    '--dsw-alias-toast-bg': dark ? lift(p.surface, 0.18) : mix(p.fg, p.bg, 0.1),
    '--dsw-alias-tooltip-bg': dark ? lift(p.surface, 0.18) : mix(p.fg, p.bg, 0.1),

    // --- product-specific ------------------------------------------------
    '--dsw-specific-bubble': p.bubble,
    '--dsw-specific-bubble-highlight': mix(p.bubble, p.accent, 0.28),
    '--dsw-specific-input-major': p.surface,
    '--dsw-specific-login-input': lift(p.bg, 0.03),
    '--dsw-specific-menu': p.overlay,
    '--dsw-specific-selector': lift(p.surface, 0.05),
    '--dsw-specific-sidebar-fill': p.sidebar,
    '--dsw-specific-sidebar-nav-item-hover': lift(p.sidebar, 0.07),
    // The selected session row is the most-looked-at surface in the app, and a
    // neutral lift wastes it. Tinted lightly enough that `label-primary` on top
    // stays above 4.5:1 — the suite checks that pairing directly.
    // Tinted from the sidebar itself rather than from a lifted grey: lifting
    // moves the surface TOWARD the text, which spends the contrast headroom the
    // tint needs — two light themes were already under AA on the old grey lift.
    // The accent tint alone distinguishes the row, and reads better than grey.
    '--dsw-specific-sidebar-nav-item-active': legibleTint(p.sidebar, p.accent, p.fg),
    '--dsw-specific-sidebar-nav-item-active-accent': mix(p.sidebar, p.accent, 0.3),
    '--dsw-specific-tip': lift(p.surface, 0.05),

    // --- raw ramp slots read directly by components ----------------------
    // ui-conversation and ui-trajectory bypass the alias layer for these five;
    // without them a themed build keeps stock DeepSeek blue in the transcript.
    '--dsw-static-deepseek-500': p.accent,
    '--dsw-static-deepseek-200': mix(p.accent, p.bg, 0.7),
    // ui-conversation and ui-trajectory read these two directly for their
    // accent-coloured bits, so they follow the theme accent too.
    '--dsw-static-blue-500': p.accent,
    '--dsw-static-blue-450': p.accent,
    '--dsw-static-neutral-bluish-400': p.faint,

    // --- elevation + gradients -------------------------------------------
    '--dsw-shadow-lv1': dark ? '0 2px 4px 0 #00000059' : '0 2px 4px 0 #0000000d',
    '--dsw-shadow-lv1-blur': dark ? '0 4px 12px 0 #00000040' : '0 4px 12px 0 #00000005',
    '--dsw-shadow-lv2': dark
      ? '0 4px 12px 0 #00000040, 0 2px 8px 0 #0000004d'
      : '0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a',
    '--dsw-shadow-lv3': dark
      ? '0 0 1px 0 #00000080, 0 0 4px 0 #0000004d, 0 12px 32px 0 #00000066'
      : '0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014',
    '--dsw-linear-gradient-think': `linear-gradient(180deg, ${p.bg} 20.19%, ${alpha(p.bg, 0)} 100%)`,
    '--dsw-linear-think-select': `linear-gradient(180deg, ${p.surface} 20.19%, ${alpha(p.surface, 0)} 100%)`,

    // --- syntax highlighting ---------------------------------------------
    '--shiki-foreground': codeFg,
    '--shiki-background': code.bg,
    '--shiki-token-comment': code.comment,
    '--shiki-token-keyword': code.keyword,
    '--shiki-token-string': code.string,
    '--shiki-token-string-expression': code.string,
    '--shiki-token-constant': code.constant,
    '--shiki-token-function': code.function,
    '--shiki-token-parameter': code.parameter,
    '--shiki-token-punctuation': code.punctuation,
    '--shiki-token-link': code.link,
  }
}

/**
 * Fold a theme's two variants into the `{ light, dark }` pairs the runtime
 * takes. Both sides are always present, so switching the base colour scheme
 * never leaves a token resolved against the palette it was not authored for.
 * @param spec - the theme.
 * @param contrast - 0 to 1; pushes surfaces and text apart before the tokens are
 * derived, so every derived value follows the adjusted palette.
 * @returns the override-layer payload for `ctx.theme.overrideTokens`.
 */
export function themePairs(spec: ThemeSpec, contrast = 0): TokenPairs {
  const light = buildTokens(withContrast(spec.variants.light, 'light', contrast), 'light')
  const dark = buildTokens(withContrast(spec.variants.dark, 'dark', contrast), 'dark')
  const pairs: TokenPairs = {}
  for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
    // Both maps come from the same builder, so the union is belt-and-braces;
    // a missing side falls back rather than dropping the token.
    pairs[name] = { light: light[name] ?? dark[name], dark: dark[name] ?? light[name] }
  }
  return pairs
}
