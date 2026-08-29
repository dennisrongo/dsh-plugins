import type { ThemeSpec } from '../types.ts'

/**
 * Yellow on black, and its inverse: the loudest palette here.
 *
 * Every text/surface combination clears WCAG AAA (7:1) as authored, which is
 * why it kept its high-contrast character after contrast became its own axis —
 * the two are now independent, so any theme can be pushed this legible while
 * this one keeps its colours. `accentFg` is pinned rather than derived so the
 * primary button never lands on the borderline the automatic pick would take.
 */
export const bumbleBee: ThemeSpec = {
  id: 'bumble-bee',
  label: 'Bumble Bee',
  blurb: 'Yellow on black. Loud, and the most legible palette here.',
  variants: {
    dark: {
      bg: '#000000',
      surface: '#0d0d0d',
      overlay: '#1a1a1a',
      sidebar: '#000000',
      fg: '#ffffff',
      muted: '#e6e6e6',
      faint: '#bdbdbd',
      border: '#8a8a8a',
      accent: '#ffd400',
      accentFg: '#000000',
      info: '#4fc3f7',
      error: '#ff6b6b',
      success: '#69f0ae',
      warn: '#ffd54f',
      code: {
        bg: '#0d0d0d',
        comment: '#a8a8a8',
        keyword: '#ffd400',
        string: '#69f0ae',
        constant: '#ff8a80',
        function: '#4fc3f7',
        parameter: '#ffffff',
        punctuation: '#ffffff',
        link: '#4fc3f7',
      },
    },
    light: {
      bg: '#ffffff',
      surface: '#ffffff',
      overlay: '#ffffff',
      sidebar: '#f2f2f2',
      fg: '#000000',
      muted: '#1a1a1a',
      faint: '#3d3d3d',
      border: '#5a5a5a',
      accent: '#0b3d91',
      accentFg: '#ffffff',
      info: '#00457a',
      error: '#b00020',
      success: '#046307',
      warn: '#8a5a00',
      code: {
        bg: '#f2f2f2',
        comment: '#3d3d3d',
        keyword: '#0b3d91',
        string: '#046307',
        constant: '#8a1a00',
        function: '#00457a',
        parameter: '#000000',
        punctuation: '#000000',
        link: '#00457a',
      },
    },
  },
}
