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
import type { FontSpec, TokenPairs } from './types.ts';
/** Every selectable font, in display order. */
export declare const FONTS: readonly FontSpec[];
/** The default when nothing is stored. */
export declare const DEFAULT_FONT = "default";
/**
 * Look one up by id.
 * @param id - a font id.
 * @returns the entry, or undefined for ids no longer shipped.
 */
export declare function findFont(id: string | undefined): FontSpec | undefined;
/**
 * The font layer's payload: both faces from one choice.
 *
 * A font is scheme-invariant, so both modes carry the same value — which the
 * runtime requires explicitly rather than accepting a bare string, so that an
 * override can never go illegible when the colour scheme flips.
 * @param font - the selected font.
 * @returns the two token pairs.
 */
export declare function fontPairs(font: FontSpec): TokenPairs;
