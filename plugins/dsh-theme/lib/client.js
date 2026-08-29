window.__ModuleLoader__.load({
	id: "@dennisrongo/dsh-theme",
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
  inject: () => inject,
  nextOption: () => nextOption
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// src/color.ts
var HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
var HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
var HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
var HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
function parse(input) {
  const hex = input.trim();
  const short = HEX3.exec(hex) ?? HEX4.exec(hex);
  if (short !== null) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
      a: short[4] === void 0 ? 1 : Number.parseInt(short[4] + short[4], 16) / 255
    };
  }
  const long = HEX6.exec(hex) ?? HEX8.exec(hex);
  if (long !== null) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
      a: long[4] === void 0 ? 1 : Number.parseInt(long[4], 16) / 255
    };
  }
  throw new TypeError(`dsh-theme: "${input}" is not a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa)`);
}
var clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
var hex2 = (n) => clamp255(n).toString(16).padStart(2, "0");
function css(c) {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.round(c.a * 1e3) / 1e3})`;
}
function mix(from, to, amount) {
  const a = parse(from);
  const b = parse(to);
  const t = Math.max(0, Math.min(1, amount));
  return css({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t
  });
}
function alpha(input, value) {
  const c = parse(input);
  return css({ ...c, a: Math.max(0, Math.min(1, value)) });
}
function channel(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(input) {
  const c = parse(input);
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
function legibleFill(accent, background, onFill = "#ffffff", target = 3) {
  const amounts = [0];
  for (let step = 0.02; step <= 0.8; step += 0.02) amounts.push(step, -step);
  let best = accent;
  let bestScore = -Infinity;
  for (const amount of amounts) {
    const candidate = amount === 0 ? accent : amount > 0 ? mix(accent, "#000000", amount) : mix(accent, "#ffffff", -amount);
    const glyph = contrast(candidate, onFill);
    const edge = contrast(candidate, background);
    if (glyph >= target && edge >= target) return candidate;
    const score = Math.min(glyph, target) + Math.min(edge, target);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
function legibleTint(base, hue, text, target = 4.5, max = 0.22) {
  for (let amount = max; amount > 5e-3; amount -= 0.02) {
    const candidate = mix(base, hue, amount);
    if (contrast(text, candidate) >= target) return candidate;
  }
  return base;
}
function readable(background, ...candidates) {
  let best = candidates[0];
  let bestRatio = contrast(background, best);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrast(background, candidate);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

// src/accents.ts
var ACCENTS = [
  { id: "blue", label: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { id: "violet", label: "Violet", light: "#7c3aed", dark: "#a78bfa" },
  { id: "magenta", label: "Magenta", light: "#be185d", dark: "#f472b6" },
  { id: "red", label: "Red", light: "#dc2626", dark: "#f87171" },
  { id: "amber", label: "Amber", light: "#b45309", dark: "#fbbf24" },
  { id: "green", label: "Green", light: "#15803d", dark: "#4ade80" },
  { id: "teal", label: "Teal", light: "#0f766e", dark: "#2dd4bf" },
  { id: "graphite", label: "Graphite", light: "#3f3f46", dark: "#d4d4d8" }
];
var DEFAULT_ACCENT = "theme";
var DEFAULT_ACCENT_LABEL = "Theme default";
function findAccent(id) {
  return ACCENTS.find((entry) => entry.id === id);
}
function accentPairs(accent) {
  const build = (hue, surface, text) => {
    const fill = legibleFill(hue, surface);
    return {
      "--dsw-alias-brand-primary": hue,
      "--dsw-alias-brand-primary-new-colorprimary-new-color": hue,
      "--dsw-alias-button-primary-hover": mix(hue, text, 0.18),
      "--dsw-alias-button-primary-dimmed": mix(hue, surface, 0.72),
      "--dsw-alias-label-primary-foreground": readable(hue, surface, text, "#ffffff", "#000000"),
      "--dsw-alias-button-info-fill": fill,
      "--dsw-alias-button-info-hover": mix(fill, text, 0.18),
      "--dsw-specific-bubble-highlight": mix(surface, hue, 0.3),
      "--dsw-specific-sidebar-nav-item-active-accent": mix(surface, hue, 0.3),
      "--dsw-specific-sidebar-nav-item-active": legibleTint(surface, hue, text),
      // Same reach as the theme layer: model labels, chips, mission-control's
      // tags and pulse, and the two ramp slots the transcript reads directly.
      "--dsw-alias-state-business-primary": hue,
      "--dsw-alias-state-business-tertiary": mix(hue, surface, 0.78),
      "--dsw-alias-interactive-bg-hover-accent": mix(surface, hue, 0.22),
      "--dsw-static-blue-500": hue,
      "--dsw-static-blue-450": hue,
      "--dsw-static-deepseek-500": hue,
      "--dsw-static-deepseek-200": mix(hue, surface, 0.7)
    };
  };
  const light = build(accent.light, "#ffffff", "#000000");
  const dark = build(accent.dark, "#1b1b1c", "#f9fafb");
  const pairs = {};
  for (const name of Object.keys(light)) {
    pairs[name] = { light: light[name], dark: dark[name] };
  }
  return pairs;
}

// src/contrast.ts
var CONTRAST_LEVELS = [
  { id: "regular", label: "Regular", amount: 0 },
  { id: "more", label: "More", amount: 0.28 },
  { id: "high", label: "High", amount: 0.55 },
  { id: "higher", label: "Higher", amount: 0.78 },
  { id: "max", label: "Maximum", amount: 1 }
];
var DEFAULT_CONTRAST = "regular";
function findContrast(id) {
  return CONTRAST_LEVELS.find((level) => level.id === id);
}
function withContrast(palette, mode, amount) {
  if (amount <= 0) return palette;
  const dark = mode === "dark";
  const deep = dark ? "#000000" : "#ffffff";
  const far = dark ? "#ffffff" : "#000000";
  const adjusted = {
    ...palette,
    bg: mix(palette.bg, deep, amount * 0.7),
    surface: mix(palette.surface, deep, amount * 0.45),
    overlay: mix(palette.overlay, deep, amount * 0.3),
    fg: mix(palette.fg, far, amount * 0.9),
    muted: mix(palette.muted, far, amount * 0.75),
    faint: mix(palette.faint, far, amount * 0.6),
    border: mix(palette.border, far, amount * 0.5),
    code: { ...palette.code, bg: mix(palette.code.bg, deep, amount * 0.7) }
  };
  if (palette.sidebar !== void 0) adjusted.sidebar = mix(palette.sidebar, deep, amount * 0.7);
  if (palette.bubble !== void 0) adjusted.bubble = mix(palette.bubble, deep, amount * 0.4);
  return adjusted;
}

// src/detect.ts
var GENERIC = /* @__PURE__ */ new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong"
]);
function familiesOf(stack) {
  return stack.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "").trim()).filter((part) => part.length > 0);
}
var cache = /* @__PURE__ */ new Map();
function isAvailable(family) {
  const hit = cache.get(family);
  if (hit !== void 0) return hit;
  let found = false;
  try {
    const context = document.createElement("canvas").getContext("2d");
    if (context !== null) {
      const text = "mmmmmmmmmmlliWWW@#%";
      for (const base of ["monospace", "serif", "sans-serif"]) {
        context.font = `72px ${base}`;
        const fallback = context.measureText(text).width;
        context.font = `72px "${family}", ${base}`;
        if (context.measureText(text).width !== fallback) {
          found = true;
          break;
        }
      }
    }
  } catch {
    found = false;
  }
  cache.set(family, found);
  return found;
}
function resolvedFamily(stack) {
  const families = familiesOf(stack);
  for (const family of families) {
    if (GENERIC.has(family.toLowerCase())) return family;
    if (isAvailable(family)) return family;
  }
  return families[families.length - 1];
}

// ../../node_modules/.pnpm/@fontsource+geist-mono@5.3.0/node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2
var geist_mono_latin_400_normal_default = "data:font/woff2;base64,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";

// ../../node_modules/.pnpm/@fontsource+geist-mono@5.3.0/node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2
var geist_mono_latin_500_normal_default = "data:font/woff2;base64,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";

// ../../node_modules/.pnpm/@fontsource+geist-mono@5.3.0/node_modules/@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2
var geist_mono_latin_700_normal_default = "data:font/woff2;base64,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";

// ../../node_modules/.pnpm/@fontsource+jetbrains-mono@5.3.0/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2
var jetbrains_mono_latin_400_normal_default = "data:font/woff2;base64,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";

// ../../node_modules/.pnpm/@fontsource+jetbrains-mono@5.3.0/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2
var jetbrains_mono_latin_500_normal_default = "data:font/woff2;base64,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";

// ../../node_modules/.pnpm/@fontsource+jetbrains-mono@5.3.0/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2
var jetbrains_mono_latin_700_normal_default = "data:font/woff2;base64,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";

// src/font-faces.ts
function face(family, weight, url) {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format('woff2')}`;
}
var FONT_FACES = [
  face("Geist Mono", 400, geist_mono_latin_400_normal_default),
  face("Geist Mono", 500, geist_mono_latin_500_normal_default),
  face("Geist Mono", 700, geist_mono_latin_700_normal_default),
  face("JetBrains Mono", 400, jetbrains_mono_latin_400_normal_default),
  face("JetBrains Mono", 500, jetbrains_mono_latin_500_normal_default),
  face("JetBrains Mono", 700, jetbrains_mono_latin_700_normal_default)
].join("\n");

