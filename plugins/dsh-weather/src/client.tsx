/**
 * dsh-weather — weather bar for the DeepSeek Harness web UI.
 *
 * A pure-consumer client plugin registering into the additive `shell.overlay`
 * slot: a slim strip pinned to the top of the page showing current
 * conditions, temperature, wind, and a short hourly outlook.
 *
 * Data comes from Open-Meteo (https://open-meteo.com) — free, no API key,
 * CORS-enabled. Location resolution order:
 *   1. localStorage override (`dsh-weather:location` = "City Name")
 *   2. ipapi.co coarse IP geolocation (no key)
 *   3. hard fallback: New York City
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services (cordis fiber inject — service access is granted per-fiber). */
export const inject = ['slots']

// ---------------------------------------------------------------------------
// Types + pure logic (exported for the smoke test)
// ---------------------------------------------------------------------------

/** Temperature unit shown in the bar. */
export type TempUnit = 'C' | 'F'

export interface GeoResult {
  latitude: number
  longitude: number
  label: string
}

export interface WeatherNow {
  temperatureC: number
  apparentC: number
  weatherCode: number
  isDay: boolean
  windKph: number
  humidity: number
}

export interface HourPoint {
  /** Epoch ms. */
  at: number
  temperatureC: number
  weatherCode: number
}

export interface WeatherState {
  status: 'loading' | 'ready' | 'error'
  where?: string
  now?: WeatherNow
  next?: HourPoint[]
  fetchedAt?: number
  error?: string
}

/** WMO weather interpretation code → emoji + short label. */
export function describeCode(code: number, isDay = true): { icon: string; label: string } {
  const d = isDay
  if (code === 0) return { icon: d ? '☀️' : '🌙', label: 'Clear' }
  if (code === 1) return { icon: d ? '🌤️' : '🌙', label: 'Mostly clear' }
  if (code === 2) return { icon: '⛅', label: 'Partly cloudy' }
  if (code === 3) return { icon: '☁️', label: 'Overcast' }
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' }
  if (code >= 51 && code <= 55) return { icon: '🌦️', label: 'Drizzle' }
  if (code >= 56 && code <= 57) return { icon: '🌧️', label: 'Freezing drizzle' }
  if (code >= 61 && code <= 65) return { icon: '🌧️', label: 'Rain' }
  if (code >= 66 && code <= 67) return { icon: '🌧️', label: 'Freezing rain' }
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'Snow' }
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: 'Showers' }
  if (code >= 85 && code <= 86) return { icon: '🌨️', label: 'Snow showers' }
  if (code === 95) return { icon: '⛈️', label: 'Thunderstorm' }
  if (code >= 96 && code <= 99) return { icon: '⛈️', label: 'Thunderstorm + hail' }
  return { icon: '🌡️', label: `Code ${code}` }
}

