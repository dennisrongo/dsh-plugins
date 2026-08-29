/**
 * The three override layers and the selection that drives them.
 *
 * `ctx.theme.overrideTokens(source, pairs)` keeps ONE layer per source string
 * and replaces it wholesale when the same source overrides again, so a preview
 * is just another call with the same source — no stacking bookkeeping, and no
 * way to leak a half-applied palette. Layers compose in registration order
 * with later layers winning per token, which is why accent registers after
 * theme: it recolours whatever palette is underneath without either knowing
 * about the other.
 *
 * Selection is browser-side, not in the Host settings document: a settings
 * write silently no-ops on a non-loopback connection, and it would round-trip
 * a `settings.describe` refresh through every bound scope — including
 * `ui-theme`'s, whose `adopt()` resets the preference to the durable value on
 * any change it sees. Where it is kept, and why that is a cookie rather than
 * localStorage alone, is `storage.ts`.
 */
import { accentPairs, findAccent } from './accents.ts'
import { findContrast } from './contrast.ts'
import { findFont, fontPairs } from './fonts.ts'
import { findScale, scalePairs } from './scale.ts'
import { findTheme } from './themes/index.ts'
import { themePairs } from './tokens.ts'
import type { Selection } from './storage.ts'
import type { Mode, TokenPairs } from './types.ts'

/** Layer identities. One per axis; the string also names the layer's origin. */
const SOURCE_THEME = '@dennisrongo/dsh-theme:palette'
const SOURCE_ACCENT = '@dennisrongo/dsh-theme:accent'
const SOURCE_FONT = '@dennisrongo/dsh-theme:font'
const SOURCE_SCALE = '@dennisrongo/dsh-theme:scale'

/** What this plugin needs from `ctx.theme`; the full service is broader. */
export interface ThemeService {
  getTheme(): { preference: string; active: { colorScheme: Mode } }
  setTheme(id: string): void
  overrideTokens(source: string, tokens: TokenPairs): () => void
}

/** Live disposers, one per source, so a cleared axis can retract its layer. */
const live = new Map<string, () => void>()

/** Replace or retract one layer. */
function put(theme: ThemeService, source: string, pairs: TokenPairs | undefined): void {
  if (pairs === undefined) {
    live.get(source)?.()
    live.delete(source)
    return
  }
  // overrideTokens replaces this source's whole layer and restacks it on top,
  // so the previous disposer is already a no-op; replacing the handle keeps
  // retraction pointing at the layer that is actually live.
  live.set(source, theme.overrideTokens(source, pairs))
}

/**
 * Project a selection onto the three layers.
 *
 * Idempotent and total: every axis is either overridden or explicitly
 * retracted, so applying the stock selection returns the UI to the palette the
 * harness ships rather than leaving the last theme's tokens behind.
 * @param theme - the harness theme service.
 * @param selection - the choice to apply.
 */
export function applySelection(theme: ThemeService, selection: Selection): void {
  const spec = findTheme(selection.theme)
  // Contrast is a parameter of the palette, not a layer of its own: it adjusts
  // the authored colours and the builder derives everything downstream from the
  // adjusted values, which is what keeps the surface ladder coherent at every
  // level. A separate layer would have to re-derive the same tokens anyway.
  const level = findContrast(selection.contrast)
  put(theme, SOURCE_THEME, spec === undefined ? undefined : themePairs(spec, level?.amount ?? 0))

  const scale = findScale(selection.scale)
  put(theme, SOURCE_SCALE, scale === undefined ? undefined : scalePairs(scale))

  const accent = findAccent(selection.accent)
  put(theme, SOURCE_ACCENT, accent === undefined ? undefined : accentPairs(accent))

  // One font choice drives both faces. The stock entry is a real override
  // rather than a retraction: it restates the harness's own stacks, so
  // switching back to it beats any layer another plugin left on these tokens.
  const font = findFont(selection.font)
  put(theme, SOURCE_FONT, font === undefined ? undefined : fontPairs(font))

  // A single-mode theme pins the base scheme. `setTheme` is called with a
  // BUILT-IN preference, which is the only kind the runtime persists, so this
  // survives the reload and cannot be snapped back by the settings adopt path.
  if (spec?.pinScheme !== undefined && theme.getTheme().preference !== spec.pinScheme) {
    theme.setTheme(spec.pinScheme)
  }
}

/**
 * Retract every layer this plugin owns.
 * @param theme - the harness theme service.
 */
export function retractAll(theme: ThemeService): void {
  for (const source of [...live.keys()]) put(theme, source, undefined)
}

/**
 * Whether backing out of a preview has to put the base colour scheme back.
 *
 * Previewing a `pinScheme` theme calls `setTheme` with a built-in preference,
 * which the runtime PERSISTS — so without this, glancing at a single-mode
 * theme and then reverting would leave the user's Light/Dark setting changed.
 * Pulled out of the panel as a pure function because it is the one piece of
 * that flow with a wrong answer available. It takes the pin rather than a
 * theme id so it stays independent of the catalogue — and so the pinned branch
 * is testable without a pinned theme having to ship.
 * @param pinned - the restored theme's own `pinScheme`, if it has one.
 * @param current - the preference right now, after the preview.
 * @param enteredWith - the preference when the page was opened, or when the
 * user last applied.
 * @returns the preference to write back, or undefined to leave it alone.
 */
export function schemeToRestore(
  pinned: Mode | undefined,
  current: string,
  enteredWith: string,
): string | undefined {
  // The theme being restored TO pins the scheme itself, so the pin is not a
  // preview artefact and must survive.
  if (pinned !== undefined) return undefined
  return current === enteredWith ? undefined : enteredWith
}
