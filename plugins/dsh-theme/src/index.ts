/**
 * Host half of dsh-theme.
 *
 * Almost everything this plugin does happens in the browser, over `ctx.theme`'s
 * override-layer API, and the selection lives in localStorage rather than the
 * Host settings document (see `layers.ts` for why). There is no host service
 * and no `/api/` endpoint.
 *
 * The one thing the Host must do is inline the first-paint bootstrap, because
 * the plugin bundle executes several hundred milliseconds after the shell has
 * already painted — see `boot.ts`.
 *
 * The module also re-exports the catalogue and the token builder as plain ESM,
 * which is what lets `test/themes.mjs` validate every shipped theme under Node
 * with no DOM.
 */
import { bootInjection } from './boot.ts'
export { ACCENTS, DEFAULT_ACCENT, accentPairs, findAccent } from './accents.ts'
export { bootInjection, bootScript } from './boot.ts'
export { CONTRAST_LEVELS, DEFAULT_CONTRAST, findContrast, withContrast, type ContrastLevel } from './contrast.ts'
export {
  DEFAULT_SCALE,
  SCALE_LEVELS,
  SCALE_RULE,
  SCALE_TOKEN,
  findScale,
  scalePairs,
  type ScaleLevel,
} from './scale.ts'
export { alpha, contrast, css, legibleFill, luminance, mix, parse, readable } from './color.ts'
export { familiesOf } from './detect.ts'
export { DEFAULT_FONT, FONTS, findFont, fontPairs } from './fonts.ts'
// Exported for the suite: the pure decisions worth pinning. The rest of
// `layers.ts` and `storage.ts` touches the DOM and the theme service, so it
// stays out of the host half's surface.
export { schemeToRestore } from './layers.ts'
export {
  COOKIE,
  DEFAULT_SELECTION,
  formatSelection,
  parseSelection,
  readCookie,
  type Selection,
} from './storage.ts'
export { STOCK_THEME, THEMES, THEME_ALIASES, findTheme } from './themes/index.ts'
export { buildTokens, paletteRoles, themePairs } from './tokens.ts'
export type {
  AccentSpec,
  CodePalette,
  FontSpec,
  Mode,
  Palette,
  ThemeSpec,
  TokenMap,
  TokenModes,
  TokenPairs,
} from './types.ts'

/** The slice of the Host context this plugin uses. */
interface HostContext {
  on(event: string, listener: (table: unknown[]) => void): () => void
}

/**
 * Host plugin body: contribute the first-paint bootstrap to every index
 * render. Nothing else is mounted — no service, no settings namespace, no
 * route.
 * @param ctx - Host context. Optional so the module stays callable from tests.
 */
export function apply(ctx?: HostContext): void {
  if (typeof ctx?.on !== 'function') return
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootInjection())
  })
}