/** Format "14:00"-style local hour from an ISO string's hour component. */
export function fmtHour(iso: string): string {
  const h = Number(iso.slice(11, 13))
  if (Number.isNaN(h)) return iso
  const suffix = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${suffix}`
}

/** Celsius → Fahrenheit. */
export function toF(celsius: number): number {
  return celsius * 9 / 5 + 32
}

/** Render a Celsius reading in the active unit, rounded, e.g. "72°F". */
export function fmtTemp(celsius: number, unit: TempUnit, withUnit = true): string {
  const value = Math.round(unit === 'F' ? toF(celsius) : celsius)
  return withUnit ? `${value}°${unit}` : `${value}°`
}

const REFRESH_MS = 15 * 60 * 1000
const LOCATION_KEY = 'dsh-weather:location'
const UNIT_KEY = 'dsh-weather:unit'

/** Read the saved unit; defaults to Fahrenheit. */
function loadUnit(): TempUnit {
  try {
    return window.localStorage.getItem(UNIT_KEY) === 'C' ? 'C' : 'F'
  } catch {
    return 'F'
  }
}

/** Persist the unit choice; storage failures are non-fatal. */
function saveUnit(unit: TempUnit): void {
  try {
    window.localStorage.setItem(UNIT_KEY, unit)
  } catch {
    // private mode / storage disabled — the toggle still works for this session
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Hard fallback when every geolocation provider is unreachable. */
const DEFAULT_LOCATION: GeoResult = { latitude: 40.7128, longitude: -74.006, label: 'New York' }

/** Per-provider budget. A hung provider must not stall the whole bar. */
const GEO_TIMEOUT_MS = 4000

/**
 * Coarse IP geolocation providers, tried in order.
 *
 * Each entry normalizes its own response shape, because these APIs disagree on
 * field names (`latitude` vs `lat`, string vs number coordinates). A provider
 * returning null means "no usable fix" and the chain moves on.
 *
 * NOTE: ipapi.co was removed — it is now behind a Cloudflare bot challenge and
 * answers 403 with an HTML interstitial, which is unusable from the browser.
 */
const GEO_PROVIDERS: { url: string; parse: (data: any) => GeoResult | null }[] = [
  {
    url: 'https://get.geojs.io/v1/ip/geo.json',
    parse: (d) => {
      // geojs returns coordinates as STRINGS.
      const latitude = Number(d?.latitude)
      const longitude = Number(d?.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      const region = d?.region ?? d?.country_code ?? ''
      return { latitude, longitude, label: d?.city ? `${d.city}, ${region}`.replace(/, $/, '') : 'Current location' }
    },
  },
  {
    url: 'https://freeipapi.com/api/json',
    parse: (d) => {
      const latitude = Number(d?.latitude)
      const longitude = Number(d?.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      const region = d?.regionName ?? d?.countryCode ?? ''
      return { latitude, longitude, label: d?.cityName ? `${d.cityName}, ${region}`.replace(/, $/, '') : 'Current location' }
    },
  },
]

/** fetch + JSON with a hard timeout, so one dead host cannot stall the bar. */
async function fetchJson(url: string, timeoutMs = GEO_TIMEOUT_MS): Promise<any> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

async function resolveLocation(): Promise<GeoResult> {
  const override = window.localStorage.getItem(LOCATION_KEY)
  if (override) {
    const q = encodeURIComponent(override)
    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`,
    )
    const hit = data?.results?.[0]
    if (hit) {
      return {
        latitude: hit.latitude,
        longitude: hit.longitude,
        label: hit.admin1 ? `${hit.name}, ${hit.admin1}` : String(hit.name),
      }
    }
    throw new Error(`unknown place "${override}"`)
  }
  // Try each provider in turn; a failure is expected traffic, not an error.
  for (const provider of GEO_PROVIDERS) {
    try {
      const hit = provider.parse(await fetchJson(provider.url))
      if (hit) return hit
    } catch {
      // provider down, blocked, or rate-limited — try the next one
    }
  }
  return DEFAULT_LOCATION
}

