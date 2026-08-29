import type { Selection } from './storage.ts';
import type { Mode, TokenPairs } from './types.ts';
/** What this plugin needs from `ctx.theme`; the full service is broader. */
export interface ThemeService {
    getTheme(): {
        preference: string;
        active: {
            colorScheme: Mode;
        };
    };
    setTheme(id: string): void;
    overrideTokens(source: string, tokens: TokenPairs): () => void;
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
export declare function applySelection(theme: ThemeService, selection: Selection): void;
/**
 * Retract every layer this plugin owns.
 * @param theme - the harness theme service.
 */
export declare function retractAll(theme: ThemeService): void;
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
export declare function schemeToRestore(pinned: Mode | undefined, current: string, enteredWith: string): string | undefined;
