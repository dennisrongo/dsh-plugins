/** The user's six-axis choice. */
export interface Selection {
    /** A theme id, or {@link STOCK_THEME} for the harness's own palette. */
    theme: string;
    /** An accent id, or `theme` to leave the palette's accent alone. */
    accent: string;
    /** A font id — one face for the whole UI, code included. */
    font: string;
    /** A contrast level id — legibility, independent of which palette is on. */
    contrast: string;
    /** A UI scale id. */
    scale: string;
}
/** The selection when nothing has been chosen: the harness exactly as shipped. */
export declare const DEFAULT_SELECTION: Selection;
/** Cookie name, and the localStorage keys kept as a fallback. */
export declare const COOKIE = "dsh-theme";
/**
 * Render a selection as a cookie value.
 * @param selection - the committed choice.
 * @returns `theme.accent.font.-.contrast.scale`. Field 3 is a RESERVED
 * placeholder: it held the code font before that axis merged into `font`, and
 * the slot stays so contrast and scale keep their positions. Appending to this
 * format is safe; renumbering it silently mis-reads every stored selection.
 */
export declare function formatSelection(selection: Selection): string;
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
export declare function parseSelection(raw: string | undefined | null): Selection;
/**
 * Read one cookie from a `document.cookie` string.
 * @param jar - the raw cookie string.
 * @param name - the cookie name.
 * @returns the value, or undefined when absent.
 */
export declare function readCookie(jar: string, name: string): string | undefined;
/**
 * Read the stored selection: cookie first, then localStorage, then defaults.
 *
 * Storage being unavailable is not an error — it degrades to the stock palette
 * for the session.
 * @returns the stored selection.
 */
export declare function loadSelection(): Selection;
/**
 * Persist the selection to both stores.
 * @param selection - the committed choice.
 */
export declare function saveSelection(selection: Selection): void;
