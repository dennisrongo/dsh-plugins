import type { ThemeSpec } from '../types.ts'

/** Tokyo Night for dark, Tokyo Night Day for light. */
export const tokyoNight: ThemeSpec = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  blurb: 'Neon-on-navy after dark; a cool overcast palette by day.',
  variants: {
    dark: {
      bg: '#1a1b26',
      surface: '#24283b',
      overlay: '#292e42',
      sidebar: '#16161e',
      fg: '#c0caf5',
      muted: '#a9b1d6',
      faint: '#787e9c',
      border: '#2f334d',
      accent: '#7aa2f7',
      info: '#7dcfff',
      error: '#f7768e',
      success: '#9ece6a',
      warn: '#e0af68',
      code: {
        bg: '#16161e',
        comment: '#6b7394',
        keyword: '#bb9af7',
        string: '#9ece6a',
        constant: '#ff9e64',
        function: '#7aa2f7',
        parameter: '#e0af68',
        punctuation: '#a9b1d6',
        link: '#7dcfff',
      },
    },
    light: {
      bg: '#e1e2e7',
      surface: '#e9e9ed',
      overlay: '#ffffff',
      sidebar: '#d5d6db',
      fg: '#343b58',
      muted: '#4c5470',
      faint: '#6a729b',
      border: '#c4c8da',
      accent: '#2e7de9',
      info: '#007197',
      error: '#f52a65',
      success: '#587539',
      warn: '#8c6c3e',
      code: {
        // Day's code fill is a mid grey, so its magenta and blue need a
        // shade more depth than the editor theme uses on white.
        bg: '#d5d6db',
        comment: '#6a729b',
        keyword: '#9552ec',
        string: '#587539',
        constant: '#b15c00',
        function: '#2b76db',
        parameter: '#8c6c3e',
        punctuation: '#343b58',
        link: '#007197',
      },
    },
  },
}
