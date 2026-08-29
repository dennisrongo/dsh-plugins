/**
 * Pre-plugin paint: the inline script that stops the flash of stock palette.
 *
 * Measured on this machine: the shell renders its first content well before
 * the plugin bundle executes (`#root` already had children when `apply()` ran
 * at 586ms, against a 51ms DOMContentLoaded) — so without this, every page
 * load shows roughly half a second of DeepSeek grey before the chosen theme
 * lands. That is the most visible defect a theme plugin can have.
 *
 * The harness solves the same problem for its own light/dark preference with
 * an index-injected body script (`ui-theme`'s `bootThemeInjection`), and this
 * is the same move for the theme layer. It cannot reuse that mechanism
 * directly, because the selection lives in localStorage — which the Host
 * cannot read. So the Host inlines the DATA and the browser does the lookup.
 *
 * Only a first-paint subset is inlined. The full token map is ~112 entries per
 * variant; shipping all of it for ten themes in every index render would cost
 * far more than the flash it prevents. These fifteen carry the perceived
 * colour of the shell — surfaces, text, sidebar, borders, brand — and the
 * plugin overwrites all of them with the complete map a few hundred
 * milliseconds later.
 */
import { FONTS } from './fonts.ts'
import { SCALE_LEVELS, SCALE_RULE, SCALE_TOKEN } from './scale.ts'
import { COOKIE } from './storage.ts'
import { THEME_ALIASES, THEMES } from './themes/index.ts'
import { buildTokens } from './tokens.ts'

/** The tokens that decide what the shell looks like before React paints. */
const FIRST_PAINT = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-input-major',
  '--dsw-specific-menu',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
] as const

/** Storage names, duplicated here because this half is generated on the Host. */
const KEY_THEME = 'dsh-theme:theme'
const KEY_FONT = 'dsh-theme:font'
const KEY_SCALE = 'dsh-theme:scale'

/**
 * The theme table as positional arrays keyed by the shared name list, which
 * keeps the inlined payload to a few kilobytes rather than repeating fifteen
 * token names twenty times.
 * @returns theme id → per-mode value arrays, aligned with {@link FIRST_PAINT}.
 */
function themeTable(): Record<string, { l: string[]; d: string[] }> {
  const table: Record<string, { l: string[]; d: string[] }> = {}
  for (const theme of THEMES) {
    const light = buildTokens(theme.variants.light, 'light')
    const dark = buildTokens(theme.variants.dark, 'dark')
    table[theme.id] = {
      l: FIRST_PAINT.map((name) => light[name] ?? ''),
      d: FIRST_PAINT.map((name) => dark[name] ?? ''),
    }
  }
  // Renamed ids are emitted as extra keys, so a cookie written before the
  // rename still paints instead of falling back to stock for one frame.
  for (const [was, now] of Object.entries(THEME_ALIASES)) {
    if (table[now] !== undefined) table[was] = table[now]
  }
  return table
}

/** Scale id → zoom factor. */
function scaleTable(): Record<string, number> {
  const table: Record<string, number> = {}
  for (const level of SCALE_LEVELS) table[level.id] = level.value
  return table
}

/** Font id → [interface stack, code stack]. One choice drives both. */
function fontTable(): Record<string, [string, string]> {
  const table: Record<string, [string, string]> = {}
  for (const font of FONTS) table[font.id] = [font.ui, font.code]
  return table
}

/**
 * The inline script body.
 *
 * Everything is wrapped in try/catch: this runs before the app exists, and a
 * theme preference is never worth breaking a page load over. The colour scheme
 * is read from the body attribute the harness's own bootstrap sets a row
 * earlier; if this somehow runs first, it falls back to the OS preference and
 * corrects itself at DOMContentLoaded.
 * @returns the script text.
 */
export function bootScript(): string {
  const names = JSON.stringify(FIRST_PAINT)
  const themes = JSON.stringify(themeTable())
  const fonts = JSON.stringify(fontTable())
  const scales = JSON.stringify(scaleTable())
  return `(() => {
  try {
    var N = ${names}, T = ${themes}, F = ${fonts}, S = ${scales};
    var paint = function () {
      var body = document.body
      if (!body) return
      // The harness's own bootstrap sets BOTH the body attribute and the root
      // colorScheme, so a set colorScheme means it has run and the attribute is
      // authoritative. Otherwise we are ahead of it and the OS is the best
      // guess; the DOMContentLoaded repaint below corrects that case.
      var booted = document.documentElement.style.colorScheme !== ''
      var dark = booted
        ? body.hasAttribute('data-ds-dark-theme')
        : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
      // Cookie first, for the same reason the plugin writes one: DSH Desktop
      // serves from a new ephemeral port every launch, so localStorage is a
      // fresh origin each time while the cookie survives (cookies are not
      // isolated by port). Without this the flash fix would work on the CLI
      // and fail on the Desktop, which is where it matters most.
      var themeId = null, fontId = null, scaleId = null
      try {
        var jar = document.cookie || ''
        for (var c = 0, parts = jar.split(';'); c < parts.length; c++) {
          var eq = parts[c].indexOf('=')
          if (eq === -1 || parts[c].slice(0, eq).trim() !== ${JSON.stringify(COOKIE)}) continue
          var fields = decodeURIComponent(parts[c].slice(eq + 1).trim()).split('.')
          themeId = fields[0] || null
          fontId = fields[2] || null
          scaleId = fields[5] || null
          break
        }
      } catch (e) {}
      if (themeId === null) {
        try {
          themeId = localStorage.getItem(${JSON.stringify(KEY_THEME)})
          fontId = localStorage.getItem(${JSON.stringify(KEY_FONT)})
          scaleId = localStorage.getItem(${JSON.stringify(KEY_SCALE)})
        } catch (e) {}
      }
      var row = themeId && T[themeId]
      if (row) {
        var values = dark ? row.d : row.l
        for (var i = 0; i < N.length; i++) if (values[i]) body.style.setProperty(N[i], values[i])
      }
      var font = fontId && F[fontId]
      if (font) {
        body.style.setProperty('--dsw-font-family', font[0])
        body.style.setProperty('--ds-font-family-code', font[1])
      }
      // Scale needs its rule present before #root exists, or the shell paints
      // once at 100% and jumps. The rule is idempotent — the client bundle
      // injects the same text later.
      var scale = scaleId && S[scaleId]
      if (scale && scale !== 1) {
        body.style.setProperty(${JSON.stringify(SCALE_TOKEN)}, String(scale))
        if (!document.getElementById('dshth-scale')) {
          var tag = document.createElement('style')
          tag.id = 'dshth-scale'
          tag.textContent = ${JSON.stringify(SCALE_RULE)}
          document.head.appendChild(tag)
        }
      }
    }
    paint()
    document.addEventListener('DOMContentLoaded', paint, { once: true })
  } catch (e) {}
})()`
}

/**
 * The bootstrap as an index-injection row: an inline script in the body, so it
 * runs before the shell mounts and before the module graph is fetched.
 * @returns the injection row.
 */
export function bootInjection(): { kind: 'script'; placement: 'body'; text: string } {
  return { kind: 'script', placement: 'body', text: bootScript() }
}
