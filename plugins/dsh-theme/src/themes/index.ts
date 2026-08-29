/**
 * The theme catalogue.
 *
 * Adding a theme is two steps: write `themes/<id>.ts` exporting a
 * {@link ThemeSpec}, then add it to {@link THEMES}. Nothing else in the plugin
 * needs to know it exists — the settings list, the preview, the persisted
 * selection and the contrast test all iterate this array.
 *
 * Order is display order; keep the list alphabetical by label so a growing
 * catalogue stays scannable.
 */
import type { ThemeSpec } from '../types.ts'
import { catppuccin } from './catppuccin.ts'
import { citron } from './citron.ts'
import { claude } from './claude.ts'
import { everforest } from './everforest.ts'
import { gruvbox } from './gruvbox.ts'
import { bumbleBee } from './bumble-bee.ts'
import { nord } from './nord.ts'
import { one } from './one.ts'
import { rosePine } from './rose-pine.ts'
import { sakura } from './sakura.ts'
import { solarized } from './solarized.ts'
import { tokyoNight } from './tokyo-night.ts'

/** Every selectable theme, in display order. */
export const THEMES: readonly ThemeSpec[] = [
  bumbleBee,
  catppuccin,
  citron,
  claude,
  everforest,
  gruvbox,
  nord,
  one,
  rosePine,
  sakura,
  solarized,
  tokyoNight,
]

/** The id meaning "no theme layer" — the harness's own DeepSeek palette. */
export const STOCK_THEME = 'stock'

/**
 * Ids that have been renamed, old → new.
 *
 * A theme id is persisted, so renaming one silently resets everybody who had it
 * selected — they reopen the app on the stock palette with no explanation.
 * `high-contrast` became `bumble-bee` when contrast turned into its own axis and
 * the name stopped describing a palette. Keep entries here forever; they cost a
 * line and they are the difference between a rename and a data loss.
 */
export const THEME_ALIASES: Readonly<Record<string, string>> = {
  'high-contrast': 'bumble-bee',
}

/**
 * Look one up by id, following renames.
 * @param id - a theme id, or {@link STOCK_THEME}.
 * @returns the theme, or undefined for stock and for ids no longer shipped.
 */
export function findTheme(id: string | undefined): ThemeSpec | undefined {
  const resolved = id === undefined ? undefined : (THEME_ALIASES[id] ?? id)
  return THEMES.find((theme) => theme.id === resolved)
}
