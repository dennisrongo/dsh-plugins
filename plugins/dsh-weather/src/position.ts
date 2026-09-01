/**
 * Where the weather bar sits, and why the store is a cookie.
 *
 * DSH Desktop serves the UI from an ephemeral port per launch. localStorage
 * is origin-scoped (the port is part of the origin), so a localStorage-only
 * position would reset on every Desktop restart. Cookies are not isolated by
 * port (RFC 6265 §8.5), so one set on 127.0.0.1 is readable from that host
 * on any port. localStorage is still written and read as a fallback.
 *
 * The payload is a pair of 0..1 ratios of the movable range, not raw pixels,
 * so a restart at a different window size keeps the same relative spot.
 */

/** Cookie name. */
export const POS_COOKIE = 'dsh-weather-pos'

/** localStorage fallback key. */
export const POS_KEY = 'dsh-weather:pos'

/** Ten years; a parked bar should outlive the machine's uptime. */
const MAX_AGE = 315_360_000

/** Fraction of the movable range: 0 = min edge, 1 = max edge. */
export interface BarPos {
  x: number
  y: number
}

/** Viewport box the pill is clamped into, in the same px space as left/top. */
export interface ClampBox {
  width: number
  height: number
  viewW: number
  viewH: number
  minTop: number
  pad: number
}

/** Render a position as `x,y` with four decimal places. */
export function formatPos(pos: BarPos): string {
  return `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`
}

/**
 * Parse a stored `x,y` pair.
 * @returns the position, or null when absent or malformed.
 */
export function parsePos(raw: string | undefined | null): BarPos | null {
  if (raw == null || raw === '') return null
  const comma = raw.indexOf(',')
  if (comma === -1) return null
  const x = Number(raw.slice(0, comma))
  const y = Number(raw.slice(comma + 1))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

function rangeOf(box: ClampBox): { minLeft: number; maxLeft: number; minTop: number; maxTop: number } {
  const minLeft = box.pad
  const maxLeft = Math.max(minLeft, box.viewW - box.width - box.pad)
  const minTop = Math.max(box.pad, box.minTop)
  const maxTop = Math.max(minTop, box.viewH - box.height - box.pad)
  return { minLeft, maxLeft, minTop, maxTop }
}

/** Keep the pill fully on-screen and clear of the Windows drag strip. */
export function clampPx(left: number, top: number, box: ClampBox): { left: number; top: number } {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box)
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top)),
  }
}

/** Convert a stored ratio into clamped author-px left/top. */
export function posToPx(pos: BarPos, box: ClampBox): { left: number; top: number } {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box)
  return {
    left: minLeft + pos.x * (maxLeft - minLeft),
    top: minTop + pos.y * (maxTop - minTop),
  }
}

/** Convert author-px left/top into a ratio of the movable range. */
export function pxToPos(left: number, top: number, box: ClampBox): BarPos {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box)
  const spanX = maxLeft - minLeft
  const spanY = maxTop - minTop
  return {
    x: spanX <= 0 ? 0 : (left - minLeft) / spanX,
    y: spanY <= 0 ? 0 : (top - minTop) / spanY,
  }
}

/**
 * Read one cookie from a `document.cookie` string.
 * @returns the decoded value, or undefined when absent.
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

/** Cookie assignment string for `document.cookie`. */
export function posCookieWrite(pos: BarPos): string {
  return `${POS_COOKIE}=${encodeURIComponent(formatPos(pos))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`
}

/**
 * Cookie first, then localStorage, then none.
 * @param jar - `document.cookie`.
 * @param storageGet - `localStorage.getItem` bound, or a test double.
 */
export function loadPosFromStores(
  jar: string,
  storageGet: (key: string) => string | null,
): BarPos | null {
  try {
    const cookie = readCookie(jar, POS_COOKIE)
    const fromCookie = parsePos(cookie)
    if (fromCookie) return fromCookie
  } catch {
    // cookies refused — fall through
  }
  try {
    return parsePos(storageGet(POS_KEY))
  } catch {
    return null
  }
}