// src/fonts.ts
var UI_TOKEN = "--dsw-font-family";
var CODE_TOKEN = "--ds-font-family-code";
var STOCK_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
var STOCK_CODE = '"Berkeley Mono", "TX-02", "SF Mono", "Cascadia Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei", monospace';
var MONO_TAIL = '"Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';
var FONTS = [
  {
    id: "default",
    label: "Default",
    blurb: "The harness\u2019s own pairing \u2014 your OS sans, and the best mono you have.",
    bundled: false,
    ui: STOCK_UI,
    code: STOCK_CODE
  },
  {
    id: "geist-mono",
    label: "Geist Mono",
    blurb: "Geometric, even colour, generous spacing. Bundled \u2014 no install needed.",
    bundled: true,
    ui: `"Geist Mono", ${MONO_TAIL}`,
    code: `"Geist Mono", ${MONO_TAIL}`
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    blurb: "Tall x-height, tuned for long reading. Bundled \u2014 no install needed.",
    bundled: true,
    ui: `"JetBrains Mono", ${MONO_TAIL}`,
    code: `"JetBrains Mono", ${MONO_TAIL}`
  }
];
var DEFAULT_FONT = "default";
function findFont(id) {
  return FONTS.find((font) => font.id === id);
}
function fontPairs(font) {
  return {
    [UI_TOKEN]: { light: font.ui, dark: font.ui },
    [CODE_TOKEN]: { light: font.code, dark: font.code }
  };
}

// src/themes/catppuccin.ts
var catppuccin = {
  id: "catppuccin",
  label: "Catppuccin",
  blurb: "Soft pastels on deep plum \u2014 Mocha dark, Latte light.",
  variants: {
    dark: {
      bg: "#1e1e2e",
      surface: "#313244",
      overlay: "#45475a",
      sidebar: "#181825",
      fg: "#cdd6f4",
      muted: "#bac2de",
      faint: "#9399b2",
      border: "#45475a",
      accent: "#cba6f7",
      info: "#89b4fa",
      error: "#f38ba8",
      success: "#a6e3a1",
      warn: "#f9e2af",
      code: {
        bg: "#181825",
        comment: "#7f849c",
        keyword: "#cba6f7",
        string: "#a6e3a1",
        constant: "#fab387",
        function: "#89b4fa",
        parameter: "#f5c2e7",
        punctuation: "#bac2de",
        link: "#94e2d5"
      }
    },
    light: {
      bg: "#eff1f5",
      surface: "#ffffff",
      overlay: "#ffffff",
      sidebar: "#e6e9ef",
      fg: "#4c4f69",
      muted: "#5c5f77",
      faint: "#7c7f93",
      border: "#ccd0da",
      accent: "#8839ef",
      info: "#1e66f5",
      error: "#d20f39",
      success: "#40a02b",
      warn: "#df8e1d",
      code: {
        // Latte's greens, peaches and pinks sit at 2.2–2.8:1 on its own
        // mantle. Darkened just far enough to clear the 3:1 the contrast test
        // holds syntax to; the hues are unchanged.
        bg: "#e6e9ef",
        comment: "#7c7f93",
        keyword: "#8839ef",
        string: "#3c9628",
        constant: "#e0580a",
        function: "#1e66f5",
        parameter: "#c061a6",
        punctuation: "#5c5f77",
        link: "#179299"
      }
    }
  }
};

// src/themes/citron.ts
var citron = {
  id: "citron",
  label: "Citron",
  blurb: "Deep slate with a citron pop and coral warnings.",
  variants: {
    dark: {
      // Derived ground; `#2c4251` sits on top of it as the surface.
      bg: "#1e2e3a",
      surface: "#2c4251",
      overlay: "#3a5265",
      sidebar: "#182530",
      fg: "#ffffff",
      muted: "#c1c1c1",
      faint: "#8fa0ab",
      border: "#405a6b",
      accent: "#b6c649",
      error: "#d16666",
      success: "#b6c649",
      // No warm tone in the brief, so warn is the midpoint of citron and coral
      // rather than an imported amber — it stays inside the palette's family.
      warn: "#c39657",
      code: {
        bg: "#182530",
        comment: "#8794a0",
        keyword: "#b6c649",
        string: "#e08a8a",
        constant: "#d16666",
        function: "#a9c4d9",
        parameter: "#c1c1c1",
        punctuation: "#c1c1c1",
        link: "#b6c649"
      }
    },
    light: {
      bg: "#ffffff",
      surface: "#f6f7f8",
      overlay: "#ffffff",
      sidebar: "#eef0f2",
      fg: "#2c4251",
      muted: "#3d566a",
      faint: "#5f7789",
      border: "#c1c1c1",
      // Citron and coral are both too light to clear their floors on white, so
      // the light variant carries their darker siblings. The hues are the
      // brief's; the lightness is what white demands.
      accent: "#6f7d2b",
      error: "#b84a4a",
      success: "#6f7d2b",
      warn: "#94702a",
      code: {
        bg: "#f2f4f5",
        comment: "#647c8c",
        keyword: "#6f7d2b",
        string: "#a34848",
        constant: "#94702a",
        function: "#2c4251",
        parameter: "#3d566a",
        punctuation: "#3d566a",
        link: "#41627a"
      }
    }
  }
};

// src/themes/claude.ts
var claude = {
  id: "claude",
  label: "Claude",
  blurb: "Warm ivory and clay \u2014 paper grounds with a coral accent.",
  variants: {
    dark: {
      bg: "#1f1e1d",
      surface: "#262624",
      overlay: "#30302e",
      sidebar: "#191817",
      fg: "#f5f4ef",
      muted: "#d3d1c7",
      faint: "#9a978d",
      border: "#3d3b37",
      accent: "#d97757",
      info: "#7aa2c4",
      error: "#d4635a",
      success: "#8fa876",
      warn: "#d9a441",
      code: {
        bg: "#191817",
        comment: "#8a877d",
        keyword: "#d97757",
        string: "#8fa876",
        constant: "#d9a441",
        function: "#7aa2c4",
        parameter: "#c99a6e",
        punctuation: "#d3d1c7",
        link: "#7aa2c4"
      }
    },
    light: {
      bg: "#f0eee6",
      surface: "#faf9f5",
      overlay: "#ffffff",
      sidebar: "#e8e5da",
      fg: "#141413",
      muted: "#3d3b37",
      faint: "#6b6b69",
      border: "#dcd8cb",
      accent: "#c05f36",
      info: "#3f6f99",
      error: "#a63d33",
      success: "#5a7a45",
      warn: "#a3792f",
      code: {
        bg: "#e8e5da",
        comment: "#6f6c62",
        keyword: "#b3532c",
        string: "#4f6b3a",
        constant: "#8a5b2a",
        function: "#3f6f99",
        parameter: "#8a5b2a",
        punctuation: "#3d3b37",
        link: "#3f6f99"
      }
    }
  }
};

