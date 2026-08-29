/**
 * The font catalogue and its token layer.
 *
 * ONE axis, not two. Interface and code were briefly separate, which bought
 * orthogonality nobody wanted: what people actually asked for was "use this
 * face for everything". A single choice now sets both `--dsw-font-family` and
 * `--ds-font-family-code`, so picking Geist Mono gives you Geist Mono — sidebar,
 * transcript, code blocks and all.
 *
 * Every non-default entry is **bundled** with the plugin (see `font-faces.ts`),
 * which is what makes the list trustworthy: a named face that is not installed
 * falls through silently and looks exactly like a setting that did nothing.
 * Bundling removes that failure mode entirely — the face is always there.
 *
 * That constraint is also why the list is short. Bundling is redistribution, so
 * only OFL-1.1 faces qualify. Berkeley Mono is a paid licence and is not
 * shipped; if you own it, it resolves through the Default entry's stack, which
 * still names it.
 *
 * Adding an entry means adding the face to `font-faces.ts` too, and checking
 * its licence permits redistribution.
 */
import type { FontSpec, TokenPairs } from './types.ts'

/** The two names that matter: everything else is composed from them. */
const UI_TOKEN = '--dsw-font-family'
const CODE_TOKEN = '--ds-font-family-code'

/** The harness's own stacks, reproduced so "Default" is a real entry. */
const STOCK_UI =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'

// The harness's own code stack ends on CJK faces with no generic tail, so a
// machine with none of the listed fonts falls back to the browser default —
// which is proportional. The trailing `monospace` is the one deviation from
// stock, and it only applies when nothing above it resolved. Berkeley Mono and
// TX-02 are named here so an owner's local install is picked up.
const STOCK_CODE =
  '"Berkeley Mono", "TX-02", "SF Mono", "Cascadia Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei", monospace'

/** Tail behind a bundled face: only reached if the data URL somehow fails. */
const MONO_TAIL = '"Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace'

/** Every selectable font, in display order. */
export const FONTS: readonly FontSpec[] = [
  {
    id: 'default',
    label: 'Default',
    blurb: 'The harness’s own pairing — your OS sans, and the best mono you have.',
    bundled: false,
    ui: STOCK_UI,
    code: STOCK_CODE,
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    blurb: 'Geometric, even colour, generous spacing. Bundled — no install needed.',
    bundled: true,
    ui: `"Geist Mono", ${MONO_TAIL}`,
    code: `"Geist Mono", ${MONO_TAIL}`,
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    blurb: 'Tall x-height, tuned for long reading. Bundled — no install needed.',
    bundled: true,
    ui: `"JetBrains Mono", ${MONO_TAIL}`,
    code: `"JetBrains Mono", ${MONO_TAIL}`,
  },
]

/** The default when nothing is stored. */
export const DEFAULT_FONT = 'default'

/**
 * Look one up by id.
 * @param id - a font id.
 * @returns the entry, or undefined for ids no longer shipped.
 */
export function findFont(id: string | undefined): FontSpec | undefined {
  return FONTS.find((font) => font.id === id)
}

/**
 * The font layer's payload: both faces from one choice.
 *
 * A font is scheme-invariant, so both modes carry the same value — which the
 * runtime requires explicitly rather than accepting a bare string, so that an
 * override can never go illegible when the colour scheme flips.
 * @param font - the selected font.
 * @returns the two token pairs.
 */
export function fontPairs(font: FontSpec): TokenPairs {
  return {
    [UI_TOKEN]: { light: font.ui, dark: font.ui },
    [CODE_TOKEN]: { light: font.code, dark: font.code },
  }
}
