/**
 * Which face a font stack actually resolves to on THIS machine.
 *
 * System stacks name the best face per platform and fall through the rest, so
 * two presets can land on the same installed family and look identical — on a
 * stock Windows box "Humanist" reaches Segoe UI Variable Text, which is all but
 * indistinguishable from the Segoe UI the default already uses. Without this
 * the honest user reaction is "I'm not sure the font is being applied", which
 * is exactly the report that prompted it.
 *
 * `document.fonts.check()` is useless here — it answers true for any family
 * name, including nonsense, because falling back always succeeds. The reliable
 * test is the classic one: put the candidate in front of a generic and see
 * whether the measured width moves.
 */

/** CSS generic families: the end of a stack, never something to probe for. */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
])

/**
 * Split a CSS font stack into its family names, unquoted and trimmed.
 * @param stack - a `font-family` value.
 * @returns the families in declaration order.
 */
export function familiesOf(stack: string): string[] {
  return stack
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').trim())
    .filter((part) => part.length > 0)
}

/** Probe results are stable for the page's lifetime, and each costs a measure. */
const cache = new Map<string, boolean>()

/**
 * Whether a family is actually installed.
 *
 * @param family - an exact family name (not a generic).
 * @returns whether the browser can render with it.
 */
export function isAvailable(family: string): boolean {
  const hit = cache.get(family)
  if (hit !== undefined) return hit
  let found = false
  try {
    const context = document.createElement('canvas').getContext('2d')
    if (context !== null) {
      // Glyphs chosen to differ widely between faces; a longer string makes the
      // comparison less likely to collide by coincidence.
      const text = 'mmmmmmmmmmlliWWW@#%'
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        context.font = `72px ${base}`
        const fallback = context.measureText(text).width
        context.font = `72px "${family}", ${base}`
        if (context.measureText(text).width !== fallback) {
          found = true
          break
        }
      }
    }
  } catch {
    // No canvas (hardened embed): report unknown rather than claiming absence.
    found = false
  }
  cache.set(family, found)
  return found
}

/**
 * The family a stack will actually render in.
 *
 * @param stack - a `font-family` value.
 * @returns the first installed family, the generic the stack ends on if none
 * are installed, or undefined for an empty stack.
 */
export function resolvedFamily(stack: string): string | undefined {
  const families = familiesOf(stack)
  for (const family of families) {
    // A generic is reached only when nothing before it resolved, and it IS the
    // answer at that point — no point probing for "sans-serif".
    if (GENERIC.has(family.toLowerCase())) return family
    if (isAvailable(family)) return family
  }
  return families[families.length - 1]
}
