/**
 * The accent catalogue and its token layer.
 *
 * A third independent layer, stacked above the theme layer, so it recolours
 * whatever palette is underneath without the theme knowing. Layers compose in
 * registration order with later layers winning per token, and this one is
 * registered after the theme — so an accent always beats the theme's own.
 *
 * Each entry carries a value per base palette because a hue that reads on a
 * dark surface is usually too light on a white one.
 *
 * Adding an accent is one entry in {@link ACCENTS}.
 */
import { legibleFill, legibleTint, mix, readable } from './color.ts'
import type { AccentSpec, TokenPairs } from './types.ts'

/**
 * Every selectable accent, in display order.
 *
 * "Theme default" is NOT an entry here. It means "no accent layer", so it has
 * no colours to hold; the picker renders it as a leading option and the
 * catalogue stays free of a sentinel row with empty hex strings in it.
 */
export const ACCENTS: readonly AccentSpec[] = [
  { id: 'blue', label: 'Blue', light: '#2563eb', dark: '#60a5fa' },
  { id: 'violet', label: 'Violet', light: '#7c3aed', dark: '#a78bfa' },
  { id: 'magenta', label: 'Magenta', light: '#be185d', dark: '#f472b6' },
  { id: 'red', label: 'Red', light: '#dc2626', dark: '#f87171' },
  { id: 'amber', label: 'Amber', light: '#b45309', dark: '#fbbf24' },
  { id: 'green', label: 'Green', light: '#15803d', dark: '#4ade80' },
  { id: 'teal', label: 'Teal', light: '#0f766e', dark: '#2dd4bf' },
  { id: 'graphite', label: 'Graphite', light: '#3f3f46', dark: '#d4d4d8' },
]

/** The id meaning "leave the theme's own accent alone" — no layer is applied. */
export const DEFAULT_ACCENT = 'theme'

/** Display label for {@link DEFAULT_ACCENT}. */
export const DEFAULT_ACCENT_LABEL = 'Theme default'

/**
 * Look one up by id.
 * @param id - an accent id.
 * @returns the accent, or undefined for the default and for retired ids.
 */
export function findAccent(id: string | undefined): AccentSpec | undefined {
  return ACCENTS.find((entry) => entry.id === id)
}

/**
 * The accent layer's payload.
 *
 * Covers only the tokens whose job is "the brand hue": the primary fill and
 * its hover, the two chat-bubble tints, the active nav wash, and the raw
 * `deepseek-*` ramp slots that `ui-conversation` and `ui-trajectory` read
 * directly. Backgrounds, text and state colours stay with the theme.
 * @param accent - the selected accent.
 * @returns the token pairs for that accent.
 */
export function accentPairs(accent: AccentSpec): TokenPairs {
  const build = (hue: string, surface: string, text: string): Record<string, string> => {
    // Same reasoning as the theme layer: without this the accent axis changes
    // only tokens the UI barely paints, so choosing an accent appears to do
    // nothing. The send button's icon is hardcoded white, hence the fill.
    const fill = legibleFill(hue, surface)
    return {
      '--dsw-alias-brand-primary': hue,
      '--dsw-alias-brand-primary-new-colorprimary-new-color': hue,
      '--dsw-alias-button-primary-hover': mix(hue, text, 0.18),
      '--dsw-alias-button-primary-dimmed': mix(hue, surface, 0.72),
      '--dsw-alias-label-primary-foreground': readable(hue, surface, text, '#ffffff', '#000000'),
      '--dsw-alias-button-info-fill': fill,
      '--dsw-alias-button-info-hover': mix(fill, text, 0.18),
      '--dsw-specific-bubble-highlight': mix(surface, hue, 0.3),
      '--dsw-specific-sidebar-nav-item-active-accent': mix(surface, hue, 0.3),
      '--dsw-specific-sidebar-nav-item-active': legibleTint(surface, hue, text),
      // Same reach as the theme layer: model labels, chips, mission-control's
      // tags and pulse, and the two ramp slots the transcript reads directly.
      '--dsw-alias-state-business-primary': hue,
      '--dsw-alias-state-business-tertiary': mix(hue, surface, 0.78),
      '--dsw-alias-interactive-bg-hover-accent': mix(surface, hue, 0.22),
      '--dsw-static-blue-500': hue,
      '--dsw-static-blue-450': hue,
      '--dsw-static-deepseek-500': hue,
      '--dsw-static-deepseek-200': mix(hue, surface, 0.7),
    }
  }

  // The layer is applied over an unknown theme, so the surface and text
  // references are the base palettes' own extremes rather than the theme's —
  // near enough for a tint, and it keeps this layer independent of that one.
  const light = build(accent.light, '#ffffff', '#000000')
  const dark = build(accent.dark, '#1b1b1c', '#f9fafb')
  const pairs: TokenPairs = {}
  for (const name of Object.keys(light)) {
    pairs[name] = { light: light[name], dark: dark[name] }
  }
  return pairs
}
