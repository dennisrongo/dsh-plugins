/**
 * The bundled faces, inlined as data URLs at build time.
 *
 * The harness serves exactly `/plugins/<pkg>/client.js` and its source map —
 * there is no route for a `.woff2` — so a font that ships with this plugin has
 * to travel inside the bundle. esbuild's `dataurl` loader does that at build
 * time (see `build/build.mjs`), which keeps the font binaries out of the repo
 * and pins them to a lockfile-resolved package instead.
 *
 * Only OFL-1.1 faces are bundled, because bundling is redistribution. Berkeley
 * Mono is deliberately absent: it is a paid licence, and shipping it inside an
 * MIT npm package is not ours to do. It stays a stack you can pin if you own
 * the font.
 *
 * Latin subsets only, at 400/500/700. dsh's typography ladder uses 400 for body
 * and 500 for its "strong" steps, and markdown headings ask for 600–700, which
 * the browser resolves to 700. Shipping the other subsets (cyrillic, greek,
 * vietnamese) would roughly triple the payload for glyphs this UI does not
 * reach for.
 */
import geistMono400 from '@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2'
import geistMono500 from '@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2'
import geistMono700 from '@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2'
import jetbrainsMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'
import jetbrainsMono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2'
import jetbrainsMono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2'

/** One `@font-face` block. */
function face(family: string, weight: number, url: string): string {
  // `swap` rather than the default `block`: the face is a data URL so it is
  // already parsed by the time anything paints, but swap means a future switch
  // to a fetched URL degrades to the fallback stack instead of invisible text.
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format('woff2')}`
}

/** Every bundled face, as CSS. Injected with the plugin's own stylesheet. */
export const FONT_FACES = [
  face('Geist Mono', 400, geistMono400),
  face('Geist Mono', 500, geistMono500),
  face('Geist Mono', 700, geistMono700),
  face('JetBrains Mono', 400, jetbrainsMono400),
  face('JetBrains Mono', 500, jetbrainsMono500),
  face('JetBrains Mono', 700, jetbrainsMono700),
].join('\n')