async function fetchWeather(): Promise<WeatherState> {
  const geo = await resolveLocation()
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${geo.latitude}&longitude=${geo.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code&forecast_days=2&wind_speed_unit=kmh&timezone=auto'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`)
  const data = await res.json()
  const c = data.current
  const times: string[] = data.hourly?.time ?? []
  const temps: number[] = data.hourly?.temperature_2m ?? []
  const codes: number[] = data.hourly?.weather_code ?? []
  const nowMs = Date.now()
  const next: HourPoint[] = []
  for (let i = 0; i < times.length && next.length < 6; i++) {
    const at = Date.parse(times[i])
    if (Number.isNaN(at) || at < nowMs - 30 * 60 * 1000) continue
    if (at === next[next.length - 1]?.at) continue
    next.push({ at, temperatureC: temps[i], weatherCode: codes[i] })
  }
  return {
    status: 'ready',
    where: geo.label,
    now: {
      temperatureC: c.temperature_2m,
      apparentC: c.apparent_temperature,
      weatherCode: c.weather_code,
      isDay: c.is_day === 1,
      windKph: c.wind_speed_10m,
      humidity: c.relative_humidity_2m,
    },
    next: next.filter((_, i) => i % 2 === 0).slice(0, 4),
    fetchedAt: nowMs,
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const BAR_STYLES = `
.dshwx {
  position: fixed;
  /* Centred on the viewport only until the bar has measured the shell (see
     useBandFit): the real centre is the middle of the span no docked overlay
     has claimed, written inline. */
  left: 50%;
  transform: translateX(-50%);
  top: 8px;
  z-index: 2147482900;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-specific-sidebar-fill, #1b1b1c);
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  font: 400 13px/1.4 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.12));
  cursor: default;
  user-select: none;
  white-space: nowrap;
  /* DSH Desktop on Windows overlays a 36px window-drag strip at the top of the
     viewport (#dsh-desktop-windows-drag-region: -webkit-app-region: drag,
     z-index 2147483644, pointer-events: none) that the compositor resolves
     BEFORE hit-testing. no-drag here is belt-and-braces only — the desktop
     preload already grants every button no-drag !important and the bar was
     still unclickable, so a covered element's no-drag does not punch a hole
     in an overlapping drag element (the same failure dsh-mission-control
     documented for its stage bar). The real fix is the layout rule below,
     which drops the bar clear of the strip. In a plain browser all of this
     is inert. */
  -webkit-app-region: no-drag;
}
body.dsh-desktop-windows-titlebar-layout .dshwx {
  /* Clear the desktop drag strip: 36px strip + the usual 8px gap. The body
     class is added by DSH Desktop's preload on Windows only, so the browser
     and non-Windows builds keep top: 8px. */
  top: 44px;
}
body[data-ds-dark-theme] .dshwx { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.5); }
.dshwx[hidden] { display: none; }
.dshwx-icon { font-size: 16px; }
.dshwx-temp {
  color: var(--dsw-alias-label-primary, #f9fafb);
  font-weight: 600; font-size: 14px;
  font-family: inherit; font-variant-numeric: tabular-nums;
  border: 0; background: transparent; padding: 1px 4px; margin: 0 -2px;
  border-radius: 6px; cursor: pointer; line-height: inherit;
}
.dshwx-temp:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); }
.dshwx-temp:focus-visible { outline: 2px solid var(--dsw-alias-label-caption, #81858c); outline-offset: 1px; }
.dshwx-label { color: var(--dsw-alias-label-secondary, #cfd3d6); }
/* The bar is a ~200px pill in the shell's top band — a small surface, so the
   loading state stays TEXT rather than becoming a skeleton, which would be
   heavier than the string it replaced. It takes the dim caption tone the other
   plugins use for the same rung; a MODIFIER rather than a change to
   .dshwx-label, which is shared with the loaded condition text and must keep
   its secondary weight. */
.dshwx-label.loading { color: var(--dsw-alias-label-tertiary, #adb2b8); }
.dshwx-where {
  color: var(--dsw-alias-label-tertiary, #adb2b8);
  max-width: 160px; overflow: hidden; text-overflow: ellipsis;
}
.dshwx-sep { width: 1px; height: 14px; background: var(--dsw-alias-border-l2, rgba(255,255,255,0.12)); flex: none; }
.dshwx-meta { color: var(--dsw-alias-label-caption, #81858c); font-size: 12px; }
.dshwx-hours { display: flex; gap: 8px; align-items: center; }
.dshwx-hour { display: flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-caption, #81858c); font-size: 12px; }
.dshwx-hour b { color: var(--dsw-alias-label-secondary, #cfd3d6); font-weight: 500; }
.dshwx-refresh {
  border: 0; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-caption, #81858c);
  font-size: 14px; padding: 2px; border-radius: 50%;
  display: grid; place-items: center;
}
.dshwx-refresh:hover { color: var(--dsw-alias-label-primary, #f9fafb); background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); }
.dshwx-refresh.busy { animation: dshwx-spin 0.9s linear infinite; }
@keyframes dshwx-spin { to { transform: rotate(360deg); } }
.dshwx-error { color: var(--dsw-alias-state-error-primary, #ef4444); font-size: 12px; }
/* --- Responsive tiers ---------------------------------------------------
   The bar is a single nowrap pill, so it sheds detail rather than wrap. Each
   tier also drops the separator that preceded the hidden group, otherwise
   stray dividers float with nothing between them.

   Keyed on the MEASURED band (data-fit), not on a viewport media query. The
   space this bar actually gets is the shell's content box minus whatever a
   docked overlay has claimed, so a 2400px window with a plan panel open can
   leave the bar less room than a phone — a media query would call that "full"
   and let the pill run under the panel. The measurement falls back to the
   viewport when there is no shell frame, so the tiers still work standalone. */

/* Tablet: drop the hourly outlook and the humidity/wind readout. */
.dshwx[data-fit="tablet"] .dshwx-hours,
.dshwx[data-fit="tablet"] .dshwx-meta,
.dshwx[data-fit="tablet"] .dshwx-sep-hours,
.dshwx[data-fit="tablet"] .dshwx-sep-meta,
.dshwx[data-fit="phone"] .dshwx-hours,
.dshwx[data-fit="phone"] .dshwx-meta,
.dshwx[data-fit="phone"] .dshwx-sep-hours,
.dshwx[data-fit="phone"] .dshwx-sep-meta,
.dshwx[data-fit="tiny"] .dshwx-hours,
.dshwx[data-fit="tiny"] .dshwx-meta,
.dshwx[data-fit="tiny"] .dshwx-sep-hours,
.dshwx[data-fit="tiny"] .dshwx-sep-meta { display: none; }

/* Phone: tighten spacing, shrink the place name, and give the controls
   touch-sized hit areas without changing the pill's visual weight. */
.dshwx[data-fit="phone"],
.dshwx[data-fit="tiny"] {
  gap: 7px;
  padding: 4px 10px;
  font-size: 12px;
}
.dshwx[data-fit="phone"] .dshwx-where,
.dshwx[data-fit="tiny"] .dshwx-where { max-width: 92px; }
.dshwx[data-fit="phone"] .dshwx-icon,
.dshwx[data-fit="tiny"] .dshwx-icon { font-size: 14px; }
.dshwx[data-fit="phone"] .dshwx-temp,
.dshwx[data-fit="tiny"] .dshwx-temp { font-size: 13px; padding: 5px 7px; margin: -4px -3px; }
.dshwx[data-fit="phone"] .dshwx-refresh,
.dshwx[data-fit="tiny"] .dshwx-refresh { padding: 7px; margin: -5px; }

/* Very narrow: the place name is the least load-bearing text — the icon,
   temperature and condition carry the meaning. */
.dshwx[data-fit="tiny"] .dshwx-where,
.dshwx[data-fit="tiny"] .dshwx-sep-where { display: none; }
.dshwx[data-fit="tiny"] { gap: 6px; }

/* Nowhere left to stand. Better absent for the moment a full-width overlay is
   up than a clipped stub sliding under it.

   visibility, NOT display. A display:none bar has no box, so
   getBoundingClientRect reports zero height, the band measurement has no rows
   to test claimants against and bails — and the bar would stay hidden forever
   after the overlay that squeezed it went away. A hidden box is still a box. */
.dshwx[data-fit="none"] { visibility: hidden; pointer-events: none; }

/* Coarse pointers (touch) get the larger hit areas at any width. */
@media (pointer: coarse) {
  .dshwx-temp { padding: 6px 8px; margin: -4px -4px; }
  .dshwx-refresh { padding: 8px; margin: -6px; }
}

@media (prefers-reduced-motion: reduce) {
  .dshwx-refresh.busy { animation: none; }
}
`

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dennisrongo/dsh-weather'
  tag.textContent = BAR_STYLES
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// Fitting the bar into what the shell has left
// ---------------------------------------------------------------------------

/**
 * The marker a docked overlay sets on itself to say it holds a right-hand
 * strip. `dsh-plan-board`'s plan dock sets it; see its DOCK_CLAIM for why the
 * claim rides the element instead of the shell frame's padding.
 */
const CLAIM_SELECTOR = '[data-dsh-overlay-claim="right"]'

/** Gap kept between the pill and whatever bounds it. */
const BAND_GUTTER = 16

/**
 * The effective CSS zoom on an element's subtree.
 *
 * `dsh-theme`'s UI scale is `#root { zoom: var(--dshth-ui-scale, 1) }` and this
 * bar renders inside it, which makes two coordinate spaces:
 * `getBoundingClientRect()` reports TRUE viewport px, while a length written to
 * `style.left` is an AUTHOR px the zoom multiplies again. Measuring in one and
 * writing in the other is exactly self-consistent at 100% — and wrong by the
 * zoom factor at every other step.
 * @param el - an element inside the subtree in question.
 * @returns the zoom factor; 1 when there is none or it cannot be derived.
 */
function zoomOf(el: HTMLElement): number {
  const own = (el as unknown as { currentCSSZoom?: number }).currentCSSZoom
  if (typeof own === 'number' && own > 0) return own
  const width = el.getBoundingClientRect().width
  return el.offsetWidth > 0 && width > 0 ? width / el.offsetWidth : 1
}

/**
 * Where the bar may sit. `centre` and `width` are TRUE viewport px — the space
 * the tiers are judged against — and `zoom` is what converts them back into the
 * author px the inline styles are written in.
 */
interface BandFit {
  centre: number
  width: number
  zoom: number
}

/** Display tier for a measured band width; the CSS keys its shedding on this. */
type FitTier = 'full' | 'tablet' | 'phone' | 'tiny' | 'none'

/**
 * The tier a band width earns.
 * @param width - available width in px, or undefined before measurement.
 * @returns the tier name.
 */
function tierOf(width: number | undefined): FitTier {
  if (width === undefined) return 'full'
  if (width < 200) return 'none'
  if (width <= 380) return 'tiny'
  if (width <= 520) return 'phone'
  if (width <= 720) return 'tablet'
  return 'full'
}

/**
 * Measure the horizontal span this bar may occupy.
 *
 * Two things narrow it. The shell frame's own padding is how
 * `dsh-mission-control` reserves its rail, so the frame's CONTENT box already
 * excludes that — reading the content box costs nothing and handles the rail
 * for free. What it does not cover is an overlay docked INSIDE the content box,
 * against its right edge: that is `dsh-plan-board`'s plan panel, and it marks
 * itself with {@link CLAIM_SELECTOR} rather than padding the frame (padding
 * would shrink the very column the panel measures itself from). A claimant only
 * counts when it actually shares this bar's rows and actually reaches the right
 * edge — an overlay somewhere in the middle of the shell is not a boundary.
 * A squeezed-to-nothing band is returned as a non-positive width rather than as
 * null: "there is no room right now" is a state the bar has to render (and then
 * recover from when the overlay leaves), not an absence of measurement.
 * @param band - the bar's current vertical extent, in viewport coordinates.
 * @returns the centre to align on and the width available.
 */
function measureBand(band: { top: number; bottom: number }): BandFit {
  const layer = document.querySelector<HTMLElement>('[data-shell-overlay]')
  const frame = layer?.parentElement ?? null
  // No shell frame — a bar rendered outside the harness's own layout still gets
  // a sensible band, and the tiers behave exactly like the old media queries.
  let left = 0
  let right = window.innerWidth
  if (frame !== null) {
    const rect = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    // getComputedStyle resolves padding in AUTHOR px; the rect is viewport px.
    // Scale the padding up before subtracting, or a reservation reads short by
    // the zoom factor and the band runs under whatever made it.
    const zoom = zoomOf(frame)
    left = rect.left + (parseFloat(style.paddingLeft) || 0) * zoom
    right = rect.right - (parseFloat(style.paddingRight) || 0) * zoom
  }

  // Array.from, not for..of: the tsconfig targets a lib without an iterable
  // NodeList, and iterating one directly does not compile.
  for (const claim of Array.from(document.querySelectorAll<HTMLElement>(CLAIM_SELECTOR))) {
    const rect = claim.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    // Not in this bar's rows.
    if (rect.bottom <= band.top || rect.top >= band.bottom) continue
    // Not against the right edge, so it does not bound this bar — 1px of slack
    // because both edges come from separate fractional measurements.
    if (rect.right < right - 1) continue
    right = Math.min(right, rect.left)
  }

  return {
    centre: left + (right - left) / 2,
    width: right - left - BAND_GUTTER * 2,
    zoom: frame === null ? 1 : zoomOf(frame),
  }
}

/**
 * Keep the bar centred in the span the shell has left it.
 *
 * Re-measures on the events that actually move the boundary: the frame
 * resizing or having its reservation padding rewritten, and a claimant
 * appearing, moving, resizing or leaving. The overlay layer is watched as a
 * subtree because a claimant is not there to observe until it mounts —
 * mutations from the bar's own inline writes are ignored, or applying a
 * measurement would schedule the next one forever.
 * @param ref - the bar element.
 * @returns the fit to apply, or null before the first measurement.
 */
function useBandFit(ref: React.RefObject<HTMLDivElement | null>): BandFit | null {
  const [fit, setFit] = React.useState<BandFit | null>(null)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return

    const measure = (): void => {
      const self = el.getBoundingClientRect()
      // No box at all — the bar is display:none somewhere up the tree, so there
      // are no rows to test claimants against. Keep the last fit; the `none`
      // tier deliberately hides with `visibility` so this stays reachable.
      if (self.height === 0) return
      const next = measureBand({ top: self.top, bottom: self.bottom })
      setFit((prev) =>
        prev !== null &&
        Math.abs(prev.centre - next.centre) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        prev.zoom === next.zoom
          ? prev
          : next,
      )
    }

    measure()
    const layer = document.querySelector<HTMLElement>('[data-shell-overlay]')
    const frame = layer?.parentElement ?? null

    const resize = new ResizeObserver(measure)
    if (frame !== null) resize.observe(frame)
    if (layer !== null) resize.observe(layer)
    // Changing `dsh-theme`'s UI scale moves every number this bar is centred on
    // and no ResizeObserver reports it — neither content-box nor
    // device-pixel-content-box fires, because a CSS zoom rewrites the rendered
    // result without resizing any observed box. The scale is an inline custom
    // property on <body>, so watch that instead.
    const scaleWatch = new MutationObserver(measure)
    scaleWatch.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })

    const mutation = new MutationObserver((records) => {
      // Our own inline left/max-width write is a mutation on this element; it
      // would re-enter measure() on every frame it settles.
      if (records.every((record) => el.contains(record.target as Node))) return
      measure()
    })
    if (layer !== null) {
      mutation.observe(layer, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'data-dsh-overlay-claim', 'hidden'],
      })
    }
    if (frame !== null) mutation.observe(frame, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', measure)

    return () => {
      resize.disconnect()
      scaleWatch.disconnect()
      mutation.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])

  return fit
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function WeatherBar(): React.JSX.Element {
  const [state, setState] = React.useState<WeatherState>({ status: 'loading' })
  const [busy, setBusy] = React.useState(false)
  const [unit, setUnit] = React.useState<TempUnit>(loadUnit)

  // Every branch below renders the same pill shell, so the ref, the measured
  // centre and the tier are assembled once and spread — a branch that forgot
  // them would silently go back to viewport-centred and slide under the panel.
  const ref = React.useRef<HTMLDivElement | null>(null)
  const fit = useBandFit(ref)
  const shell = {
    ref,
    className: 'dshwx',
    'data-fit': tierOf(fit?.width),
    // A non-positive width is the squeezed-out case: the `none` tier hides the
    // bar, and writing a negative max-width would be an ignored declaration
    // that left it at full size behind the overlay.
    //
    // Both lengths are divided by the zoom: `fit` is measured in viewport px
    // and these are author px the zoom scales again (see zoomOf).
    ...(fit === null || fit.width <= 0
      ? {}
      : {
          style: {
            left: `${fit.centre / fit.zoom}px`,
            maxWidth: `${fit.width / fit.zoom}px`,
          },
        }),
  }

  const toggleUnit = () => {
    setUnit((prev) => {
      const next = prev === 'C' ? 'F' : 'C'
      saveUnit(next)
      return next
    })
  }

  React.useEffect(() => injectStyles(), [])

  React.useEffect(() => {
    let alive = true
    const load = async () => {
      setBusy(true)
      try {
        const next = await fetchWeather()
        if (alive) setState(next)
      } catch (e) {
        if (alive) setState({ status: 'error', error: String((e as Error)?.message ?? e) })
      } finally {
        if (alive) setBusy(false)
      }
    }
    void load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const reload = () => {
    // Trigger a refresh outside the effect cadence.
    setBusy(true)
    fetchWeather()
      .then(setState)
      .catch((e) => setState({ status: 'error', error: String((e as Error)?.message ?? e) }))
      .finally(() => setBusy(false))
  }

  if (state.status === 'loading') {
    return (
      <div {...shell} role="status" aria-live="polite" aria-busy="true">
        <span className="dshwx-icon" aria-hidden="true">🌡️</span>
        <span className="dshwx-label loading">Loading weather…</span>
      </div>
    )
  }
  if (state.status === 'error' || !state.now) {
    return (
      <div {...shell} aria-live="polite">
        <span className="dshwx-icon">⚠️</span>
        <span className="dshwx-error" title={state.error}>Weather unavailable</span>
        <button className={`dshwx-refresh${busy ? ' busy' : ''}`} data-dsh-no-drag="" title="Retry" onClick={reload}>⟳</button>
      </div>
    )
  }

  const { icon, label } = describeCode(state.now.weatherCode, state.now.isDay)
  const other: TempUnit = unit === 'C' ? 'F' : 'C'
  const title = `${label} in ${state.where ?? ''} — feels like ${fmtTemp(state.now.apparentC, unit)}, humidity ${state.now.humidity}%, wind ${Math.round(state.now.windKph)} km/h · click the temperature for °${other}`
  return (
    <div {...shell} title={title} aria-live="polite">
      <span className="dshwx-icon">{icon}</span>
      <button
        type="button"
        className="dshwx-temp"
        data-dsh-no-drag=""
        onClick={toggleUnit}
        title={`Switch to °${other}`}
        aria-label={`Temperature ${fmtTemp(state.now.temperatureC, unit)}. Switch to degrees ${other === 'F' ? 'Fahrenheit' : 'Celsius'}.`}
      >
        {fmtTemp(state.now.temperatureC, unit)}
      </button>
      <span className="dshwx-label">{label}</span>
      {state.where ? (
        <>
          <span className="dshwx-sep dshwx-sep-where" />
          <span className="dshwx-where">{state.where}</span>
        </>
      ) : null}
      {state.next && state.next.length > 0 ? (
        <>
          <span className="dshwx-sep dshwx-sep-hours" />
          <span className="dshwx-hours">
            {state.next.map((h) => (
              <span className="dshwx-hour" key={h.at}>
                {new Date(h.at).getHours() % 12 || 12}{new Date(h.at).getHours() >= 12 ? 'pm' : 'am'}
                {' '}{describeCode(h.weatherCode).icon}
                <b>{fmtTemp(h.temperatureC, unit, false)}</b>
              </span>
            ))}
          </span>
        </>
      ) : null}
      <span className="dshwx-sep dshwx-sep-meta" />
      <span className="dshwx-meta">💧{state.now.humidity}% 🌬️{Math.round(state.now.windKph)}km/h</span>
      <button className={`dshwx-refresh${busy ? ' busy' : ''}`} data-dsh-no-drag="" title="Refresh weather" onClick={reload}>⟳</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: register the weather bar into the additive
 * shell.overlay seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-weather' },
          () => React.createElement(WeatherBar),
        ),
      ),
    'dsh-weather: shell.overlay registration',
  )
}
