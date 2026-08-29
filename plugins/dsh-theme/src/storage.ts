/**
 * Where the selection is kept, and why it is not localStorage alone.
 *
 * DSH Desktop serves the UI from an **ephemeral port per launch**. localStorage
 * is origin-scoped and an origin includes the port, so every Desktop restart is
 * a fresh origin with empty storage — the theme would reset on every launch.
 * That is not a hypothetical: it is the bug that forced `dsh-mission-control`
 * to grow a host half, and a running Desktop was observed here on port 43127.
 *
 * Cookies are the cheap fix, because **cookies are not isolated by port**
 * (RFC 6265 §8.5) — one set on `127.0.0.1` is readable from `127.0.0.1` on any
 * port, so it survives the relaunch. It also sidesteps which of `127.0.0.1` or
 * `localhost` the Desktop happens to load, since the cookie simply belongs to
 * whichever host the page is on.
 *
 * localStorage is still written and read as a fallback, for the case where
 * cookies are refused (a locked-down embed) — there the plugin degrades to
 * per-origin persistence rather than none. The payload is three kebab-case ids,
 * so the cookie is ~40 bytes on same-host requests.
 *
 * The host settings document was considered and rejected: `settingsScope`
 * writes silently no-op on a non-loopback connection, which would lose the
 * selection for every remote browser while working fine on the developer's own
 * machine — the worst failure signature available.
 */
import { DEFAULT_ACCENT } from './accents.ts'
import { DEFAULT_CONTRAST } from './contrast.ts'
import { DEFAULT_FONT } from './fonts.ts'
import { DEFAULT_SCALE } from './scale.ts'
import { STOCK_THEME } from './themes/index.ts'

/** The user's six-axis choice. */
export interface Selection {
  /** A theme id, or {@link STOCK_THEME} for the harness's own palette. */
  theme: string
  /** An accent id, or `theme` to leave the palette's accent alone. */
  accent: string
  /** A font id — one face for the whole UI, code included. */
  font: string
  /** A contrast level id — legibility, independent of which palette is on. */
  contrast: string
  /** A UI scale id. */
  scale: string
}

/** The selection when nothing has been chosen: the harness exactly as shipped. */
export const DEFAULT_SELECTION: Selection = {
  theme: STOCK_THEME,
  accent: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  contrast: DEFAULT_CONTRAST,
  scale: DEFAULT_SCALE,
}

/** Cookie name, and the localStorage keys kept as a fallback. */
export const COOKIE = 'dsh-theme'
const KEY_THEME = 'dsh-theme:theme'
const KEY_ACCENT = 'dsh-theme:accent'
const KEY_FONT = 'dsh-theme:font'
const KEY_CONTRAST = 'dsh-theme:contrast'
const KEY_SCALE = 'dsh-theme:scale'

/** Placeholder for the retired code-font slot, so later fields keep position. */
const RESERVED = '-'

/** Ten years; a theme choice should outlive the machine's uptime. */
const MAX_AGE = 315_360_000

/** Ids are kebab-case by contract, so anything else is not one of ours. */
const ID = /^[a-z0-9-]{1,40}$/

/**
 * Render a selection as a cookie value.
 * @param selection - the committed choice.
 * @returns `theme.accent.font.-.contrast.scale`. Field 3 is a RESERVED
 * placeholder: it held the code font before that axis merged into `font`, and
 * the slot stays so contrast and scale keep their positions. Appending to this
 * format is safe; renumbering it silently mis-reads every stored selection.
 */
export function formatSelection(selection: Selection): string {
  return (
    `${selection.theme}.${selection.accent}.${selection.font}.${RESERVED}` +
    `.${selection.contrast}.${selection.scale}`
  )
}

/**
 * Parse a cookie value back into a selection.
 *
 * Anything malformed falls back per-field rather than wholesale. That is what
 * makes the format extensible in place: a cookie written before the code-font
 * axis existed has three fields, and simply takes the default for the fourth
 * instead of being discarded.
 * @param raw - the stored value, if any.
 * @returns the selection, with defaults for anything absent or malformed.
 */
export function parseSelection(raw: string | undefined | null): Selection {
  const parts = (raw ?? '').split('.')
  const pick = (at: number, fallback: string): string =>
    parts[at] !== undefined && ID.test(parts[at]) ? parts[at] : fallback
  return {
    theme: pick(0, DEFAULT_SELECTION.theme),
    accent: pick(1, DEFAULT_SELECTION.accent),
    font: pick(2, DEFAULT_SELECTION.font),
    // index 3 is the retired code-font slot; see formatSelection.
    contrast: pick(4, DEFAULT_SELECTION.contrast),
    scale: pick(5, DEFAULT_SELECTION.scale),
  }
}

/**
 * Read one cookie from a `document.cookie` string.
 * @param jar - the raw cookie string.
 * @param name - the cookie name.
 * @returns the value, or undefined when absent.
 */
export function readCookie(jar: string, name: string): string | undefined {
  for (const part of jar.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() !== name) continue
    return decodeURIComponent(part.slice(at + 1).trim())
  }
  return undefined
}

/**
 * Read the stored selection: cookie first, then localStorage, then defaults.
 *
 * Storage being unavailable is not an error — it degrades to the stock palette
 * for the session.
 * @returns the stored selection.
 */
export function loadSelection(): Selection {
  try {
    const cookie = readCookie(document.cookie, COOKIE)
    if (cookie !== undefined) return parseSelection(cookie)
  } catch {
    // cookies refused — fall through to localStorage
  }
  try {
    return parseSelection(
      [
        window.localStorage.getItem(KEY_THEME) ?? DEFAULT_SELECTION.theme,
        window.localStorage.getItem(KEY_ACCENT) ?? DEFAULT_SELECTION.accent,
        window.localStorage.getItem(KEY_FONT) ?? DEFAULT_SELECTION.font,
        RESERVED,
        window.localStorage.getItem(KEY_CONTRAST) ?? DEFAULT_SELECTION.contrast,
        window.localStorage.getItem(KEY_SCALE) ?? DEFAULT_SELECTION.scale,
      ].join('.'),
    )
  } catch {
    return { ...DEFAULT_SELECTION }
  }
}

/**
 * Persist the selection to both stores.
 * @param selection - the committed choice.
 */
export function saveSelection(selection: Selection): void {
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(formatSelection(selection))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`
  } catch {
    // cookies refused — localStorage below still gives per-origin persistence
  }
  try {
    window.localStorage.setItem(KEY_THEME, selection.theme)
    window.localStorage.setItem(KEY_ACCENT, selection.accent)
    window.localStorage.setItem(KEY_FONT, selection.font)
    window.localStorage.setItem(KEY_CONTRAST, selection.contrast)
    window.localStorage.setItem(KEY_SCALE, selection.scale)
  } catch {
    // storage disabled — the choice still applies for this session
  }
}