// src/themes/everforest.ts
var everforest = {
  id: "everforest",
  label: "Everforest",
  blurb: "Forest greens and warm sand \u2014 easy on the eyes for long sessions.",
  variants: {
    dark: {
      bg: "#2d353b",
      surface: "#343f44",
      overlay: "#3d484d",
      sidebar: "#232a2e",
      fg: "#d3c6aa",
      muted: "#c2b596",
      faint: "#9da9a0",
      border: "#475258",
      accent: "#83c092",
      info: "#7fbbb3",
      error: "#e67e80",
      success: "#a7c080",
      warn: "#dbbc7f",
      code: {
        bg: "#232a2e",
        comment: "#859289",
        keyword: "#e67e80",
        string: "#a7c080",
        constant: "#d699b6",
        function: "#7fbbb3",
        parameter: "#dbbc7f",
        punctuation: "#d3c6aa",
        link: "#83c092"
      }
    },
    light: {
      bg: "#fdf6e3",
      surface: "#f4f0d9",
      overlay: "#fffbef",
      sidebar: "#f4f0d9",
      fg: "#5c6a72",
      // Everforest's own light greys sit at ~2.9:1 against the cream base,
      // under the 3:1 floor the contrast test enforces; these are the nearest
      // darker steps that clear it without leaving the palette's hue family.
      muted: "#5f6d74",
      faint: "#78876f",
      border: "#e6e2cc",
      accent: "#2e8f6a",
      info: "#3a94c5",
      error: "#f85552",
      success: "#8da101",
      warn: "#dfa000",
      code: {
        // Everforest's light syntax set is its lowest-contrast surface; each
        // hue is darkened to clear the 3:1 floor, none is re-hued.
        bg: "#f4f0d9",
        comment: "#78876f",
        keyword: "#ee524f",
        string: "#7f9101",
        constant: "#cd61ab",
        function: "#3991c1",
        parameter: "#b28000",
        punctuation: "#5c6a72",
        link: "#319a72"
      }
    }
  }
};

// src/themes/gruvbox.ts
var gruvbox = {
  id: "gruvbox",
  label: "Gruvbox",
  blurb: "Retro warmth \u2014 earthy browns with orange and olive.",
  variants: {
    dark: {
      bg: "#282828",
      surface: "#3c3836",
      overlay: "#504945",
      sidebar: "#1d2021",
      fg: "#ebdbb2",
      muted: "#d5c4a1",
      faint: "#a89984",
      border: "#504945",
      accent: "#fe8019",
      info: "#83a598",
      error: "#fb4934",
      success: "#b8bb26",
      warn: "#fabd2f",
      code: {
        bg: "#1d2021",
        comment: "#928374",
        keyword: "#fb4934",
        string: "#b8bb26",
        constant: "#d3869b",
        function: "#8ec07c",
        parameter: "#fabd2f",
        punctuation: "#ebdbb2",
        link: "#83a598"
      }
    },
    light: {
      bg: "#fbf1c7",
      surface: "#f2e5bc",
      overlay: "#fbf1c7",
      sidebar: "#f2e5bc",
      fg: "#3c3836",
      muted: "#504945",
      faint: "#7c6f64",
      border: "#d5c4a1",
      accent: "#af3a03",
      info: "#076678",
      error: "#9d0006",
      success: "#79740e",
      warn: "#b57614",
      code: {
        bg: "#f2e5bc",
        comment: "#7c6f64",
        keyword: "#9d0006",
        string: "#79740e",
        constant: "#8f3f71",
        function: "#427b58",
        parameter: "#b57614",
        punctuation: "#3c3836",
        link: "#076678"
      }
    }
  }
};

// src/themes/bumble-bee.ts
var bumbleBee = {
  id: "bumble-bee",
  label: "Bumble Bee",
  blurb: "Yellow on black. Loud, and the most legible palette here.",
  variants: {
    dark: {
      bg: "#000000",
      surface: "#0d0d0d",
      overlay: "#1a1a1a",
      sidebar: "#000000",
      fg: "#ffffff",
      muted: "#e6e6e6",
      faint: "#bdbdbd",
      border: "#8a8a8a",
      accent: "#ffd400",
      accentFg: "#000000",
      info: "#4fc3f7",
      error: "#ff6b6b",
      success: "#69f0ae",
      warn: "#ffd54f",
      code: {
        bg: "#0d0d0d",
        comment: "#a8a8a8",
        keyword: "#ffd400",
        string: "#69f0ae",
        constant: "#ff8a80",
        function: "#4fc3f7",
        parameter: "#ffffff",
        punctuation: "#ffffff",
        link: "#4fc3f7"
      }
    },
    light: {
      bg: "#ffffff",
      surface: "#ffffff",
      overlay: "#ffffff",
      sidebar: "#f2f2f2",
      fg: "#000000",
      muted: "#1a1a1a",
      faint: "#3d3d3d",
      border: "#5a5a5a",
      accent: "#0b3d91",
      accentFg: "#ffffff",
      info: "#00457a",
      error: "#b00020",
      success: "#046307",
      warn: "#8a5a00",
      code: {
        bg: "#f2f2f2",
        comment: "#3d3d3d",
        keyword: "#0b3d91",
        string: "#046307",
        constant: "#8a1a00",
        function: "#00457a",
        parameter: "#000000",
        punctuation: "#000000",
        link: "#00457a"
      }
    }
  }
};

// src/themes/nord.ts
var nord = {
  id: "nord",
  label: "Nord",
  blurb: "Arctic, north-bluish. Cool greys with a frost accent.",
  variants: {
    dark: {
      bg: "#2e3440",
      surface: "#3b4252",
      overlay: "#434c5e",
      sidebar: "#2b303b",
      fg: "#eceff4",
      muted: "#d8dee9",
      faint: "#9099ab",
      border: "#4c566a",
      accent: "#88c0d0",
      info: "#81a1c1",
      error: "#bf616a",
      success: "#a3be8c",
      warn: "#ebcb8b",
      code: {
        bg: "#2b303b",
        comment: "#7b88a1",
        keyword: "#81a1c1",
        string: "#a3be8c",
        constant: "#b48ead",
        function: "#88c0d0",
        parameter: "#d8dee9",
        punctuation: "#d8dee9",
        link: "#8fbcbb"
      }
    },
    light: {
      bg: "#eceff4",
      surface: "#ffffff",
      overlay: "#ffffff",
      sidebar: "#e5e9f0",
      fg: "#2e3440",
      muted: "#3b4252",
      faint: "#66718a",
      border: "#d8dee9",
      accent: "#5e81ac",
      info: "#5e81ac",
      error: "#a54a53",
      success: "#4f7a3f",
      warn: "#a3792f",
      code: {
        bg: "#e5e9f0",
        comment: "#69758c",
        keyword: "#5e81ac",
        string: "#4f7a3f",
        constant: "#8a5b86",
        function: "#3b7d8c",
        parameter: "#3b4252",
        punctuation: "#434c5e",
        link: "#5e81ac"
      }
    }
  }
};

// src/themes/one.ts
var one = {
  id: "one",
  label: "One",
  blurb: "The Atom editor pair \u2014 slate blues, familiar syntax hues.",
  variants: {
    dark: {
      bg: "#282c34",
      surface: "#31353f",
      overlay: "#3b4048",
      sidebar: "#21252b",
      fg: "#dcdfe4",
      muted: "#abb2bf",
      faint: "#8a919e",
      border: "#3e4451",
      accent: "#61afef",
      info: "#56b6c2",
      error: "#e06c75",
      success: "#98c379",
      warn: "#e5c07b",
      code: {
        bg: "#21252b",
        comment: "#7f8794",
        keyword: "#c678dd",
        string: "#98c379",
        constant: "#d19a66",
        function: "#61afef",
        parameter: "#e06c75",
        punctuation: "#abb2bf",
        link: "#56b6c2"
      }
    },
    light: {
      bg: "#fafafa",
      surface: "#ffffff",
      overlay: "#ffffff",
      sidebar: "#f0f0f1",
      fg: "#383a42",
      muted: "#4f525e",
      faint: "#7c7f8a",
      border: "#dcdde0",
      accent: "#4078f2",
      info: "#0184bc",
      error: "#e45649",
      success: "#50a14f",
      warn: "#c18401",
      code: {
        bg: "#f0f0f1",
        comment: "#83858c",
        keyword: "#a626a4",
        // One Light's green and gold are a shade under 3:1 on its code fill.
        string: "#4b974a",
        constant: "#b57c01",
        function: "#4078f2",
        parameter: "#986801",
        punctuation: "#383a42",
        link: "#0184bc"
      }
    }
  }
};

