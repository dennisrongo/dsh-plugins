/**
 * Contrast as its own axis, independent of which palette you picked.
 *
 * It exists because "I want that theme's contrast" and "I want that theme's
 * colours" were previously the same choice: the only way to get a very legible
 * UI was to select the one theme authored that way, and accept its hues with
 * it. Contrast is a legibility setting, not a palette, so it belongs on its own
 * control — every theme can be pushed toward maximum legibility while keeping
 * its own accent, states and syntax colours.
 *
 * The transform only ever pushes surfaces and text APART: backgrounds toward
 * the nearer extreme, text toward the farther one. Accents and state colours
 * are deliberately left alone — deepening the background already raises their
 * contrast, and shifting them would erode exactly the identity this axis is
 * meant to preserve. The suite asserts that raising the level never lowers a
 * measured ratio.
 */
import { mix } from './color.ts'
import type { Mode, Palette } from './types.ts'

/** One step on the contrast control. */
export interface ContrastLevel {
  /** Stable id; persisted. */
  id: string
  /** Slider label. */
  label: string
  /** 0 leaves the palette exactly as authored; 1 is the strongest push. */
  amount: number
}

/** The steps, weakest first — the slider's order. */
export const CONTRAST_LEVELS: readonly ContrastLevel[] = [
  { id: 'regular', label: 'Regular', amount: 0 },
  { id: 'more', label: 'More', amount: 0.28 },
  { id: 'high', label: 'High', amount: 0.55 },
  { id: 'higher', label: 'Higher', amount: 0.78 },
  { id: 'max', label: 'Maximum', amount: 1 },
]

/** The level when nothing is stored: the palette exactly as its author wrote it. */
export const DEFAULT_CONTRAST = 'regular'

/**
 * Look one up by id.
 * @param id - a level id.
 * @returns the level, or undefined for ids no longer shipped.
 */
export function findContrast(id: string | undefined): ContrastLevel | undefined {
  return CONTRAST_LEVELS.find((level) => level.id === id)
}

/**
 * Push a palette's surfaces and text apart.
 *
 * Optional fields stay optional: an omitted `sidebar` is left undefined so the
 * builder still derives it, from the ALREADY-adjusted background — deriving
 * after the transform is what keeps the ladder coherent at every level.
 * @param palette - the theme's authored colours for one mode.
 * @param mode - the base palette this variant is authored against; decides
 * which direction "deeper" and "farther" point.
 * @param amount - 0 to 1.
 * @returns the adjusted palette, or the original at amount 0.
 */
export function withContrast(palette: Palette, mode: Mode, amount: number): Palette {
  if (amount <= 0) return palette
  const dark = mode === 'dark'
  // Surfaces go toward the nearer extreme, text toward the farther one.
  const deep = dark ? '#000000' : '#ffffff'
  const far = dark ? '#ffffff' : '#000000'

  // Surfaces move less than the base so the layer ladder does not collapse
  // into one flat plane at high levels.
  const adjusted: Palette = {
    ...palette,
    bg: mix(palette.bg, deep, amount * 0.7),
    surface: mix(palette.surface, deep, amount * 0.45),
    overlay: mix(palette.overlay, deep, amount * 0.3),
    fg: mix(palette.fg, far, amount * 0.9),
    muted: mix(palette.muted, far, amount * 0.75),
    faint: mix(palette.faint, far, amount * 0.6),
    border: mix(palette.border, far, amount * 0.5),
    code: { ...palette.code, bg: mix(palette.code.bg, deep, amount * 0.7) },
  }
  if (palette.sidebar !== undefined) adjusted.sidebar = mix(palette.sidebar, deep, amount * 0.7)
  if (palette.bubble !== undefined) adjusted.bubble = mix(palette.bubble, deep, amount * 0.4)
  return adjusted
}
