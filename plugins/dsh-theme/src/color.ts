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
  r: number
  g: number
  b: number
  a: number
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/**
 * Parse a hex colour in any of the four CSS hex forms.
 * @param input - `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`.
 * @returns the decomposed colour.
 * @throws {TypeError} when the string is not one of those forms — a theme with
 * a typo'd colour must fail at build/test time, never render half-applied.
 */
export function parse(input: string): Rgba {
  const hex = input.trim()
  const short = HEX3.exec(hex) ?? HEX4.exec(hex)
  if (short !== null) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
      a: short[4] === undefined ? 1 : Number.parseInt(short[4] + short[4], 16) / 255,
    }
  }
  const long = HEX6.exec(hex) ?? HEX8.exec(hex)
  if (long !== null) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
      a: long[4] === undefined ? 1 : Number.parseInt(long[4], 16) / 255,
    }
  }
  throw new TypeError(`dsh-theme: "${input}" is not a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa)`)
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const hex2 = (n: number): string => clamp255(n).toString(16).padStart(2, '0')

/**
 * Render a colour back to CSS.
 * @param c - the colour.
 * @returns `#rrggbb` when fully opaque, otherwise `rgba(r, g, b, a)`.
 */
export function css(c: Rgba): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.round(c.a * 1000) / 1000})`
}

/**
 * Blend two colours in sRGB.
 * @param from - the base colour.
 * @param to - the colour blended in.
 * @param amount - 0 returns `from`, 1 returns `to`.
 * @returns the blended colour as a CSS string.
 */
export function mix(from: string, to: string, amount: number): string {
  const a = parse(from)
  const b = parse(to)
  const t = Math.max(0, Math.min(1, amount))
  return css({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  })
}

/**
 * Restate a colour at a given opacity.
 * @param input - the colour.
 * @param alpha - target alpha, 0-1.
 * @returns the colour as `rgba(...)`.
 */
export function alpha(input: string, value: number): string {
  const c = parse(input)
  return css({ ...c, a: Math.max(0, Math.min(1, value)) })
}

/** Channel-wise sRGB → linear, per WCAG 2.x relative-luminance. */
function channel(v: number): number {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * WCAG relative luminance.
 * @param input - an opaque colour (alpha is ignored; composite first if needed).
 * @returns luminance in 0-1.
 */
export function luminance(input: string): number {
  const c = parse(input)
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/**
 * WCAG contrast ratio between two opaque colours.
 * @param first - one colour.
 * @param second - the other colour.
 * @returns the ratio, 1-21.
 */
export function contrast(first: string, second: string): number {
  const a = luminance(first)
  const b = luminance(second)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

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
export function legibleFill(
  accent: string,
  background: string,
  onFill = '#ffffff',
  target = 3,
): string {
  // Sweep outward from the authored accent so the least-altered shade wins:
  // 0, darker, lighter, more darker, more lighter, …
  const amounts: number[] = [0]
  for (let step = 0.02; step <= 0.8; step += 0.02) amounts.push(step, -step)

  let best = accent
  let bestScore = -Infinity
  for (const amount of amounts) {
    const candidate =
      amount === 0 ? accent
      : amount > 0 ? mix(accent, '#000000', amount)
      : mix(accent, '#ffffff', -amount)
    const glyph = contrast(candidate, onFill)
    const edge = contrast(candidate, background)
    if (glyph >= target && edge >= target) return candidate
    // Neither bar is worth over-satisfying, so cap each before summing —
    // otherwise a wildly legible glyph hides an invisible control.
    const score = Math.min(glyph, target) + Math.min(edge, target)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

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
export function legibleTint(
  base: string,
  hue: string,
  text: string,
  target = 4.5,
  max = 0.22,
): string {
  for (let amount = max; amount > 0.005; amount -= 0.02) {
    const candidate = mix(base, hue, amount)
    if (contrast(text, candidate) >= target) return candidate
  }
  return base
}

/**
 * Pick whichever candidate reads better against a background.
 * @param background - the surface the text sits on.
 * @param candidates - options in preference order; ties keep the earlier one.
 * @returns the highest-contrast candidate.
 */
export function readable(background: string, ...candidates: string[]): string {
  let best = candidates[0]
  let bestRatio = contrast(background, best)
  for (const candidate of candidates.slice(1)) {
    const ratio = contrast(background, candidate)
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }
  return best
}