// src/themes/rose-pine.ts
var rosePine = {
  id: "rose-pine",
  label: "Ros\xE9 Pine",
  blurb: "Muted rose and iris over soho-vibes charcoal; Dawn in light.",
  variants: {
    dark: {
      bg: "#191724",
      surface: "#1f1d2e",
      overlay: "#26233a",
      sidebar: "#16141f",
      fg: "#e0def4",
      muted: "#908caa",
      faint: "#8b87a8",
      border: "#2a273f",
      accent: "#c4a7e7",
      info: "#9ccfd8",
      error: "#eb6f92",
      success: "#6cbf9b",
      warn: "#f6c177",
      code: {
        bg: "#16141f",
        comment: "#8b87a8",
        keyword: "#3e8fb0",
        string: "#f6c177",
        constant: "#ebbcba",
        function: "#c4a7e7",
        parameter: "#9ccfd8",
        punctuation: "#e0def4",
        link: "#9ccfd8"
      }
    },
    light: {
      bg: "#faf4ed",
      surface: "#fffaf3",
      overlay: "#ffffff",
      sidebar: "#f2e9e1",
      fg: "#575279",
      // Dawn's `subtle` (#797593) lands at 4.0:1 on the rose base — a step
      // under the 4.5 the test asks of secondary text.
      muted: "#6e6a86",
      faint: "#7d7891",
      border: "#dfd8ce",
      accent: "#907aa9",
      info: "#286983",
      error: "#b4637a",
      success: "#4a7d68",
      warn: "#b07d1a",
      code: {
        bg: "#f2e9e1",
        comment: "#7d7891",
        keyword: "#286983",
        string: "#4a7d68",
        constant: "#b07d1a",
        function: "#907aa9",
        parameter: "#b4637a",
        punctuation: "#575279",
        // Dawn's foam is a shade under 3:1 on the code fill.
        link: "#538e99"
      }
    }
  }
};

// src/themes/sakura.ts
var sakura = {
  id: "sakura",
  label: "Sakura",
  blurb: "Cherry blossom \u2014 petal pinks on a soft plum neutral.",
  variants: {
    light: {
      bg: "#fdf3f5",
      surface: "#ffffff",
      overlay: "#ffffff",
      sidebar: "#f9e8ed",
      fg: "#3d2831",
      muted: "#5c3f4b",
      faint: "#8a6675",
      border: "#f0d5de",
      accent: "#bf4d78",
      info: "#5a7a9e",
      error: "#b03040",
      success: "#4f7a52",
      warn: "#a3762f",
      code: {
        bg: "#f9e8ed",
        comment: "#8a6675",
        keyword: "#bf4d78",
        string: "#4f7a52",
        constant: "#8a5b2a",
        function: "#5a7a9e",
        parameter: "#a3762f",
        punctuation: "#3d2831",
        link: "#5a7a9e"
      }
    },
    dark: {
      bg: "#1e181c",
      surface: "#291f25",
      overlay: "#33272e",
      sidebar: "#181316",
      fg: "#f7e9ee",
      muted: "#e0c6d1",
      faint: "#a98b98",
      border: "#3d2f36",
      accent: "#f2a0bd",
      info: "#9ec1e0",
      error: "#ef7a8a",
      success: "#a3c9a0",
      warn: "#e8c07d",
      code: {
        bg: "#181316",
        comment: "#a98b98",
        keyword: "#f2a0bd",
        string: "#a3c9a0",
        constant: "#e8c07d",
        function: "#9ec1e0",
        parameter: "#e0a2c0",
        punctuation: "#e0c6d1",
        link: "#9ec1e0"
      }
    }
  }
};

// src/themes/solarized.ts
var solarized = {
  id: "solarized",
  label: "Solarized",
  blurb: "The classic low-contrast pair: teal-navy dark, warm paper light.",
  variants: {
    dark: {
      bg: "#002b36",
      surface: "#073642",
      overlay: "#0a4351",
      sidebar: "#00212b",
      fg: "#93a1a1",
      // base0 (#839496) is 4.1:1 on base02, just under AA for secondary text.
      // Solarized is low-contrast by design, so this is the smallest step off
      // the canonical value that still clears the floor.
      muted: "#8b9c9e",
      faint: "#6c8288",
      border: "#0f4a58",
      accent: "#268bd2",
      info: "#2aa198",
      error: "#dc322f",
      success: "#859900",
      warn: "#b58900",
      code: {
        bg: "#00212b",
        comment: "#6c8288",
        keyword: "#859900",
        string: "#2aa198",
        constant: "#d33682",
        function: "#268bd2",
        parameter: "#93a1a1",
        punctuation: "#93a1a1",
        link: "#6c71c4"
      }
    },
    light: {
      bg: "#fdf6e3",
      surface: "#fffbf0",
      overlay: "#ffffff",
      sidebar: "#f4ecd8",
      fg: "#586e75",
      // base00 (#657b83), likewise a step darker to clear AA on the paper base.
      muted: "#5f747c",
      faint: "#6b7b7b",
      border: "#e5dcc3",
      accent: "#268bd2",
      info: "#2aa198",
      error: "#dc322f",
      success: "#6c7a00",
      warn: "#a07600",
      code: {
        bg: "#f4ecd8",
        comment: "#7a8a8a",
        keyword: "#6c7a00",
        string: "#1f8074",
        constant: "#c0246e",
        function: "#1f6fb0",
        parameter: "#586e75",
        punctuation: "#586e75",
        link: "#5b60b0"
      }
    }
  }
};

// src/themes/tokyo-night.ts
var tokyoNight = {
  id: "tokyo-night",
  label: "Tokyo Night",
  blurb: "Neon-on-navy after dark; a cool overcast palette by day.",
  variants: {
    dark: {
      bg: "#1a1b26",
      surface: "#24283b",
      overlay: "#292e42",
      sidebar: "#16161e",
      fg: "#c0caf5",
      muted: "#a9b1d6",
      faint: "#787e9c",
      border: "#2f334d",
      accent: "#7aa2f7",
      info: "#7dcfff",
      error: "#f7768e",
      success: "#9ece6a",
      warn: "#e0af68",
      code: {
        bg: "#16161e",
        comment: "#6b7394",
        keyword: "#bb9af7",
        string: "#9ece6a",
        constant: "#ff9e64",
        function: "#7aa2f7",
        parameter: "#e0af68",
        punctuation: "#a9b1d6",
        link: "#7dcfff"
      }
    },
    light: {
      bg: "#e1e2e7",
      surface: "#e9e9ed",
      overlay: "#ffffff",
      sidebar: "#d5d6db",
      fg: "#343b58",
      muted: "#4c5470",
      faint: "#6a729b",
      border: "#c4c8da",
      accent: "#2e7de9",
      info: "#007197",
      error: "#f52a65",
      success: "#587539",
      warn: "#8c6c3e",
      code: {
        // Day's code fill is a mid grey, so its magenta and blue need a
        // shade more depth than the editor theme uses on white.
        bg: "#d5d6db",
        comment: "#6a729b",
        keyword: "#9552ec",
        string: "#587539",
        constant: "#b15c00",
        function: "#2b76db",
        parameter: "#8c6c3e",
        punctuation: "#343b58",
        link: "#007197"
      }
    }
  }
};

// src/themes/index.ts
var THEMES = [
  bumbleBee,
  catppuccin,
  citron,
  claude,
  everforest,
  gruvbox,
  nord,
  one,
  rosePine,
  sakura,
  solarized,
  tokyoNight
];
var STOCK_THEME = "stock";
var THEME_ALIASES = {
  "high-contrast": "bumble-bee"
};
function findTheme(id) {
  const resolved = id === void 0 ? void 0 : THEME_ALIASES[id] ?? id;
  return THEMES.find((theme) => theme.id === resolved);
}

// src/scale.ts
var SCALE_TOKEN = "--dshth-ui-scale";
var SCALE_RULE = `#root { zoom: var(${SCALE_TOKEN}, 1); }`;
var SCALE_LEVELS = [
  { id: "90", label: "90%", value: 0.9 },
  { id: "100", label: "100%", value: 1 },
  { id: "110", label: "110%", value: 1.1 },
  { id: "125", label: "125%", value: 1.25 },
  { id: "150", label: "150%", value: 1.5 }
];
var DEFAULT_SCALE = "100";
function findScale(id) {
  return SCALE_LEVELS.find((level) => level.id === id);
}
function scalePairs(level) {
  const value = String(level.value);
  return { [SCALE_TOKEN]: { light: value, dark: value } };
}

