import type { ThemeSpec } from '../types.ts'

/**
 * Rosé Pine for dark, Rosé Pine Dawn for light.
 *
 * The upstream palette has no green, so `success` is an extension chosen to
 * sit beside pine and foam rather than a canonical role colour.
 */
export const rosePine: ThemeSpec = {
  id: 'rose-pine',
  label: 'Rosé Pine',
  blurb: 'Muted rose and iris over soho-vibes charcoal; Dawn in light.',
  variants: {
    dark: {
      bg: '#191724',
      surface: '#1f1d2e',
      overlay: '#26233a',
      sidebar: '#16141f',
      fg: '#e0def4',
      muted: '#908caa',
      faint: '#8b87a8',
      border: '#2a273f',
      accent: '#c4a7e7',
      info: '#9ccfd8',
      error: '#eb6f92',
      success: '#6cbf9b',
      warn: '#f6c177',
      code: {
        bg: '#16141f',
        comment: '#8b87a8',
        keyword: '#3e8fb0',
        string: '#f6c177',
        constant: '#ebbcba',
        function: '#c4a7e7',
        parameter: '#9ccfd8',
        punctuation: '#e0def4',
        link: '#9ccfd8',
      },
    },
    light: {
      bg: '#faf4ed',
      surface: '#fffaf3',
      overlay: '#ffffff',
      sidebar: '#f2e9e1',
      fg: '#575279',
      // Dawn's `subtle` (#797593) lands at 4.0:1 on the rose base — a step
      // under the 4.5 the test asks of secondary text.
      muted: '#6e6a86',
      faint: '#7d7891',
      border: '#dfd8ce',
      accent: '#907aa9',
      info: '#286983',
      error: '#b4637a',
      success: '#4a7d68',
      warn: '#b07d1a',
      code: {
        bg: '#f2e9e1',
        comment: '#7d7891',
        keyword: '#286983',
        string: '#4a7d68',
        constant: '#b07d1a',
        function: '#907aa9',
        parameter: '#b4637a',
        punctuation: '#575279',
        // Dawn's foam is a shade under 3:1 on the code fill.
        link: '#538e99',
      },
    },
  },
}
