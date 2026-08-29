import type { ThemeSpec } from '../types.ts'

/** Ethan Schoonover's Solarized, both halves of the original pair. */
export const solarized: ThemeSpec = {
  id: 'solarized',
  label: 'Solarized',
  blurb: 'The classic low-contrast pair: teal-navy dark, warm paper light.',
  variants: {
    dark: {
      bg: '#002b36',
      surface: '#073642',
      overlay: '#0a4351',
      sidebar: '#00212b',
      fg: '#93a1a1',
      // base0 (#839496) is 4.1:1 on base02, just under AA for secondary text.
      // Solarized is low-contrast by design, so this is the smallest step off
      // the canonical value that still clears the floor.
      muted: '#8b9c9e',
      faint: '#6c8288',
      border: '#0f4a58',
      accent: '#268bd2',
      info: '#2aa198',
      error: '#dc322f',
      success: '#859900',
      warn: '#b58900',
      code: {
        bg: '#00212b',
        comment: '#6c8288',
        keyword: '#859900',
        string: '#2aa198',
        constant: '#d33682',
        function: '#268bd2',
        parameter: '#93a1a1',
        punctuation: '#93a1a1',
        link: '#6c71c4',
      },
    },
    light: {
      bg: '#fdf6e3',
      surface: '#fffbf0',
      overlay: '#ffffff',
      sidebar: '#f4ecd8',
      fg: '#586e75',
      // base00 (#657b83), likewise a step darker to clear AA on the paper base.
      muted: '#5f747c',
      faint: '#6b7b7b',
      border: '#e5dcc3',
      accent: '#268bd2',
      info: '#2aa198',
      error: '#dc322f',
      success: '#6c7a00',
      warn: '#a07600',
      code: {
        bg: '#f4ecd8',
        comment: '#7a8a8a',
        keyword: '#6c7a00',
        string: '#1f8074',
        constant: '#c0246e',
        function: '#1f6fb0',
        parameter: '#586e75',
        punctuation: '#586e75',
        link: '#5b60b0',
      },
    },
  },
}
