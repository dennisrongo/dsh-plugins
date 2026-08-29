/**
 * Minimal sRGB colour maths for the token builder.
 *
 * Deliberately not `color-mix(in oklab, ...)`: the tokens this produces are
 * written as inline custom properties on `<body>` and are read back by tests,
 * by `ctx.theme.exportInspectTokens()`, and by anyone debugging in devtools.
 * Literal `#rrggbb` / `rgba()` values stay inspectable and comparable; a CSS
 * function does not. Doing the mixing here also lets the contrast test run
 * under Node with no DOM.
 */
/** A colour decomposed into 0-255 channels plus 0-1 alpha. */
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}
/**
 * Parse a hex colour in any of the four CSS hex forms.
 * @param input - `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`.
 * @returns the decomposed colour.
 * @throws {TypeError} when the string is not one of those forms — a theme with
 * a typo'd colour must fail at build/test time, never render half-applied.
 */
export declare function parse(input: string): Rgba;
/**
 * Render a colour back to CSS.
 * @param c - the colour.
 * @returns `#rrggbb` when fully opaque, otherwise `rgba(r, g, b, a)`.
 */
export declare function css(c: Rgba): string;
/**
 * Blend two colours in sRGB.
 * @param from - the base colour.
 * @param to - the colour blended in.
 * @param amount - 0 returns `from`, 1 returns `to`.
 * @returns the blended colour as a CSS string.
 */
export declare function mix(from: string, to: string, amount: number): string;
/**
 * Restate a colour at a given opacity.
 * @param input - the colour.
 * @param alpha - target alpha, 0-1.
 * @returns the colour as `rgba(...)`.
 */
export declare function alpha(input: string, value: number): string;
/**
 * WCAG relative luminance.
 * @param input - an opaque colour (alpha is ignored; composite first if needed).
 * @returns luminance in 0-1.
 */
export declare function luminance(input: string): number;
/**
 * WCAG contrast ratio between two opaque colours.
 * @param first - one colour.
 * @param second - the other colour.
 * @returns the ratio, 1-21.
 */
export declare function contrast(first: string, second: string): number;
/**
 * The nearest shade of an accent that works as an interactive fill.
 *
 * A fill has to clear two bars at once, and they pull in opposite directions on
 * a dark page: the glyph drawn on it must be legible, and the control must be
 * distinguishable from the surface behind it. Darkening a light accent fixes
 * the first and breaks the second.
 *
 * The bar is 3:1 rather than 4.5:1 because the content is an icon — dsh's send
 * button is a 16×16 SVG with no text — so WCAG's non-text contrast rule
 * applies. That is what makes both constraints satisfiable at once for light
 * accents on dark themes; at 4.5:1 the window mostly closes and every dark
 * theme's primary control goes muddy.
 *
 * @param accent - the theme's authored accent.
 * @param background - the surface the control sits on.
 * @param onFill - the colour of the glyph drawn on the fill (dsh hardcodes white).
 * @param target - minimum contrast ratio for both bars.
 * @returns the shade nearest the accent satisfying both, or the best
 * compromise when no shade can (a very dark accent on a very dark page).
 */
export declare function legibleFill(accent: string, background: string, onFill?: string, target?: number): string;
/**
 * The strongest accent tint a surface can take while the text on it stays legible.
 *
 * Tinting the selected-session row is one of the few places an accent is really
 * visible, but it is a BACKGROUND under body text — a fixed tint that looks
 * right on a dark theme pushed five light variants below AA. Walking the amount
 * down per theme keeps the maximum visible tint everywhere instead of picking
 * the weakest one that happens to work for all of them.
 *
 * @param base - the untinted surface.
 * @param hue - the accent to mix in.
 * @param text - the text drawn on this surface.
 * @param target - minimum contrast ratio for that text.
 * @param max - the most tint to apply when contrast allows it.
 * @returns the tinted surface, or `base` when no amount clears the bar.
 */
export declare function legibleTint(base: string, hue: string, text: string, target?: number, max?: number): string;
/**
 * Pick whichever candidate reads better against a background.
 * @param background - the surface the text sits on.
 * @param candidates - options in preference order; ties keep the earlier one.
 * @returns the highest-contrast candidate.
 */
export declare function readable(background: string, ...candidates: string[]): string;
