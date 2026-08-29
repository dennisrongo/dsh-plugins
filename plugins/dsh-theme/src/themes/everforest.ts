import type { ThemeSpec } from '../types.ts'

/** Everforest, medium contrast in both directions. */
export const everforest: ThemeSpec = {
  id: 'everforest',
  label: 'Everforest',
  blurb: 'Forest greens and warm sand — easy on the eyes for long sessions.',
  variants: {
    dark: {
      bg: '#2d353b',
      surface: '#343f44',
      overlay: '#3d484d',
      sidebar: '#232a2e',
      fg: '#d3c6aa',
      muted: '#c2b596',
      faint: '#9da9a0',
      border: '#475258',
      accent: '#83c092',
      info: '#7fbbb3',
      error: '#e67e80',
      success: '#a7c080',
      warn: '#dbbc7f',
      code: {
        bg: '#232a2e',
        comment: '#859289',
        keyword: '#e67e80',
        string: '#a7c080',
        constant: '#d699b6',
        function: '#7fbbb3',
        parameter: '#dbbc7f',
        punctuation: '#d3c6aa',
        link: '#83c092',
      },
    },
    light: {
      bg: '#fdf6e3',
      surface: '#f4f0d9',
      overlay: '#fffbef',
      sidebar: '#f4f0d9',
      fg: '#5c6a72',
      // Everforest's own light greys sit at ~2.9:1 against the cream base,
      // under the 3:1 floor the contrast test enforces; these are the nearest
      // darker steps that clear it without leaving the palette's hue family.
      muted: '#5f6d74',
      faint: '#78876f',
      border: '#e6e2cc',
      accent: '#2e8f6a',
      info: '#3a94c5',
      error: '#f85552',
      success: '#8da101',
      warn: '#dfa000',
      code: {
        // Everforest's light syntax set is its lowest-contrast surface; each
        // hue is darkened to clear the 3:1 floor, none is re-hued.
        bg: '#f4f0d9',
        comment: '#78876f',
        keyword: '#ee524f',
        string: '#7f9101',
        constant: '#cd61ab',
        function: '#3991c1',
        parameter: '#b28000',
        punctuation: '#5c6a72',
        link: '#319a72',
      },
    },
  },
}
