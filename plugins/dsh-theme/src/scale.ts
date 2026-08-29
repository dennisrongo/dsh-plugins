/**
 * UI scale — the honest version of a "font size" control.
 *
 * A text-only size slider is not achievable from a plugin here, and it is worth
 * stating why rather than shipping a half one. The harness sets `font-size`
 * literally in 305 places and through a `--dsw-font-*` token in only 44, so
 * scaling the typography tokens would move about a seventh of the UI and leave
 * the rest — strictly worse than doing nothing. Reaching the other 305 means
 * overriding dsh's own rules by their hashed CSS-module class names
 * (`.VOzbGW_trigger`), which change on every harness build.
 *
 * `zoom` sidesteps both problems: it scales the rendered result, so hardcoded
 * px, our plugins and dsh's own chrome all move together, and it targets `#root`
 * rather than any class name, so a harness rebuild cannot break it. The
 * trade-off, stated plainly: this scales layout too — padding, control heights,
 * the sidebar's width — exactly like browser zoom. Text does not grow while the
 * furniture stays put.
 *
 * It rides a custom property (`--dshth-ui-scale`) consumed by one rule this
 * plugin injects, so it flows through the same override layer as everything
 * else and preview, revert and retraction need no special case.
 */
import type { TokenPairs } from './types.ts'

/** The token the injected rule reads. */
export const SCALE_TOKEN = '--dshth-ui-scale'

/** The single rule that turns the token into a scale. */
export const SCALE_RULE = `#root { zoom: var(${SCALE_TOKEN}, 1); }`

/** One step on the scale control. */
export interface ScaleLevel {
  /** Stable id; persisted. */
  id: string
  /** Slider label. */
  label: string
  /** The zoom factor. */
  value: number
}

/** The steps, smallest first — the slider's order. */
export const SCALE_LEVELS: readonly ScaleLevel[] = [
  { id: '90', label: '90%', value: 0.9 },
  { id: '100', label: '100%', value: 1 },
  { id: '110', label: '110%', value: 1.1 },
  { id: '125', label: '125%', value: 1.25 },
  { id: '150', label: '150%', value: 1.5 },
]

/** The level when nothing is stored. */
export const DEFAULT_SCALE = '100'

/**
 * Look one up by id.
 * @param id - a level id.
 * @returns the level, or undefined for ids no longer shipped.
 */
export function findScale(id: string | undefined): ScaleLevel | undefined {
  return SCALE_LEVELS.find((level) => level.id === id)
}

/**
 * The scale layer's payload.
 *
 * Scale is scheme-invariant, so both modes carry the same value — which the
 * runtime requires explicitly rather than accepting a bare string.
 * @param level - the selected scale.
 * @returns the one token pair.
 */
export function scalePairs(level: ScaleLevel): TokenPairs {
  const value = String(level.value)
  return { [SCALE_TOKEN]: { light: value, dark: value } }
}
