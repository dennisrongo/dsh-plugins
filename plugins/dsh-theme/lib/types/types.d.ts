/**
 * The data model a theme author fills in.
 *
 * Adding a theme means writing one {@link ThemeSpec} — two {@link Palette}s of
 * roughly fifteen colours — and adding it to `themes/index.ts`. Everything the
 * harness actually consumes (89 alias/specific tokens, the handful of raw ramp
 * slots real components read directly, the shiki syntax colours, shadows and
 * gradients) is derived from that palette by `tokens.ts`, so a theme file never
 * mentions a `--dsw-*` name.
 */
/** One override-layer token value; both palette modes are mandatory upstream. */
export interface TokenModes {
    /** Value applied while the light base palette is active. */
    light: string;
    /** Value applied while the dark base palette is active. */
    dark: string;
}
/** Token name → per-mode values, the shape `ctx.theme.overrideTokens` takes. */
export type TokenPairs = Record<string, TokenModes>;
/** A flat token map for one palette mode. */
export type TokenMap = Record<string, string>;
/** Which base palette a variant is authored against. */
export type Mode = 'light' | 'dark';
/** Syntax-highlighting colours; drives the `--shiki-*` custom properties. */
export interface CodePalette {
    /** Code block background. */
    bg: string;
    /** Default code foreground; defaults to the palette's `fg`. */
    fg?: string;
    comment: string;
    keyword: string;
    /** String literals. */
    string: string;
    /** Numbers, booleans, and other constants. */
    constant: string;
    function: string;
    /** Parameters and other secondary identifiers. */
    parameter: string;
    punctuation: string;
    link: string;
}
/**
 * One variant of a theme: the colours an author actually chooses.
 *
 * Only the twelve required fields plus `code` need stating. Everything
 * optional has a derivation in `tokens.ts` that reads well for both modes;
 * set one explicitly when a palette has a canonical value for it (Nord's
 * `nord0` sidebar, Solarized's `base02` selection) rather than to fine-tune.
 */
export interface Palette {
    /** Application base background. */
    bg: string;
    /** Raised surfaces: cards, panels, the composer. */
    surface: string;
    /** Menus, popovers, and the settings panel's inner column. */
    overlay: string;
    /** Primary text. */
    fg: string;
    /** Secondary text — still comfortably readable. */
    muted: string;
    /** Tertiary text: captions, timestamps, placeholder chrome. */
    faint: string;
    /** Solid line colour; the four border alpha steps are derived from it. */
    border: string;
    /** Brand accent: primary buttons, active nav, focus. */
    accent: string;
    /** Informational accent (links, business state). Defaults to `accent`. */
    info?: string;
    error: string;
    success: string;
    warn: string;
    /** Sidebar column fill. Defaults to a slight step off `bg`. */
    sidebar?: string;
    /** Text drawn on top of `accent`. Defaults to whichever of fg/bg reads better. */
    accentFg?: string;
    /** Assistant message bubble fill. Defaults to a tint of `accent` / step off `surface`. */
    bubble?: string;
    /** Syntax highlighting. */
    code: CodePalette;
}
/** A selectable theme: an id, a label, and one palette per base mode. */
export interface ThemeSpec {
    /** Stable id; persisted, so renaming one resets anybody who had it selected. */
    id: string;
    /** Display name in the settings list. */
    label: string;
    /** One-line description shown under the label. */
    blurb: string;
    /**
     * Force the base colour scheme when this theme is picked.
     *
     * Omit it for the normal case — a theme with two honest variants lets the
     * user keep their light/dark/system choice, and `system` keeps following the
     * OS. Set it only for a theme that exists in one mode: the plugin then calls
     * `ctx.theme.setTheme('light' | 'dark')`, which is a BUILT-IN preference and
     * therefore durable, so `body[data-ds-dark-theme]`, the shiki base rules, and
     * any third-party CSS keyed on that attribute all land in the right mode.
     */
    pinScheme?: Mode;
    /** The two variants. A single-mode theme repeats one palette in both slots. */
    variants: Record<Mode, Palette>;
}
/**
 * One font choice, applied to the whole UI.
 *
 * Interface and code are a single axis: what people want is "use this face for
 * everything", and splitting them only multiplied the picker. Every entry but
 * the default is bundled with the plugin, which is what removes the silent
 * fall-through that makes an uninstalled face look like a broken setting.
 */
export interface FontSpec {
    id: string;
    label: string;
    blurb: string;
    /** Whether the face ships inside the bundle rather than relying on the OS. */
    bundled: boolean;
    /**
     * `--dsw-font-family`. Every composed typography token (`--dsw-font-base-16`
     * and ~200 siblings) is declared as `… var(--dsw-font-family)` on `body`, so
     * overriding this one name restyles the entire UI.
     */
    ui: string;
    /** `--ds-font-family-code`: code blocks, inline code, diffs. */
    code: string;
}
/** An accent override: recolours brand/primary without touching the palette. */
export interface AccentSpec {
    id: string;
    label: string;
    /** Accent for the light base palette. */
    light: string;
    /** Accent for the dark base palette. */
    dark: string;
}