// src/tokens.ts
function complete(palette, mode) {
  const dark = mode === "dark";
  return {
    ...palette,
    info: palette.info ?? palette.accent,
    // A sidebar that matches `bg` exactly reads as one undifferentiated slab;
    // one step away from the base gives the column an edge without a border.
    sidebar: palette.sidebar ?? (dark ? mix(palette.bg, "#000000", 0.25) : mix(palette.bg, palette.fg, 0.035)),
    accentFg: palette.accentFg ?? readable(palette.accent, palette.bg, palette.fg, "#ffffff", "#000000"),
    bubble: palette.bubble ?? (dark ? mix(palette.surface, palette.fg, 0.05) : mix(palette.bg, palette.accent, 0.1))
  };
}
function paletteRoles(palette, mode) {
  const p = complete(palette, mode);
  return [
    { role: "bg", color: p.bg },
    { role: "sidebar", color: p.sidebar },
    { role: "surface", color: p.surface },
    { role: "overlay", color: p.overlay },
    { role: "border", color: p.border },
    { role: "fg", color: p.fg },
    { role: "muted", color: p.muted },
    { role: "faint", color: p.faint },
    { role: "accent", color: p.accent },
    { role: "info", color: p.info },
    { role: "error", color: p.error },
    { role: "success", color: p.success },
    { role: "warn", color: p.warn },
    { role: "code", color: p.code.bg },
    { role: "keyword", color: p.code.keyword },
    { role: "string", color: p.code.string }
  ];
}
function buildTokens(source, mode) {
  const p = complete(source, mode);
  const dark = mode === "dark";
  const code = p.code;
  const codeFg = code.fg ?? p.fg;
  const lift = (base, amount) => mix(base, p.fg, amount);
  const infoFill = legibleFill(p.accent, p.bg);
  return {
    // --- backgrounds -----------------------------------------------------
    "--dsw-alias-bg-base": p.bg,
    "--dsw-alias-bg-layer-1": p.surface,
    "--dsw-alias-bg-layer-2": p.surface,
    "--dsw-alias-bg-layer-3": p.overlay,
    "--dsw-alias-bg-module-platform": lift(p.bg, 0.04),
    "--dsw-alias-bg-multi-select": lift(p.surface, 0.06),
    "--dsw-alias-bg-overlay": p.overlay,
    "--dsw-alias-bg-skeleton": alpha(p.fg, 0.07),
    // Scrims sit over arbitrary content (images, modals), so they stay
    // neutral black rather than following the palette; only the drop scrim,
    // which tints toward the app surface, is derived.
    "--dsw-alias-bg-mask-1": dark ? "#00000080" : "#0000003d",
    "--dsw-alias-bg-mask-2": dark ? "#00000033" : "#0000001f",
    "--dsw-alias-bg-mask-3": "#0000007a",
    "--dsw-alias-bg-mask-photo": "#000000e0",
    "--dsw-alias-bg-mask-drop": alpha(p.bg, 0.7),
    // --- borders ---------------------------------------------------------
    // Four ascending steps off one authored line colour. Alpha rather than
    // solid so borders composite correctly over any layer beneath them.
    "--dsw-alias-border-l1": alpha(p.border, 0.35),
    "--dsw-alias-border-l2": alpha(p.border, 0.55),
    "--dsw-alias-border-l2-darkmode-thin": alpha(p.border, 0.35),
    "--dsw-alias-border-l3": alpha(p.border, 0.7),
    "--dsw-alias-border-l4": alpha(p.border, 0.85),
    "--dsw-alias-border-inverted": alpha(p.fg, 0.06),
    "--dsw-alias-border-inverted2": alpha(p.fg, 0.09),
    // --- brand -----------------------------------------------------------
    // Stock uses the highest-contrast neutral here, because `brand-primary`
    // is what `button-primary-fill` reads. Pointing it at the accent is the
    // single change that makes a theme feel applied rather than tinted.
    "--dsw-alias-brand-primary": p.accent,
    "--dsw-alias-brand-primary-invert": p.fg,
    "--dsw-alias-brand-primary-new-colorprimary-new-color": p.accent,
    "--dsw-alias-brand-text": p.fg,
    // --- buttons ---------------------------------------------------------
    "--dsw-alias-button-contrast-fill": mix(p.fg, p.bg, 0.12),
    "--dsw-alias-button-elevated-fill": p.overlay,
    "--dsw-alias-button-floating-fill": p.surface,
    "--dsw-alias-button-floating-hover": lift(p.surface, 0.07),
    "--dsw-alias-button-ghost-active-border": p.border,
    "--dsw-alias-button-ghost-active-fill": lift(p.surface, 0.08),
    "--dsw-alias-button-ghost-active-hover": lift(p.surface, 0.14),
    // The send button — dsh's single most prominent control — reads this
    // token, and its CSS hardcodes a white icon. Pointing it at the accent is
    // what makes a theme's identity visible at all: `brand-primary` and the
    // `deepseek-*` slots are barely painted by the current UI, so an accent
    // routed only there is applied but invisible. `legibleFill` finds the
    // nearest shade that keeps the white icon and the control's own edge both
    // above 3:1.
    "--dsw-alias-button-info-fill": infoFill,
    "--dsw-alias-button-info-hover": mix(infoFill, p.fg, 0.18),
    "--dsw-alias-button-primary-dimmed": mix(p.accent, p.bg, 0.72),
    // `button-primary-fill` is `var(--dsw-alias-brand-primary)` upstream and
    // is left alone so the indirection keeps working.
    "--dsw-alias-button-primary-hover": mix(p.accent, p.fg, 0.18),
    // Toolbar buttons float over media thumbnails, not over the app palette.
    "--dsw-alias-button-tool-bar-fill": "#54555780",
    "--dsw-alias-button-tool-bar-fill-invisible": "#1f1f1f5c",
    "--dsw-alias-button-tool-bar-hover": "#54555799",
    // --- interaction -----------------------------------------------------
    "--dsw-alias-interactive-bg-hover": alpha(p.fg, 0.07),
    // The name says accent; stock uses a neutral. Tinting it is free contrast-wise
    // (it is a wash under existing text) and shows the palette on every hover.
    "--dsw-alias-interactive-bg-hover-accent": alpha(p.accent, 0.22),
    "--dsw-alias-interactive-bg-hover-danger": alpha(p.error, 0.13),
    "--dsw-alias-interactive-bg-hover-solid": lift(p.surface, 0.07),
    "--dsw-alias-interactive-bg-active": alpha(p.fg, 0.12),
    // --- labels ----------------------------------------------------------
    "--dsw-alias-label-primary": p.fg,
    "--dsw-alias-label-secondary": p.muted,
    "--dsw-alias-label-tertiary": p.faint,
    "--dsw-alias-label-caption": mix(p.faint, p.bg, 0.2),
    "--dsw-alias-label-dimmed": mix(p.faint, p.bg, 0.5),
    "--dsw-alias-label-primary-bluish": p.fg,
    "--dsw-alias-label-primary-dimmed": mix(p.fg, p.bg, 0.12),
    // Text drawn ON the primary/brand fill.
    "--dsw-alias-label-primary-foreground": p.accentFg,
    // Text drawn on an inverted chip (tooltips, toasts).
    "--dsw-alias-label-primary-inverted": p.bg,
    // --- markdown --------------------------------------------------------
    "--dsw-alias-markdown-code-block": code.bg,
    "--dsw-alias-markdown-code-block-banner": lift(code.bg, 0.05),
    "--dsw-alias-markdown-code-segment-selected": lift(code.bg, 0.1),
    "--dsw-alias-markdown-code-segment-unselected": code.bg,
    "--dsw-alias-markdown-inline-code": lift(code.bg, 0.06),
    "--dsw-alias-markdown-citation": lift(p.surface, 0.07),
    "--dsw-alias-markdown-placeholder": lift(p.bg, 0.04),
    "--dsw-alias-markdown-tag": lift(p.surface, 0.05),
    // --- scrollbars ------------------------------------------------------
    "--dsw-alias-scrollbar-bg-l1": alpha(p.fg, 0.18),
    "--dsw-alias-scrollbar-bg-l2": alpha(p.fg, 0.22),
    "--dsw-alias-scrollbar-hover-l1": alpha(p.fg, 0.3),
    "--dsw-alias-scrollbar-hover-l2": alpha(p.fg, 0.34),
    // --- state -----------------------------------------------------------
    "--dsw-alias-state-error-primary": p.error,
    "--dsw-alias-state-error-secondary": mix(p.error, p.bg, 0.2),
    "--dsw-alias-state-success-primary": p.success,
    "--dsw-alias-state-success-secondary": mix(p.success, p.bg, 0.2),
    "--dsw-alias-state-success-tertiary": mix(p.success, p.bg, 0.82),
    "--dsw-alias-state-warn-primary": p.warn,
    "--dsw-alias-state-warn-secondary": mix(p.warn, p.bg, 0.2),
    "--dsw-alias-state-warn-tertiary": mix(p.warn, p.bg, 0.82),
    "--dsw-alias-state-warn-label": p.warn,
    // The "business" pair is dsh's second accent surface: model labels, chips,
    // and — through `--mc-accent` — mission-control's tags and its pomodoro
    // pulse. Pointing it at the theme accent rather than `info` is most of what
    // makes a palette visible outside the send button. It is used as TEXT on a
    // surface, so it takes the raw accent (already asserted ≥3:1 against the
    // page) rather than the darkened fill variant.
    "--dsw-alias-state-business-primary": p.accent,
    "--dsw-alias-state-business-tertiary": mix(p.accent, p.bg, 0.78),
    // --- floating chrome -------------------------------------------------
    // Stock inverts these against the page (a dark tooltip in light mode), so
    // the derivation inverts too and `label-primary-inverted` supplies the text.
    "--dsw-alias-toast-bg": dark ? lift(p.surface, 0.18) : mix(p.fg, p.bg, 0.1),
    "--dsw-alias-tooltip-bg": dark ? lift(p.surface, 0.18) : mix(p.fg, p.bg, 0.1),
    // --- product-specific ------------------------------------------------
    "--dsw-specific-bubble": p.bubble,
    "--dsw-specific-bubble-highlight": mix(p.bubble, p.accent, 0.28),
    "--dsw-specific-input-major": p.surface,
    "--dsw-specific-login-input": lift(p.bg, 0.03),
    "--dsw-specific-menu": p.overlay,
    "--dsw-specific-selector": lift(p.surface, 0.05),
    "--dsw-specific-sidebar-fill": p.sidebar,
    "--dsw-specific-sidebar-nav-item-hover": lift(p.sidebar, 0.07),
    // The selected session row is the most-looked-at surface in the app, and a
    // neutral lift wastes it. Tinted lightly enough that `label-primary` on top
    // stays above 4.5:1 — the suite checks that pairing directly.
    // Tinted from the sidebar itself rather than from a lifted grey: lifting
    // moves the surface TOWARD the text, which spends the contrast headroom the
    // tint needs — two light themes were already under AA on the old grey lift.
    // The accent tint alone distinguishes the row, and reads better than grey.
    "--dsw-specific-sidebar-nav-item-active": legibleTint(p.sidebar, p.accent, p.fg),
    "--dsw-specific-sidebar-nav-item-active-accent": mix(p.sidebar, p.accent, 0.3),
    "--dsw-specific-tip": lift(p.surface, 0.05),
    // --- raw ramp slots read directly by components ----------------------
    // ui-conversation and ui-trajectory bypass the alias layer for these five;
    // without them a themed build keeps stock DeepSeek blue in the transcript.
    "--dsw-static-deepseek-500": p.accent,
    "--dsw-static-deepseek-200": mix(p.accent, p.bg, 0.7),
    // ui-conversation and ui-trajectory read these two directly for their
    // accent-coloured bits, so they follow the theme accent too.
    "--dsw-static-blue-500": p.accent,
    "--dsw-static-blue-450": p.accent,
    "--dsw-static-neutral-bluish-400": p.faint,
    // --- elevation + gradients -------------------------------------------
    "--dsw-shadow-lv1": dark ? "0 2px 4px 0 #00000059" : "0 2px 4px 0 #0000000d",
    "--dsw-shadow-lv1-blur": dark ? "0 4px 12px 0 #00000040" : "0 4px 12px 0 #00000005",
    "--dsw-shadow-lv2": dark ? "0 4px 12px 0 #00000040, 0 2px 8px 0 #0000004d" : "0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a",
    "--dsw-shadow-lv3": dark ? "0 0 1px 0 #00000080, 0 0 4px 0 #0000004d, 0 12px 32px 0 #00000066" : "0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014",
    "--dsw-linear-gradient-think": `linear-gradient(180deg, ${p.bg} 20.19%, ${alpha(p.bg, 0)} 100%)`,
    "--dsw-linear-think-select": `linear-gradient(180deg, ${p.surface} 20.19%, ${alpha(p.surface, 0)} 100%)`,
    // --- syntax highlighting ---------------------------------------------
    "--shiki-foreground": codeFg,
    "--shiki-background": code.bg,
    "--shiki-token-comment": code.comment,
    "--shiki-token-keyword": code.keyword,
    "--shiki-token-string": code.string,
    "--shiki-token-string-expression": code.string,
    "--shiki-token-constant": code.constant,
    "--shiki-token-function": code.function,
    "--shiki-token-parameter": code.parameter,
    "--shiki-token-punctuation": code.punctuation,
    "--shiki-token-link": code.link
  };
}
function themePairs(spec, contrast2 = 0) {
  const light = buildTokens(withContrast(spec.variants.light, "light", contrast2), "light");
  const dark = buildTokens(withContrast(spec.variants.dark, "dark", contrast2), "dark");
  const pairs = {};
  for (const name of /* @__PURE__ */ new Set([...Object.keys(light), ...Object.keys(dark)])) {
    pairs[name] = { light: light[name] ?? dark[name], dark: dark[name] ?? light[name] };
  }
  return pairs;
}

