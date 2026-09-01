# AGENTS.md — @dennisrongo/dsh-weather

Weather bar for DeepSeek Harness: current conditions, short hourly outlook, humidity and wind. Unplaced, it auto-centres in the shell's remaining top band; after a drag it stays where it was put.

**Client-only plugin — no host service, no `/api/` endpoints.** `src/index.ts` is an empty `apply()` that re-exports position helpers so the suite can run them under Node. The bar itself is `src/client.tsx`, which fetches Open-Meteo (no API key, CORS-enabled) straight from the browser and renders into dsh's additive `shell.overlay` slot. Keep that posture: it declares no `@deepseek-ai/*` dependencies and needs none at Node level. CSS classes are prefixed `dshwx-`; service access is per-fiber via `export const inject = ['slots']`.

Because there is no host service, **the identity check and wire probe the sibling packages document do not apply here**. Verify through the served bundle and rendered DOM instead.

Units: Open-Meteo is always fetched in Celsius and converted at render time by `fmtTemp(celsius, unit)`, so toggling needs no refetch. Keep stored readings unit-agnostic (`temperatureC`) and add new readouts through `fmtTemp`, never `Math.round(...) + '°C'`. The unit persists to `localStorage["dsh-weather:unit"]`, defaulting to `'F'`. Wind stays km/h.

A parked position cannot live in `localStorage` alone. DSH Desktop serves the UI from a new ephemeral port every launch, and an origin includes the port, so localStorage is empty on each start. The position is a cookie (`dsh-weather-pos`, `Path=/; SameSite=Lax`) with `localStorage["dsh-weather:pos"]` as a fallback — same reason as `dsh-theme`. The payload is a `0..1,0..1` ratio of the movable range, not raw pixels, so a restart at a different window size keeps the relative spot. Buttons (`°F/°C`, refresh) do not start a drag.

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

`pnpm install` at the monorepo root, then `pnpm run build` here (esbuild dual build → `lib/index.js` + `lib/client.js`) and `pnpm test`.

**`pnpm test` rebuilds first** (`node build/build.mjs && node test/smoke.mjs && node test/position.mjs`), matching `dsh-git`. The smoke suite asserts marker strings against the **built** `lib/client.js`, so without that prefix it happily passes against a stale bundle — verified: deleting `dshwx-sep-where` from `src/` and not rebuilding left the suite green. That is the defect class that rotted `dsh-mission-control`'s markers unnoticed, and the build prefix makes it structurally impossible rather than a thing to remember. `test/position.mjs` imports the host bundle and checks the cookie payload and clamp math against literals. Running either file directly still skips the build, so prefer `pnpm test`.

Note the build invoked by `test` is `build.mjs` directly, NOT `pnpm run build` — so the `postbuild` deploy hook does **not** fire. That is deliberate: testing should not mutate a profile.

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
- The unplaced bar pins to `top: 8px` — inside DSH Desktop's 36px Windows window-drag strip, which the compositor resolves before hit-testing. **Opting out with no-drag does NOT work**: the preload already grants every `button` under `body.dsh-desktop-windows-titlebar-layout` a `no-drag !important`, and the bar was still unclickable — a covered element's no-drag doesn't punch a hole in an overlapping drag element (same failure dsh-mission-control hit on its stage bar). The working fix is positional: `body.dsh-desktop-windows-titlebar-layout .dshwx { top: 44px }` drops the pill clear of the strip (that body class exists only in the Windows desktop build, so the browser keeps `top: 8px`). A user-placed inline `top` overrides that rule; `clampPx`'s `minTop` (44 on that body class, else 8) is what stops a drag parking back inside the strip. The pill still carries `-webkit-app-region: no-drag` + `data-dsh-no-drag` as belt-and-braces; the smoke test pins all the markers.
- **The bar is not centred on the viewport — it is centred on what the shell has left.** `useBandFit` measures the shell frame's CONTENT box (which already excludes `dsh-mission-control`'s rail, since that rail reserves itself by padding the frame) and then subtracts any element marked `data-dsh-overlay-claim="right"` that shares the bar's rows and reaches the content edge. Today that claimant is `dsh-plan-board`'s plan dock. Measured before the change: with the rail open the bar ran from x=277 to x=1002 over a rail starting at 879, and with a plan docked it painted across the panel's Copy and Close buttons; after, it centres at the content box's midpoint and sheds tiers as the free span narrows.
- **The responsive tiers key off `data-fit`, not media queries, and that is load-bearing.** A viewport query calls a 2400px window "full" even when a docked panel has left the bar 300px, so the pill runs under the panel instead of shedding detail. The thresholds (720/520/380) are unchanged — they just measure the band. Re-adding a `@media (max-width: …)` shedding rule reintroduces the bug and fights the attribute rules on specificity; the smoke test asserts the old breakpoints are gone.
- **The band observer must ignore the bar's own mutations.** It watches the overlay layer's subtree for a claimant appearing, moving or leaving, and the bar's inline `left`/`max-width` writes are mutations in that subtree — measuring on them schedules the next write forever.
- **Measured in viewport px, written in author px.** `dsh-theme`'s UI scale is `#root { zoom: var(--dshth-ui-scale, 1) }` and this bar renders inside it, so `getBoundingClientRect()` reports TRUE viewport px while `style.left` is an AUTHOR px the zoom multiplies again. `useBandFit` resolves the factor via `zoomOf()` and divides on the way out; the frame's computed padding is author px too, so it is multiplied UP before being subtracted from a viewport rect. Mixing the two is exactly right at 100% and wrong by the zoom factor everywhere else — test at more than one scale.
- **No ResizeObserver reports a UI-scale change.** Verified in the shell across 1.0 → 0.8 → 1.0: `content-box` fired zero times and so did `device-pixel-content-box`. A CSS zoom rewrites the rendered result without resizing any observed box. dsh-theme sets the scale as an inline custom property on `<body>`, so a MutationObserver on that style attribute is the trigger that works.
