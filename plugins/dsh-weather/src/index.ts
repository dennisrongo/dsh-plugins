/**
 * Host half of dsh-weather — deliberately empty.
 *
 * The weather bar is a pure-consumer client plugin: it fetches Open-Meteo
 * (no API key, CORS-enabled) straight from the browser and renders into
 * `shell.overlay`. No host services, no tools, no presets.
 */
export function apply() {}