// src/layers.ts
var SOURCE_THEME = "@dennisrongo/dsh-theme:palette";
var SOURCE_ACCENT = "@dennisrongo/dsh-theme:accent";
var SOURCE_FONT = "@dennisrongo/dsh-theme:font";
var SOURCE_SCALE = "@dennisrongo/dsh-theme:scale";
var live = /* @__PURE__ */ new Map();
function put(theme, source, pairs) {
  if (pairs === void 0) {
    live.get(source)?.();
    live.delete(source);
    return;
  }
  live.set(source, theme.overrideTokens(source, pairs));
}
function applySelection(theme, selection) {
  const spec = findTheme(selection.theme);
  const level = findContrast(selection.contrast);
  put(theme, SOURCE_THEME, spec === void 0 ? void 0 : themePairs(spec, level?.amount ?? 0));
  const scale = findScale(selection.scale);
  put(theme, SOURCE_SCALE, scale === void 0 ? void 0 : scalePairs(scale));
  const accent = findAccent(selection.accent);
  put(theme, SOURCE_ACCENT, accent === void 0 ? void 0 : accentPairs(accent));
  const font = findFont(selection.font);
  put(theme, SOURCE_FONT, font === void 0 ? void 0 : fontPairs(font));
  if (spec?.pinScheme !== void 0 && theme.getTheme().preference !== spec.pinScheme) {
    theme.setTheme(spec.pinScheme);
  }
}
function retractAll(theme) {
  for (const source of [...live.keys()]) put(theme, source, void 0);
}
function schemeToRestore(pinned, current, enteredWith) {
  if (pinned !== void 0) return void 0;
  return current === enteredWith ? void 0 : enteredWith;
}

