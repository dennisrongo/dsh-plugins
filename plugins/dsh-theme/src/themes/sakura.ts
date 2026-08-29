import type { ThemeSpec } from '../types.ts'

/**
 * Cherry blossom: petal pinks over a plum-tinted neutral. The light variant is
 * the daytime one; the dark is the same blossom at night, so the pinks lift
 * rather than deepen.
 */
export const sakura: ThemeSpec = {
  id: 'sakura',
  label: 'Sakura',
  blurb: 'Cherry blossom — petal pinks on a soft plum neutral.',
  variants: {
    light: {
      bg: '#fdf3f5',
      surface: '#ffffff',
      overlay: '#ffffff',
      sidebar: '#f9e8ed',
      fg: '#3d2831',
      muted: '#5c3f4b',
      faint: '#8a6675',
      border: '#f0d5de',
      accent: '#bf4d78',
      info: '#5a7a9e',
      error: '#b03040',
      success: '#4f7a52',
      warn: '#a3762f',
      code: {
        bg: '#f9e8ed',
        comment: '#8a6675',
        keyword: '#bf4d78',
        string: '#4f7a52',
        constant: '#8a5b2a',
        function: '#5a7a9e',
        parameter: '#a3762f',
        punctuation: '#3d2831',
        link: '#5a7a9e',
      },
    },
    dark: {
      bg: '#1e181c',
      surface: '#291f25',
      overlay: '#33272e',
      sidebar: '#181316',
      fg: '#f7e9ee',
      muted: '#e0c6d1',
      faint: '#a98b98',
      border: '#3d2f36',
      accent: '#f2a0bd',
      info: '#9ec1e0',
      error: '#ef7a8a',
      success: '#a3c9a0',
      warn: '#e8c07d',
      code: {
        bg: '#181316',
        comment: '#a98b98',
        keyword: '#f2a0bd',
        string: '#a3c9a0',
        constant: '#e8c07d',
        function: '#9ec1e0',
        parameter: '#e0a2c0',
        punctuation: '#e0c6d1',
        link: '#9ec1e0',
      },
    },
  },
}
