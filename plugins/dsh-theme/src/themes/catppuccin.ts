import type { ThemeSpec } from '../types.ts'

/** Catppuccin Mocha for dark, Latte for light. */
export const catppuccin: ThemeSpec = {
  id: 'catppuccin',
  label: 'Catppuccin',
  blurb: 'Soft pastels on deep plum — Mocha dark, Latte light.',
  variants: {
    dark: {
      bg: '#1e1e2e',
      surface: '#313244',
      overlay: '#45475a',
      sidebar: '#181825',
      fg: '#cdd6f4',
      muted: '#bac2de',
      faint: '#9399b2',
      border: '#45475a',
      accent: '#cba6f7',
      info: '#89b4fa',
      error: '#f38ba8',
      success: '#a6e3a1',
      warn: '#f9e2af',
      code: {
        bg: '#181825',
        comment: '#7f849c',
        keyword: '#cba6f7',
        string: '#a6e3a1',
        constant: '#fab387',
        function: '#89b4fa',
        parameter: '#f5c2e7',
        punctuation: '#bac2de',
        link: '#94e2d5',
      },
    },
    light: {
      bg: '#eff1f5',
      surface: '#ffffff',
      overlay: '#ffffff',
      sidebar: '#e6e9ef',
      fg: '#4c4f69',
      muted: '#5c5f77',
      faint: '#7c7f93',
      border: '#ccd0da',
      accent: '#8839ef',
      info: '#1e66f5',
      error: '#d20f39',
      success: '#40a02b',
      warn: '#df8e1d',
      code: {
        // Latte's greens, peaches and pinks sit at 2.2–2.8:1 on its own
        // mantle. Darkened just far enough to clear the 3:1 the contrast test
        // holds syntax to; the hues are unchanged.
        bg: '#e6e9ef',
        comment: '#7c7f93',
        keyword: '#8839ef',
        string: '#3c9628',
        constant: '#e0580a',
        function: '#1e66f5',
        parameter: '#c061a6',
        punctuation: '#5c5f77',
        link: '#179299',
      },
    },
  },
}
