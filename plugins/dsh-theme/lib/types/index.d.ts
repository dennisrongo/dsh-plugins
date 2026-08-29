export { ACCENTS, DEFAULT_ACCENT, accentPairs, findAccent } from './accents.ts';
export { bootInjection, bootScript } from './boot.ts';
export { CONTRAST_LEVELS, DEFAULT_CONTRAST, findContrast, withContrast, type ContrastLevel } from './contrast.ts';
export { DEFAULT_SCALE, SCALE_LEVELS, SCALE_RULE, SCALE_TOKEN, findScale, scalePairs, type ScaleLevel, } from './scale.ts';
export { alpha, contrast, css, legibleFill, luminance, mix, parse, readable } from './color.ts';
export { familiesOf } from './detect.ts';
export { DEFAULT_FONT, FONTS, findFont, fontPairs } from './fonts.ts';
export { schemeToRestore } from './layers.ts';
export { COOKIE, DEFAULT_SELECTION, formatSelection, parseSelection, readCookie, type Selection, } from './storage.ts';
export { STOCK_THEME, THEMES, THEME_ALIASES, findTheme } from './themes/index.ts';
export { buildTokens, paletteRoles, themePairs } from './tokens.ts';
export type { AccentSpec, CodePalette, FontSpec, Mode, Palette, ThemeSpec, TokenMap, TokenModes, TokenPairs, } from './types.ts';
/** The slice of the Host context this plugin uses. */
interface HostContext {
    on(event: string, listener: (table: unknown[]) => void): () => void;
}
/**
 * Host plugin body: contribute the first-paint bootstrap to every index
 * render. Nothing else is mounted — no service, no settings namespace, no
 * route.
 * @param ctx - Host context. Optional so the module stays callable from tests.
 */
export declare function apply(ctx?: HostContext): void;
