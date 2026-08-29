import type { ThemeSpec } from '../types.ts';
/**
 * Slate and citron, from a five-colour brief: `#2c4251` slate, `#c1c1c1` grey,
 * `#d16666` coral, `#b6c649` citron, `#ffffff` white.
 *
 * Five colours cannot fill a palette on their own — there is no surface ladder,
 * no border step and no syntax set in them — so the given five hold the roles
 * that carry the theme's identity and everything else is derived from them.
 *
 * The one deliberate departure: `#2c4251` is the raised SURFACE rather than the
 * page, with a deeper slate derived beneath it. Used as the page, the given
 * coral lands at 2.8:1 against it — under the floor for a state colour — and
 * every other given colour loses headroom too. Dropping the ground a step keeps
 * all five exactly as specified and legible.
 */
export declare const citron: ThemeSpec;
