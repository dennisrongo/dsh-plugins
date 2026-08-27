// Child for the cross-TZ fixture: prints formatter outputs for fixed epoch-ms
// fixtures as one JSON line. Loaded with the same stub-loader pattern smoke.mjs uses.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const registered = []
globalThis.window = { __ModuleLoader__: { load: (e) => registered.push(e) } }
const require = createRequire(import.meta.url)
await import(pathToFileURL(fileURLToPath(new URL('../lib/client.js', import.meta.url))).href)
const moduleTable = { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime') }
const exports_ = registered[0].factory((id) => moduleTable[id])

const NOW = 1_769_000_000_000
console.log(JSON.stringify({
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offset: new Date(NOW).getTimezoneOffset(),
  elapsed: [
    exports_.elapsedSince(NOW - 90_000, NOW),
    exports_.elapsedSince(NOW + 300_000, NOW),
    exports_.elapsedSince(1.7e9, NOW),
    exports_.elapsedSince(undefined, NOW),
  ],
  fmtMs: [exports_.fmtMs(90_000), exports_.fmtMs(265_000), exports_.fmtMs(-265_000), exports_.fmtMs(2_500)],
  fmtRelative: [
    exports_.fmtRelative(NOW - 30_000, NOW),
    exports_.fmtRelative(NOW - 12 * 60_000, NOW),
    exports_.fmtRelative(NOW - 3 * 3_600_000, NOW),
    exports_.fmtRelative(NOW - 2 * 86_400_000, NOW),
    // >7d falls into the month/day display fallback — must stay identical across TZ too
    exports_.fmtRelative(NOW - 30 * 86_400_000, NOW),
  ],
}))
