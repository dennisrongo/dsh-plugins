import type { ThemeSpec } from '../types.ts';
/**
 * Yellow on black, and its inverse: the loudest palette here.
 *
 * Every text/surface combination clears WCAG AAA (7:1) as authored, which is
 * why it kept its high-contrast character after contrast became its own axis —
 * the two are now independent, so any theme can be pushed this legible while
 * this one keeps its colours. `accentFg` is pinned rather than derived so the
 * primary button never lands on the borderline the automatic pick would take.
 */
export declare const bumbleBee: ThemeSpec;
