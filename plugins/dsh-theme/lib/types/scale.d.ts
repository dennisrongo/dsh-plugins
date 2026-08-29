/**
 * UI scale — the honest version of a "font size" control.
 *
 * A text-only size slider is not achievable from a plugin here, and it is worth
 * stating why rather than shipping a half one. The harness sets `font-size`
 * literally in 305 places and through a `--dsw-font-*` token in only 44, so
 * scaling the typography tokens would move about a seventh of the UI and leave
 * the rest — strictly worse than doing nothing. Reaching the other 305 means
 * overriding dsh's own rules by their hashed CSS-module class names
 * (`.VOzbGW_trigger`), which change on every harness build.
 *
 * `zoom` sidesteps both problems: it scales the rendered result, so hardcoded
 * px, our plugins and dsh's own chrome all move together, and it targets `#root`
 * rather than any class name, so a harness rebuild cannot break it. The
 * trade-off, stated plainly: this scales layout too — padding, control heights,
 * the sidebar's width — exactly like browser zoom. Text does not grow while the
 * furniture stays put.
 *
 * It rides a custom property (`--dshth-ui-scale`) consumed by one rule this
 * plugin injects, so it flows through the same override layer as everything
 * else and preview, revert and retraction need no special case.
 */
import type { TokenPairs } from './types.ts';
/** The token the injected rule reads. */
export declare const SCALE_TOKEN = "--dshth-ui-scale";
/** The single rule that turns the token into a scale. */
export declare const SCALE_RULE = "#root { zoom: var(--dshth-ui-scale, 1); }";
/** One step on the scale control. */
export interface ScaleLevel {
    /** Stable id; persisted. */
    id: string;
    /** Slider label. */
    label: string;
    /** The zoom factor. */
    value: number;
}
/** The steps, smallest first — the slider's order. */
export declare const SCALE_LEVELS: readonly ScaleLevel[];
/** The level when nothing is stored. */
export declare const DEFAULT_SCALE = "100";
/**
 * Look one up by id.
 * @param id - a level id.
 * @returns the level, or undefined for ids no longer shipped.
 */
export declare function findScale(id: string | undefined): ScaleLevel | undefined;
/**
 * The scale layer's payload.
 *
 * Scale is scheme-invariant, so both modes carry the same value — which the
 * runtime requires explicitly rather than accepting a bare string.
 * @param level - the selected scale.
 * @returns the one token pair.
 */
export declare function scalePairs(level: ScaleLevel): TokenPairs;
