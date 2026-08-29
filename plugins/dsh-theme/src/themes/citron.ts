import type { ThemeSpec } from '../types.ts'

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
export const citron: ThemeSpec = {
  id: 'citron',
  label: 'Citron',
  blurb: 'Deep slate with a citron pop and coral warnings.',
  variants: {
    dark: {
      // Derived ground; `#2c4251` sits on top of it as the surface.
      bg: '#1e2e3a',
      surface: '#2c4251',
      overlay: '#3a5265',
      sidebar: '#182530',
      fg: '#ffffff',
      muted: '#c1c1c1',
      faint: '#8fa0ab',
      border: '#405a6b',
      accent: '#b6c649',
      error: '#d16666',
      success: '#b6c649',
      // No warm tone in the brief, so warn is the midpoint of citron and coral
      // rather than an imported amber — it stays inside the palette's family.
      warn: '#c39657',
      code: {
        bg: '#182530',
        comment: '#8794a0',
        keyword: '#b6c649',
        string: '#e08a8a',
        constant: '#d16666',
        function: '#a9c4d9',
        parameter: '#c1c1c1',
        punctuation: '#c1c1c1',
        link: '#b6c649',
      },
    },
    light: {
      bg: '#ffffff',
      surface: '#f6f7f8',
      overlay: '#ffffff',
      sidebar: '#eef0f2',
      fg: '#2c4251',
      muted: '#3d566a',
      faint: '#5f7789',
      border: '#c1c1c1',
      // Citron and coral are both too light to clear their floors on white, so
      // the light variant carries their darker siblings. The hues are the
      // brief's; the lightness is what white demands.
      accent: '#6f7d2b',
      error: '#b84a4a',
      success: '#6f7d2b',
      warn: '#94702a',
      code: {
        bg: '#f2f4f5',
        comment: '#647c8c',
        keyword: '#6f7d2b',
        string: '#a34848',
        constant: '#94702a',
        function: '#2c4251',
        parameter: '#3d566a',
        punctuation: '#3d566a',
        link: '#41627a',
      },
    },
  },
}
