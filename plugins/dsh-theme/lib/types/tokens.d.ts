import type { Mode, Palette, ThemeSpec, TokenMap, TokenPairs } from './types.ts';
/** One authored colour and the role it plays, for display. */
export interface PaletteRole {
    /** Field name as the theme author wrote it. */
    role: string;
    /** The effective value, with optional fields resolved. */
    color: string;
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
export declare function paletteRoles(palette: Palette, mode: Mode): PaletteRole[];
/**
 * Build every token for one palette mode.
 * @param source - the author's palette for this mode.
 * @param mode - the base palette this variant sits on; changes the few
 * derivations whose direction is scheme-dependent (scrims, tooltip inversion).
 * @returns a flat token map ready to be paired with the other mode.
 */
export declare function buildTokens(source: Palette, mode: Mode): TokenMap;
/**
 * Fold a theme's two variants into the `{ light, dark }` pairs the runtime
 * takes. Both sides are always present, so switching the base colour scheme
 * never leaves a token resolved against the palette it was not authored for.
 * @param spec - the theme.
 * @param contrast - 0 to 1; pushes surfaces and text apart before the tokens are
 * derived, so every derived value follows the adjusted palette.
 * @returns the override-layer payload for `ctx.theme.overrideTokens`.
 */
export declare function themePairs(spec: ThemeSpec, contrast?: number): TokenPairs;
