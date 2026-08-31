window.__ModuleLoader__.load({
	id: "@dennisrongo/dsh-weather",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  describeCode: () => describeCode,
  fmtHour: () => fmtHour,
  fmtTemp: () => fmtTemp,
  inject: () => inject,
  toF: () => toF
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots"];
function describeCode(code, isDay = true) {
  const d = isDay;
  if (code === 0) return { icon: d ? "\u2600\uFE0F" : "\u{1F319}", label: "Clear" };
  if (code === 1) return { icon: d ? "\u{1F324}\uFE0F" : "\u{1F319}", label: "Mostly clear" };
  if (code === 2) return { icon: "\u26C5", label: "Partly cloudy" };
  if (code === 3) return { icon: "\u2601\uFE0F", label: "Overcast" };
  if (code === 45 || code === 48) return { icon: "\u{1F32B}\uFE0F", label: "Fog" };
  if (code >= 51 && code <= 55) return { icon: "\u{1F326}\uFE0F", label: "Drizzle" };
  if (code >= 56 && code <= 57) return { icon: "\u{1F327}\uFE0F", label: "Freezing drizzle" };
  if (code >= 61 && code <= 65) return { icon: "\u{1F327}\uFE0F", label: "Rain" };
  if (code >= 66 && code <= 67) return { icon: "\u{1F327}\uFE0F", label: "Freezing rain" };
  if (code >= 71 && code <= 77) return { icon: "\u{1F328}\uFE0F", label: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "\u{1F326}\uFE0F", label: "Showers" };
  if (code >= 85 && code <= 86) return { icon: "\u{1F328}\uFE0F", label: "Snow showers" };
  if (code === 95) return { icon: "\u26C8\uFE0F", label: "Thunderstorm" };
  if (code >= 96 && code <= 99) return { icon: "\u26C8\uFE0F", label: "Thunderstorm + hail" };
  return { icon: "\u{1F321}\uFE0F", label: `Code ${code}` };
}
function fmtHour(iso) {
  const h = Number(iso.slice(11, 13));
  if (Number.isNaN(h)) return iso;
  const suffix = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}
function toF(celsius) {
  return celsius * 9 / 5 + 32;
}
function fmtTemp(celsius, unit, withUnit = true) {
  const value = Math.round(unit === "F" ? toF(celsius) : celsius);
  return withUnit ? `${value}\xB0${unit}` : `${value}\xB0`;
}
var REFRESH_MS = 15 * 60 * 1e3;
var LOCATION_KEY = "dsh-weather:location";
var UNIT_KEY = "dsh-weather:unit";
function loadUnit() {
  try {
    return window.localStorage.getItem(UNIT_KEY) === "C" ? "C" : "F";
  } catch {
    return "F";
  }
}
function saveUnit(unit) {
  try {
    window.localStorage.setItem(UNIT_KEY, unit);
  } catch {
  }
}
var DEFAULT_LOCATION = { latitude: 40.7128, longitude: -74.006, label: "New York" };
var GEO_TIMEOUT_MS = 4e3;
var GEO_PROVIDERS = [
  {
    url: "https://get.geojs.io/v1/ip/geo.json",
    parse: (d) => {
      const latitude = Number(d?.latitude);
      const longitude = Number(d?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const region = d?.region ?? d?.country_code ?? "";
      return { latitude, longitude, label: d?.city ? `${d.city}, ${region}`.replace(/, $/, "") : "Current location" };
    }
  },
  {
    url: "https://freeipapi.com/api/json",
    parse: (d) => {
      const latitude = Number(d?.latitude);
      const longitude = Number(d?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const region = d?.regionName ?? d?.countryCode ?? "";
      return { latitude, longitude, label: d?.cityName ? `${d.cityName}, ${region}`.replace(/, $/, "") : "Current location" };
    }
  }
];
async function fetchJson(url, timeoutMs = GEO_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}
async function resolveLocation() {
  const override = window.localStorage.getItem(LOCATION_KEY);
  if (override) {
    const q = encodeURIComponent(override);
    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`
    );
    const hit = data?.results?.[0];
    if (hit) {
      return {
        latitude: hit.latitude,
        longitude: hit.longitude,
        label: hit.admin1 ? `${hit.name}, ${hit.admin1}` : String(hit.name)
      };
    }
    throw new Error(`unknown place "${override}"`);
  }
  for (const provider of GEO_PROVIDERS) {
    try {
      const hit = provider.parse(await fetchJson(provider.url));
      if (hit) return hit;
    } catch {
    }
  }
  return DEFAULT_LOCATION;
}
async function fetchWeather() {
  const geo = await resolveLocation();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&forecast_days=2&wind_speed_unit=kmh&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const data = await res.json();
  const c = data.current;
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const codes = data.hourly?.weather_code ?? [];
  const nowMs = Date.now();
  const next = [];
  for (let i = 0; i < times.length && next.length < 6; i++) {
    const at = Date.parse(times[i]);
    if (Number.isNaN(at) || at < nowMs - 30 * 60 * 1e3) continue;
    if (at === next[next.length - 1]?.at) continue;
    next.push({ at, temperatureC: temps[i], weatherCode: codes[i] });
  }
  return {
    status: "ready",
    where: geo.label,
    now: {
      temperatureC: c.temperature_2m,
      apparentC: c.apparent_temperature,
      weatherCode: c.weather_code,
      isDay: c.is_day === 1,
      windKph: c.wind_speed_10m,
      humidity: c.relative_humidity_2m
    },
    next: next.filter((_, i) => i % 2 === 0).slice(0, 4),
    fetchedAt: nowMs
  };
}
var BAR_STYLES = `
.dshwx {
  position: fixed;
  /* Centred on the viewport only until the bar has measured the shell (see
     useBandFit): the real centre is the middle of the span no docked overlay
     has claimed, written inline. */
  left: 50%;
  transform: translateX(-50%);
  top: 8px;
  z-index: 2147482900;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  background: var(--dsw-specific-sidebar-fill, #1b1b1c);
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  font: 400 13px/1.4 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.12));
  cursor: default;
  user-select: none;
  white-space: nowrap;
  /* DSH Desktop on Windows overlays a 36px window-drag strip at the top of the
     viewport (#dsh-desktop-windows-drag-region: -webkit-app-region: drag,
     z-index 2147483644, pointer-events: none) that the compositor resolves
     BEFORE hit-testing. no-drag here is belt-and-braces only \u2014 the desktop
     preload already grants every button no-drag !important and the bar was
     still unclickable, so a covered element's no-drag does not punch a hole
     in an overlapping drag element (the same failure dsh-mission-control
     documented for its stage bar). The real fix is the layout rule below,
     which drops the bar clear of the strip. In a plain browser all of this
     is inert. */
  -webkit-app-region: no-drag;
}
body.dsh-desktop-windows-titlebar-layout .dshwx {
  /* Clear the desktop drag strip: 36px strip + the usual 8px gap. The body
     class is added by DSH Desktop's preload on Windows only, so the browser
     and non-Windows builds keep top: 8px. */
  top: 44px;
}
body[data-ds-dark-theme] .dshwx { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.5); }
.dshwx[hidden] { display: none; }
.dshwx-icon { font-size: 16px; }
.dshwx-temp {
  color: var(--dsw-alias-label-primary, #f9fafb);
  font-weight: 600; font-size: 14px;
  font-family: inherit; font-variant-numeric: tabular-nums;
  border: 0; background: transparent; padding: 1px 4px; margin: 0 -2px;
  border-radius: 6px; cursor: pointer; line-height: inherit;
}
.dshwx-temp:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); }
.dshwx-temp:focus-visible { outline: 2px solid var(--dsw-alias-label-caption, #81858c); outline-offset: 1px; }
.dshwx-label { color: var(--dsw-alias-label-secondary, #cfd3d6); }
/* The bar is a ~200px pill in the shell's top band \u2014 a small surface, so the
   loading state stays TEXT rather than becoming a skeleton, which would be
   heavier than the string it replaced. It takes the dim caption tone the other
   plugins use for the same rung; a MODIFIER rather than a change to
   .dshwx-label, which is shared with the loaded condition text and must keep
   its secondary weight. */
.dshwx-label.loading { color: var(--dsw-alias-label-tertiary, #adb2b8); }
.dshwx-where {
  color: var(--dsw-alias-label-tertiary, #adb2b8);
  max-width: 160px; overflow: hidden; text-overflow: ellipsis;
}
.dshwx-sep { width: 1px; height: 14px; background: var(--dsw-alias-border-l2, rgba(255,255,255,0.12)); flex: none; }
.dshwx-meta { color: var(--dsw-alias-label-caption, #81858c); font-size: 12px; }
.dshwx-hours { display: flex; gap: 8px; align-items: center; }
.dshwx-hour { display: flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-caption, #81858c); font-size: 12px; }
.dshwx-hour b { color: var(--dsw-alias-label-secondary, #cfd3d6); font-weight: 500; }
.dshwx-refresh {
  border: 0; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-caption, #81858c);
  font-size: 14px; padding: 2px; border-radius: 50%;
  display: grid; place-items: center;
}
.dshwx-refresh:hover { color: var(--dsw-alias-label-primary, #f9fafb); background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); }
.dshwx-refresh.busy { animation: dshwx-spin 0.9s linear infinite; }
@keyframes dshwx-spin { to { transform: rotate(360deg); } }
.dshwx-error { color: var(--dsw-alias-state-error-primary, #ef4444); font-size: 12px; }
/* --- Responsive tiers ---------------------------------------------------
   The bar is a single nowrap pill, so it sheds detail rather than wrap. Each
   tier also drops the separator that preceded the hidden group, otherwise
   stray dividers float with nothing between them.

   Keyed on the MEASURED band (data-fit), not on a viewport media query. The
   space this bar actually gets is the shell's content box minus whatever a
   docked overlay has claimed, so a 2400px window with a plan panel open can
   leave the bar less room than a phone \u2014 a media query would call that "full"
   and let the pill run under the panel. The measurement falls back to the
   viewport when there is no shell frame, so the tiers still work standalone. */

/* Tablet: drop the hourly outlook and the humidity/wind readout. */
.dshwx[data-fit="tablet"] .dshwx-hours,
.dshwx[data-fit="tablet"] .dshwx-meta,
.dshwx[data-fit="tablet"] .dshwx-sep-hours,
.dshwx[data-fit="tablet"] .dshwx-sep-meta,
.dshwx[data-fit="phone"] .dshwx-hours,
.dshwx[data-fit="phone"] .dshwx-meta,
.dshwx[data-fit="phone"] .dshwx-sep-hours,
.dshwx[data-fit="phone"] .dshwx-sep-meta,
.dshwx[data-fit="tiny"] .dshwx-hours,
.dshwx[data-fit="tiny"] .dshwx-meta,
.dshwx[data-fit="tiny"] .dshwx-sep-hours,
.dshwx[data-fit="tiny"] .dshwx-sep-meta { display: none; }

/* Phone: tighten spacing, shrink the place name, and give the controls
   touch-sized hit areas without changing the pill's visual weight. */
.dshwx[data-fit="phone"],
.dshwx[data-fit="tiny"] {
  gap: 7px;
  padding: 4px 10px;
  font-size: 12px;
}
.dshwx[data-fit="phone"] .dshwx-where,
.dshwx[data-fit="tiny"] .dshwx-where { max-width: 92px; }
.dshwx[data-fit="phone"] .dshwx-icon,
.dshwx[data-fit="tiny"] .dshwx-icon { font-size: 14px; }
.dshwx[data-fit="phone"] .dshwx-temp,
.dshwx[data-fit="tiny"] .dshwx-temp { font-size: 13px; padding: 5px 7px; margin: -4px -3px; }
.dshwx[data-fit="phone"] .dshwx-refresh,
.dshwx[data-fit="tiny"] .dshwx-refresh { padding: 7px; margin: -5px; }

/* Very narrow: the place name is the least load-bearing text \u2014 the icon,
   temperature and condition carry the meaning. */
.dshwx[data-fit="tiny"] .dshwx-where,
.dshwx[data-fit="tiny"] .dshwx-sep-where { display: none; }
.dshwx[data-fit="tiny"] { gap: 6px; }

/* Nowhere left to stand. Better absent for the moment a full-width overlay is
   up than a clipped stub sliding under it.

   visibility, NOT display. A display:none bar has no box, so
   getBoundingClientRect reports zero height, the band measurement has no rows
   to test claimants against and bails \u2014 and the bar would stay hidden forever
   after the overlay that squeezed it went away. A hidden box is still a box. */
.dshwx[data-fit="none"] { visibility: hidden; pointer-events: none; }

/* Coarse pointers (touch) get the larger hit areas at any width. */
@media (pointer: coarse) {
  .dshwx-temp { padding: 6px 8px; margin: -4px -4px; }
  .dshwx-refresh { padding: 8px; margin: -6px; }
}

@media (prefers-reduced-motion: reduce) {
  .dshwx-refresh.busy { animation: none; }
}
`;
var stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dennisrongo/dsh-weather";
  tag.textContent = BAR_STYLES;
  document.head.appendChild(tag);
}
var CLAIM_SELECTOR = '[data-dsh-overlay-claim="right"]';
var BAND_GUTTER = 16;
function zoomOf(el) {
  const own = el.currentCSSZoom;
  if (typeof own === "number" && own > 0) return own;
  const width = el.getBoundingClientRect().width;
  return el.offsetWidth > 0 && width > 0 ? width / el.offsetWidth : 1;
}
function tierOf(width) {
  if (width === void 0) return "full";
  if (width < 200) return "none";
  if (width <= 380) return "tiny";
  if (width <= 520) return "phone";
  if (width <= 720) return "tablet";
  return "full";
}
function measureBand(band) {
  const layer = document.querySelector("[data-shell-overlay]");
  const frame = layer?.parentElement ?? null;
  let left = 0;
  let right = window.innerWidth;
  if (frame !== null) {
    const rect = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const zoom = zoomOf(frame);
    left = rect.left + (parseFloat(style.paddingLeft) || 0) * zoom;
    right = rect.right - (parseFloat(style.paddingRight) || 0) * zoom;
  }
  for (const claim of Array.from(document.querySelectorAll(CLAIM_SELECTOR))) {
    const rect = claim.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom <= band.top || rect.top >= band.bottom) continue;
    if (rect.right < right - 1) continue;
    right = Math.min(right, rect.left);
  }
  return {
    centre: left + (right - left) / 2,
    width: right - left - BAND_GUTTER * 2,
    zoom: frame === null ? 1 : zoomOf(frame)
  };
}
function useBandFit(ref) {
  const [fit, setFit] = import_react.default.useState(null);
  import_react.default.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const self = el.getBoundingClientRect();
      if (self.height === 0) return;
      const next = measureBand({ top: self.top, bottom: self.bottom });
      setFit(
        (prev) => prev !== null && Math.abs(prev.centre - next.centre) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && prev.zoom === next.zoom ? prev : next
      );
    };
    measure();
    const layer = document.querySelector("[data-shell-overlay]");
    const frame = layer?.parentElement ?? null;
    const resize = new ResizeObserver(measure);
    if (frame !== null) resize.observe(frame);
    if (layer !== null) resize.observe(layer);
    const scaleWatch = new MutationObserver(measure);
    scaleWatch.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    const mutation = new MutationObserver((records) => {
      if (records.every((record) => el.contains(record.target))) return;
      measure();
    });
    if (layer !== null) {
      mutation.observe(layer, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style", "data-dsh-overlay-claim", "hidden"]
      });
    }
    if (frame !== null) mutation.observe(frame, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", measure);
    return () => {
      resize.disconnect();
      scaleWatch.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return fit;
}
function WeatherBar() {
  const [state, setState] = import_react.default.useState({ status: "loading" });
  const [busy, setBusy] = import_react.default.useState(false);
  const [unit, setUnit] = import_react.default.useState(loadUnit);
  const ref = import_react.default.useRef(null);
  const fit = useBandFit(ref);
  const shell = {
    ref,
    className: "dshwx",
    "data-fit": tierOf(fit?.width),
    // A non-positive width is the squeezed-out case: the `none` tier hides the
    // bar, and writing a negative max-width would be an ignored declaration
    // that left it at full size behind the overlay.
    //
    // Both lengths are divided by the zoom: `fit` is measured in viewport px
    // and these are author px the zoom scales again (see zoomOf).
    ...fit === null || fit.width <= 0 ? {} : {
      style: {
        left: `${fit.centre / fit.zoom}px`,
        maxWidth: `${fit.width / fit.zoom}px`
      }
    }
  };
  const toggleUnit = () => {
    setUnit((prev) => {
      const next = prev === "C" ? "F" : "C";
      saveUnit(next);
      return next;
    });
  };
  import_react.default.useEffect(() => injectStyles(), []);
  import_react.default.useEffect(() => {
    let alive = true;
    const load = async () => {
      setBusy(true);
      try {
        const next = await fetchWeather();
        if (alive) setState(next);
      } catch (e) {
        if (alive) setState({ status: "error", error: String(e?.message ?? e) });
      } finally {
        if (alive) setBusy(false);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const reload = () => {
    setBusy(true);
    fetchWeather().then(setState).catch((e) => setState({ status: "error", error: String(e?.message ?? e) })).finally(() => setBusy(false));
  };
  if (state.status === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ...shell, role: "status", "aria-live": "polite", "aria-busy": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-icon", "aria-hidden": "true", children: "\u{1F321}\uFE0F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-label loading", children: "Loading weather\u2026" })
    ] });
  }
  if (state.status === "error" || !state.now) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ...shell, "aria-live": "polite", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-icon", children: "\u26A0\uFE0F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-error", title: state.error, children: "Weather unavailable" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: `dshwx-refresh${busy ? " busy" : ""}`, "data-dsh-no-drag": "", title: "Retry", onClick: reload, children: "\u27F3" })
    ] });
  }
  const { icon, label } = describeCode(state.now.weatherCode, state.now.isDay);
  const other = unit === "C" ? "F" : "C";
  const title = `${label} in ${state.where ?? ""} \u2014 feels like ${fmtTemp(state.now.apparentC, unit)}, humidity ${state.now.humidity}%, wind ${Math.round(state.now.windKph)} km/h \xB7 click the temperature for \xB0${other}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ...shell, title, "aria-live": "polite", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-icon", children: icon }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "dshwx-temp",
        "data-dsh-no-drag": "",
        onClick: toggleUnit,
        title: `Switch to \xB0${other}`,
        "aria-label": `Temperature ${fmtTemp(state.now.temperatureC, unit)}. Switch to degrees ${other === "F" ? "Fahrenheit" : "Celsius"}.`,
        children: fmtTemp(state.now.temperatureC, unit)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-label", children: label }),
    state.where ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-sep dshwx-sep-where" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-where", children: state.where })
    ] }) : null,
    state.next && state.next.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-sep dshwx-sep-hours" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-hours", children: state.next.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshwx-hour", children: [
        new Date(h.at).getHours() % 12 || 12,
        new Date(h.at).getHours() >= 12 ? "pm" : "am",
        " ",
        describeCode(h.weatherCode).icon,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: fmtTemp(h.temperatureC, unit, false) })
      ] }, h.at)) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshwx-sep dshwx-sep-meta" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshwx-meta", children: [
      "\u{1F4A7}",
      state.now.humidity,
      "% \u{1F32C}\uFE0F",
      Math.round(state.now.windKph),
      "km/h"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: `dshwx-refresh${busy ? " busy" : ""}`, "data-dsh-no-drag": "", title: "Refresh weather", onClick: reload, children: "\u27F3" })
  ] });
}
function apply(ctx) {
  ctx.effect(
    () => ctx.slots.inject(
      "shell.overlay",
      () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-weather" },
        () => import_react.default.createElement(WeatherBar)
      )
    ),
    "dsh-weather: shell.overlay registration"
  );
}

		return module.exports;
	}
});