// src/storage.ts
var DEFAULT_SELECTION = {
  theme: STOCK_THEME,
  accent: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  contrast: DEFAULT_CONTRAST,
  scale: DEFAULT_SCALE
};
var COOKIE = "dsh-theme";
var KEY_THEME = "dsh-theme:theme";
var KEY_ACCENT = "dsh-theme:accent";
var KEY_FONT = "dsh-theme:font";
var KEY_CONTRAST = "dsh-theme:contrast";
var KEY_SCALE = "dsh-theme:scale";
var RESERVED = "-";
var MAX_AGE = 31536e4;
var ID = /^[a-z0-9-]{1,40}$/;
function formatSelection(selection) {
  return `${selection.theme}.${selection.accent}.${selection.font}.${RESERVED}.${selection.contrast}.${selection.scale}`;
}
function parseSelection(raw) {
  const parts = (raw ?? "").split(".");
  const pick = (at, fallback) => parts[at] !== void 0 && ID.test(parts[at]) ? parts[at] : fallback;
  return {
    theme: pick(0, DEFAULT_SELECTION.theme),
    accent: pick(1, DEFAULT_SELECTION.accent),
    font: pick(2, DEFAULT_SELECTION.font),
    // index 3 is the retired code-font slot; see formatSelection.
    contrast: pick(4, DEFAULT_SELECTION.contrast),
    scale: pick(5, DEFAULT_SELECTION.scale)
  };
}
function readCookie(jar, name) {
  for (const part of jar.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    return decodeURIComponent(part.slice(at + 1).trim());
  }
  return void 0;
}
function loadSelection() {
  try {
    const cookie = readCookie(document.cookie, COOKIE);
    if (cookie !== void 0) return parseSelection(cookie);
  } catch {
  }
  try {
    return parseSelection(
      [
        window.localStorage.getItem(KEY_THEME) ?? DEFAULT_SELECTION.theme,
        window.localStorage.getItem(KEY_ACCENT) ?? DEFAULT_SELECTION.accent,
        window.localStorage.getItem(KEY_FONT) ?? DEFAULT_SELECTION.font,
        RESERVED,
        window.localStorage.getItem(KEY_CONTRAST) ?? DEFAULT_SELECTION.contrast,
        window.localStorage.getItem(KEY_SCALE) ?? DEFAULT_SELECTION.scale
      ].join(".")
    );
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}
function saveSelection(selection) {
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(formatSelection(selection))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
  } catch {
  }
  try {
    window.localStorage.setItem(KEY_THEME, selection.theme);
    window.localStorage.setItem(KEY_ACCENT, selection.accent);
    window.localStorage.setItem(KEY_FONT, selection.font);
    window.localStorage.setItem(KEY_CONTRAST, selection.contrast);
    window.localStorage.setItem(KEY_SCALE, selection.scale);
  } catch {
  }
}

