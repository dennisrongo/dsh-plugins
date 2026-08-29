/**
 * esbuild's `dataurl` loader turns a `.woff2` import into a `data:` URL string
 * at build time. TypeScript needs telling; see `build/build.mjs` for the loader.
 */
declare module '*.woff2' {
  const url: string
  export default url
}
