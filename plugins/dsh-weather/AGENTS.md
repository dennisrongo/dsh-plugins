# AGENTS.md — @dennisrongo/dsh-weather

Weather bar for DeepSeek Harness: current conditions, short hourly outlook, humidity and wind, pinned bottom-centre of the web UI.

**Client-only plugin — no host service, no `/api/` endpoints.** `src/index.ts` is a deliberately empty `apply()`. The whole plugin is `src/client.tsx`, which fetches Open-Meteo (no API key, CORS-enabled) straight from the browser and renders into dsh's additive `shell.overlay` slot. Keep that posture: it declares no `@deepseek-ai/*` dependencies and needs none at Node level. CSS classes are prefixed `dshwx-`; service access is per-fiber via `export const inject = ['slots']`.

Because there is no host half, **the identity check and wire probe the sibling packages document do not apply here** — `lib/index.js` imports nothing. Verify through the served bundle and rendered DOM instead.

Units: Open-Meteo is always fetched in Celsius and converted at render time by `fmtTemp(celsius, unit)`, so toggling needs no refetch. Keep stored readings unit-agnostic (`temperatureC`) and add new readouts through `fmtTemp`, never `Math.round(...) + '°C'`. The unit persists to `localStorage["dsh-weather:unit"]`, defaulting to `'F'`. Wind stays km/h.

## Mounting

**Self-mounting.** `package.json` declares `dsh.bundle.patch` pointing at this package's own
`cordis.patch.yml`, which carries the insert row:

```yaml
- insert:
    - id: dsh-weather
      name: '@dennisrongo/dsh-weather'
```

`dsh plugin add` appends the package to the profile's `dsh.profile.bundles` and that row composes
automatically. **Do not also add an `insert:` row to the profile's `cordis.patch.yml`** — a second
row with the same id is fatal: `duplicate loader entry id: dsh-weather`. A bare `id:` entry there is
still the right way to *configure* the row.

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-weather"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (esbuild dual build → `lib/index.js` + `lib/client.js`) and `pnpm test`. The test reads `lib/client.js`, so **build before testing** or it passes against a stale bundle.

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions — this plugin is client-only, so edits then deploy on **browser refresh** with no profile restart. **Re-run that script after any `pnpm install`**, including the one DSH Desktop runs during profile repair, because pnpm replaces junctions with copies.

The client half compiles to a CJS body wrapped in dsh's `window.__ModuleLoader__.load({ id, factory })` convention; `react`, `react-dom` and `@deepseek-ai/*` are external and come from the host loader's module table at runtime.

## Verification

```bash
# the bundle the browser actually receives — size should match the build's reported bytes
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  http://127.0.0.1:38111/plugins/@dennisrongo/dsh-weather/client.js
```

Then load the UI and confirm the bar renders: `dshwx-*` nodes present, location and temperature shown. Verify against the **server**, not the filesystem — dsh reads the plugin from disk per request, so a refreshed bundle needs only a browser refresh (`Ctrl+Shift+R` if bytes look stale).

## Gotchas

- esbuild escapes non-ASCII: `°` becomes `\xB0`, so grepping the bundle for a literal `°` is a false negative.
- The type-only `@deepseek-ai/dsh-client-runtime/client` import resolves through a `paths` mapping to `./node_modules/@deepseek-ai/...`, which only exists once `scripts/dev-link.ps1` has run. If `pnpm run typecheck` reports `TS2307: Cannot find module '@deepseek-ai/dsh-client-runtime/client'`, run that script — don't "fix" it with a local stub.
- A11y is deliberate (`aria-label` on the unit toggle, `aria-live="polite"`, styled `:focus-visible`, `prefers-reduced-motion` disabling the spinner). Preserve it, and keep clickable controls real `<button>`s.
- Location resolution is `localStorage["dsh-weather:location"]` → a geo provider chain → hard fallback New York. Network paths must degrade to `status: 'error'`, never throw into the shell.