// src/client.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "theme"];
var PREVIEW_DEBOUNCE_MS = 90;
var STYLES = `
${FONT_FACES}
${SCALE_RULE}
.dshth { display: flex; flex-direction: column; gap: 28px; padding-bottom: 72px; }
.dshth-title { color: var(--dsw-alias-label-primary); font-size: 20px; font-weight: 500; line-height: 28px; margin: 0; }
.dshth-intro { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; margin: 6px 0 0; }
.dshth-group { display: flex; flex-direction: column; gap: 12px; }
.dshth-legend { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; margin: 0; }
.dshth-hint { color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; margin: -6px 0 0; }

/* --- theme grid --- */
.dshth-themes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 640px) { .dshth-themes { grid-template-columns: minmax(0, 1fr); } }
.dshth-card {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 10px 12px; border-radius: 12px; cursor: pointer; text-align: left;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 13px; line-height: 20px;
}
.dshth-card:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dshth-card[aria-checked="true"] { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.dshth-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshth-chips { display: flex; flex: none; border-radius: 8px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); }
.dshth-chip { width: 16px; height: 32px; }
.dshth-card-text { display: flex; flex-direction: column; min-width: 0; }
.dshth-card-name { font-weight: 500; }
.dshth-card-blurb { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Hovering (or arrowing onto) a card swaps its blurb for the theme's full
   authored palette. It replaces the blurb rather than adding a row so the
   grid never reflows, and the name stays visible while you read the colours.
   This is a local reveal, not a preview \u2014 nothing is applied on hover. */
.dshth-card-palette { display: none; height: 17px; align-items: center; gap: 2px; }
/* Gated on [data-palette] so the stock DeepSeek card, which has no authored
   palette to show, keeps its blurb instead of hovering to an empty row. */
.dshth-card[data-palette]:hover .dshth-card-blurb,
.dshth-card[data-palette]:focus-visible .dshth-card-blurb { display: none; }
.dshth-card[data-palette]:hover .dshth-card-palette,
.dshth-card[data-palette]:focus-visible .dshth-card-palette { display: flex; }
.dshth-swatch { width: 8px; height: 12px; border-radius: 2px; flex: none; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }

/* --- accent row --- */
.dshth-accents { display: flex; flex-wrap: wrap; gap: 8px; }
.dshth-accent {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 11px 6px 7px; border-radius: 999px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit; font-size: 12px; line-height: 18px;
}
.dshth-accent:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dshth-accent[aria-checked="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.dshth-accent:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshth-dot { width: 14px; height: 14px; border-radius: 50%; flex: none; border: 1px solid var(--dsw-alias-border-l3); }
.dshth-dot-auto { background: linear-gradient(135deg, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-bg-layer-3) 50%); }

/* --- font list --- */
.dshth-fonts { display: flex; flex-direction: column; gap: 6px; }
.dshth-font {
  display: flex; align-items: baseline; gap: 10px; width: 100%;
  padding: 9px 12px; border-radius: 10px; cursor: pointer; text-align: left;
  background: transparent; border: 1px solid transparent;
  color: var(--dsw-alias-label-primary);
}
.dshth-font:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dshth-font[aria-checked="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
.dshth-font:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshth-font-name { font-size: 14px; line-height: 22px; flex: none; }
.dshth-font-blurb { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
/* What the stack actually resolves to here \u2014 drawn in the UI font, not the
   preset's, so it stays legible and reads as metadata rather than a sample. */
.dshth-font-resolved {
  flex: none; margin-left: auto; padding-left: 10px;
  color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 18px;
  font-family: var(--dsw-font-family); font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (max-width: 560px) { .dshth-font-blurb { display: none; } }

/* --- sliders --- */
.dshth-slider-row { display: flex; align-items: center; gap: 12px; }
.dshth-slider {
  flex: 1; min-width: 0; height: 4px; margin: 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.dshth-slider:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 4px; }
.dshth-slider-value {
  flex: none; min-width: 72px; text-align: right;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.dshth-slider-ticks {
  display: flex; justify-content: space-between;
  color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px;
}

/* --- dirty bar --- */
.dshth-bar {
  position: sticky; bottom: 0; margin: 0 -24px -24px; padding: 12px 24px;
  display: flex; align-items: center; gap: 10px;
  background: var(--dsw-alias-bg-layer-2);
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dshth-bar-text { color: var(--dsw-alias-label-secondary); font-size: 13px; margin-right: auto; }
.dshth-btn {
  padding: 7px 14px; border-radius: 10px; cursor: pointer;
  font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dshth-btn:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dshth-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshth-btn-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  border-color: transparent;
}
.dshth-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
`;
var stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dennisrongo/dsh-theme";
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}
function nextOption(ids, current, key, columns = 1) {
  const at = ids.indexOf(current);
  if (at === -1) return ids[0];
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? columns : key === "ArrowUp" ? -columns : 0;
  if (step === 0) {
    if (key === "Home") return ids[0];
    if (key === "End") return ids[ids.length - 1];
    return void 0;
  }
  const next = (at + step + ids.length * 2) % ids.length;
  return ids[next];
}
function chipsOf(spec, mode) {
  const palette = spec.variants[mode];
  return [palette.bg, palette.surface, palette.accent];
}
function ThemePanel({ ctx }) {
  const theme = ctx.theme;
  const [committed, setCommitted] = import_react.default.useState(loadSelection);
  const [draft, setDraft] = import_react.default.useState(committed);
  const [mode, setMode] = import_react.default.useState(() => theme.getTheme().active.colorScheme);
  import_react.default.useEffect(() => injectStyles(), []);
  import_react.default.useEffect(() => {
    const off = ctx.on("theme/change", (snapshot) => {
      setMode(snapshot.active.colorScheme);
    });
    return off;
  }, [ctx]);
  const draftRef = import_react.default.useRef(draft);
  draftRef.current = draft;
  import_react.default.useEffect(() => {
    const timer = window.setTimeout(() => applySelection(theme, draftRef.current), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, theme]);
  const committedRef = import_react.default.useRef(committed);
  committedRef.current = committed;
  const enteredWith = import_react.default.useRef(theme.getTheme().preference);
  const restore = import_react.default.useCallback(
    (selection) => {
      applySelection(theme, selection);
      const scheme = schemeToRestore(
        findTheme(selection.theme)?.pinScheme,
        theme.getTheme().preference,
        enteredWith.current
      );
      if (scheme !== void 0) theme.setTheme(scheme);
    },
    [theme]
  );
  const restoreRef = import_react.default.useRef(restore);
  restoreRef.current = restore;
  import_react.default.useEffect(
    () => () => {
      restoreRef.current(committedRef.current);
    },
    []
  );
  const dirty = draft.theme !== committed.theme || draft.accent !== committed.accent || draft.font !== committed.font || draft.contrast !== committed.contrast || draft.scale !== committed.scale;
  const apply2 = () => {
    saveSelection(draft);
    setCommitted(draft);
    applySelection(theme, draft);
    enteredWith.current = theme.getTheme().preference;
  };
  const revert = () => {
    setDraft(committed);
    restore(committed);
  };
  const accentOptions = [
    { id: DEFAULT_ACCENT, label: DEFAULT_ACCENT_LABEL },
    ...ACCENTS.map((accent) => ({ id: accent.id, label: accent.label, swatch: accent[mode] }))
  ];
  const resolved = import_react.default.useMemo(() => {
    const systemFamily = resolvedFamily(FONTS.find((f) => f.id === DEFAULT_FONT)?.ui ?? "");
    return new Map(
      FONTS.map((font) => {
        const family = resolvedFamily(font.ui);
        const sameAsSystem = font.id !== DEFAULT_FONT && family === systemFamily;
        return [font.id, { family, sameAsSystem }];
      })
    );
  }, []);
  const themeIds = [STOCK_THEME, ...THEMES.map((t) => t.id)];
  const cards = [
    {
      id: STOCK_THEME,
      label: "DeepSeek",
      blurb: "The palette the harness ships with.",
      chips: mode === "dark" ? ["#151517", "#232324", "#f9fafb"] : ["#ffffff", "#f9fafb", "#0f1115"],
      palette: []
    },
    ...THEMES.map((spec) => ({
      id: spec.id,
      label: spec.label,
      blurb: spec.blurb,
      chips: chipsOf(spec, mode),
      palette: paletteRoles(spec.variants[mode], mode)
    }))
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "dshth-title", children: "Themes" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshth-intro", children: "Themes layer over your Light/Dark/System choice in General \u2014 each one ships both palettes, so switching appearance keeps the theme. Changes preview immediately; nothing is saved until you apply." })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshth-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshth-legend", children: "Theme" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: "dshth-themes",
          role: "radiogroup",
          "aria-label": "Theme",
          onKeyDown: (event) => {
            const next = nextOption(themeIds, draft.theme, event.key, 2);
            if (next === void 0) return;
            event.preventDefault();
            setDraft((prev) => ({ ...prev, theme: next }));
            const node = event.currentTarget.querySelector(`[data-id="${next}"]`);
            node?.focus();
          },
          children: cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              role: "radio",
              "data-id": card.id,
              ...card.palette.length > 0 ? { "data-palette": "" } : {},
              "aria-checked": draft.theme === card.id,
              tabIndex: draft.theme === card.id ? 0 : -1,
              className: "dshth-card",
              onClick: () => setDraft((prev) => ({ ...prev, theme: card.id })),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-chips", "aria-hidden": "true", children: card.chips.map((color, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-chip", style: { background: color } }, i)) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshth-card-text", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-card-name", children: card.label }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-card-blurb", children: card.blurb }),
                  card.palette.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-card-palette", "aria-hidden": "true", children: card.palette.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "span",
                    {
                      className: "dshth-swatch",
                      style: { background: entry.color },
                      title: `${entry.role} ${entry.color}`
                    },
                    entry.role
                  )) }) : null
                ] })
              ]
            },
            card.id
          ))
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshth-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshth-legend", children: "Accent" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshth-hint", children: "Recolours primary buttons and active navigation, over any theme." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: "dshth-accents",
          role: "radiogroup",
          "aria-label": "Accent colour",
          onKeyDown: (event) => {
            const next = nextOption(accentOptions.map((a) => a.id), draft.accent, event.key);
            if (next === void 0) return;
            event.preventDefault();
            setDraft((prev) => ({ ...prev, accent: next }));
            event.currentTarget.querySelector(`[data-id="${next}"]`)?.focus();
          },
          children: accentOptions.map((accent) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              role: "radio",
              "data-id": accent.id,
              "aria-checked": draft.accent === accent.id,
              tabIndex: draft.accent === accent.id ? 0 : -1,
              className: "dshth-accent",
              onClick: () => setDraft((prev) => ({ ...prev, accent: accent.id })),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "span",
                  {
                    className: accent.swatch === void 0 ? "dshth-dot dshth-dot-auto" : "dshth-dot",
                    style: accent.swatch === void 0 ? void 0 : { background: accent.swatch },
                    "aria-hidden": "true"
                  }
                ),
                accent.label
              ]
            },
            accent.id
          ))
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshth-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshth-legend", children: "Contrast" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshth-hint", children: "Pushes surfaces and text apart without touching the theme\u2019s accent, states or syntax colours \u2014 so you can have any palette at any legibility, instead of the two being the same choice." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth-slider-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "range",
            className: "dshth-slider",
            min: 0,
            max: CONTRAST_LEVELS.length - 1,
            step: 1,
            value: Math.max(0, CONTRAST_LEVELS.findIndex((l) => l.id === draft.contrast)),
            "aria-label": "Contrast",
            "aria-valuetext": findContrast(draft.contrast)?.label ?? "Regular",
            onChange: (event) => setDraft((prev) => ({ ...prev, contrast: CONTRAST_LEVELS[Number(event.target.value)].id }))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-slider-value", children: findContrast(draft.contrast)?.label ?? "Regular" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth-slider-ticks", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: CONTRAST_LEVELS[0].label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1].label })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshth-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshth-legend", children: "UI scale" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshth-hint", children: "Scales the whole interface \u2014 text, controls and spacing together, like browser zoom. A text-only size control is not possible from a plugin: the harness sets most of its font sizes literally rather than through a token." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth-slider-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "range",
            className: "dshth-slider",
            min: 0,
            max: SCALE_LEVELS.length - 1,
            step: 1,
            value: Math.max(0, SCALE_LEVELS.findIndex((l) => l.id === draft.scale)),
            "aria-label": "Interface scale",
            "aria-valuetext": findScale(draft.scale)?.label ?? "100%",
            onChange: (event) => setDraft((prev) => ({ ...prev, scale: SCALE_LEVELS[Number(event.target.value)].id }))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-slider-value", children: findScale(draft.scale)?.label ?? "100%" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth-slider-ticks", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: SCALE_LEVELS[0].label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: SCALE_LEVELS[SCALE_LEVELS.length - 1].label })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshth-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshth-legend", children: "Font" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshth-hint", children: "One face for the whole interface, code included. Everything but Default ships inside the plugin, so it renders the same on every machine with nothing to install \u2014 the column on the right says which you are getting." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: "dshth-fonts",
          role: "radiogroup",
          "aria-label": "Interface font",
          onKeyDown: (event) => {
            const ids = FONTS.map((f) => f.id);
            const next = nextOption(ids, draft.font, event.key);
            if (next === void 0) return;
            event.preventDefault();
            setDraft((prev) => ({ ...prev, font: next }));
            event.currentTarget.querySelector(`[data-id="${next}"]`)?.focus();
          },
          children: FONTS.map((font) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              role: "radio",
              "data-id": font.id,
              "aria-checked": draft.font === font.id,
              tabIndex: draft.font === font.id ? 0 : -1,
              className: "dshth-font",
              style: { fontFamily: font.ui },
              onClick: () => setDraft((prev) => ({ ...prev, font: font.id })),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-font-name", children: font.label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-font-blurb", children: font.blurb }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-font-resolved", children: font.bundled ? "bundled" : resolved.get(font.id)?.family ?? "" })
              ]
            },
            font.id
          ))
        }
      )
    ] }),
    dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshth-bar", role: "group", "aria-label": "Unsaved appearance changes", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshth-bar-text", children: "Previewing \u2014 not saved yet." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dshth-btn", onClick: revert, children: "Revert" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dshth-btn dshth-btn-primary", onClick: apply2, children: "Apply" })
    ] }) : null
  ] });
}
function apply(ctx) {
  const theme = ctx.theme;
  injectStyles();
  ctx.effect(() => {
    applySelection(theme, loadSelection());
    return () => retractAll(theme);
  }, "dsh-theme: apply stored selection");
  const Panel = (props) => import_react.default.createElement(ThemePanel, { ...props, ctx });
  ctx.effect(
    () => ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "dsh-theme",
          order: 15,
          label: () => "Themes"
        },
        Panel
      )
    ),
    "dsh-theme: settings.section registration"
  );
}

		return module.exports;
	}
});