import type { AccentSpec, TokenPairs } from './types.ts';
/**
 * Every selectable accent, in display order.
 *
 * "Theme default" is NOT an entry here. It means "no accent layer", so it has
 * no colours to hold; the picker renders it as a leading option and the
 * catalogue stays free of a sentinel row with empty hex strings in it.
 */
export declare const ACCENTS: readonly AccentSpec[];
/** The id meaning "leave the theme's own accent alone" — no layer is applied. */
export declare const DEFAULT_ACCENT = "theme";
/** Display label for {@link DEFAULT_ACCENT}. */
export declare const DEFAULT_ACCENT_LABEL = "Theme default";
/**
 * Look one up by id.
 * @param id - an accent id.
 * @returns the accent, or undefined for the default and for retired ids.
 */
export declare function findAccent(id: string | undefined): AccentSpec | undefined;
/**
 * The accent layer's payload.
 *
 * Covers only the tokens whose job is "the brand hue": the primary fill and
 * its hover, the two chat-bubble tints, the active nav wash, and the raw
 * `deepseek-*` ramp slots that `ui-conversation` and `ui-trajectory` read
 * directly. Backgrounds, text and state colours stay with the theme.
 * @param accent - the selected accent.
 * @returns the token pairs for that accent.
 */
export declare function accentPairs(accent: AccentSpec): TokenPairs;
