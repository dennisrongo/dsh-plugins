import type { Mode, Palette } from './types.ts';
/** One step on the contrast control. */
export interface ContrastLevel {
    /** Stable id; persisted. */
    id: string;
    /** Slider label. */
    label: string;
    /** 0 leaves the palette exactly as authored; 1 is the strongest push. */
    amount: number;
}
/** The steps, weakest first — the slider's order. */
export declare const CONTRAST_LEVELS: readonly ContrastLevel[];
/** The level when nothing is stored: the palette exactly as its author wrote it. */
export declare const DEFAULT_CONTRAST = "regular";
/**
 * Look one up by id.
 * @param id - a level id.
 * @returns the level, or undefined for ids no longer shipped.
 */
export declare function findContrast(id: string | undefined): ContrastLevel | undefined;
/**
 * Push a palette's surfaces and text apart.
 *
 * Optional fields stay optional: an omitted `sidebar` is left undefined so the
 * builder still derives it, from the ALREADY-adjusted background — deriving
 * after the transform is what keeps the ladder coherent at every level.
 * @param palette - the theme's authored colours for one mode.
 * @param mode - the base palette this variant is authored against; decides
 * which direction "deeper" and "farther" point.
 * @param amount - 0 to 1.
 * @returns the adjusted palette, or the original at amount 0.
 */
export declare function withContrast(palette: Palette, mode: Mode, amount: number): Palette;
