# dsh-weather

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-weather)](https://www.npmjs.com/package/@dennisrongo/dsh-weather)

**npm:** [`@dennisrongo/dsh-weather`](https://www.npmjs.com/package/@dennisrongo/dsh-weather) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-weather)

Weather bar for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web UI — current conditions, a short hourly outlook, humidity and wind, pinned across the top of the page.

- **Data:** [Open-Meteo](https://open-meteo.com) (free, no API key) via the browser.
- **Location:** `localStorage["dsh-weather:location"] = "Your City"` if set, else a coarse IP-geolocation provider chain, else New York.
- **Placement:** drag the pill anywhere. Until you move it, it stays centred on the space the shell has actually left it, not on the viewport — it measures the shell frame's content box (which already excludes `dsh-mission-control`'s docked rail) and subtracts any overlay flying a `data-dsh-overlay-claim="right"` marker, today `dsh-plan-board`'s plan panel. After a drag the spot is remembered (cookie `dsh-weather-pos`, with `localStorage["dsh-weather:pos"]` as a fallback) so it survives a web UI or DSH Desktop restart. Click the temperature to toggle units; that does not start a drag.
- **Mount point:** additive `shell.overlay` slot — pure-consumer client plugin, empty host half.
- **Units:** Fahrenheit by default — click the temperature to toggle °F/°C. The choice is remembered in `localStorage["dsh-weather:unit"]`.
- **Refresh:** every 15 min, plus a manual ⟳ button.

## Build

```sh
pnpm install
pnpm build
pnpm test
```

## Use in a dsh profile

```json
{ "dependencies": { "@dennisrongo/dsh-weather": "file:../dsh-weather" } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-weather
      name: '@dennisrongo/dsh-weather'
```

Restart the profile; the bar appears across the top of the web UI.
