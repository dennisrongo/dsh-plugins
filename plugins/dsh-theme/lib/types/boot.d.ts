/**
 * The inline script body.
 *
 * Everything is wrapped in try/catch: this runs before the app exists, and a
 * theme preference is never worth breaking a page load over. The colour scheme
 * is read from the body attribute the harness's own bootstrap sets a row
 * earlier; if this somehow runs first, it falls back to the OS preference and
 * corrects itself at DOMContentLoaded.
 * @returns the script text.
 */
export declare function bootScript(): string;
/**
 * The bootstrap as an index-injection row: an inline script in the body, so it
 * runs before the shell mounts and before the module graph is fetched.
 * @returns the injection row.
 */
export declare function bootInjection(): {
    kind: 'script';
    placement: 'body';
    text: string;
};
