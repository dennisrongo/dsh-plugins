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

// src/storage.ts
var DEFAULT_SELECTION = {
  theme: STOCK_THEME,
  accent: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  contrast: DEFAULT_CONTRAST,
  scale: DEFAULT_SCALE
};
var COOKIE = "dsh-theme";
var RESERVED = "-";
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

// src/boot.ts
var FIRST_PAINT = [
  "--dsw-alias-bg-base",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-layer-3",
  "--dsw-alias-bg-overlay",
  "--dsw-specific-sidebar-fill",
  "--dsw-specific-sidebar-nav-item-hover",
  "--dsw-specific-input-major",
  "--dsw-specific-menu",
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-brand-primary"
];
var KEY_THEME = "dsh-theme:theme";
var KEY_FONT = "dsh-theme:font";
var KEY_SCALE = "dsh-theme:scale";
function themeTable() {
  const table = {};
  for (const theme of THEMES) {
    const light = buildTokens(theme.variants.light, "light");
    const dark = buildTokens(theme.variants.dark, "dark");
    table[theme.id] = {
      l: FIRST_PAINT.map((name) => light[name] ?? ""),
      d: FIRST_PAINT.map((name) => dark[name] ?? "")
    };
  }
  for (const [was, now] of Object.entries(THEME_ALIASES)) {
    if (table[now] !== void 0) table[was] = table[now];
  }
  return table;
}
function scaleTable() {
  const table = {};
  for (const level of SCALE_LEVELS) table[level.id] = level.value;
  return table;
}
function fontTable() {
  const table = {};
  for (const font of FONTS) table[font.id] = [font.ui, font.code];
  return table;
}
function bootScript() {
  const names = JSON.stringify(FIRST_PAINT);
  const themes = JSON.stringify(themeTable());
  const fonts = JSON.stringify(fontTable());
  const scales = JSON.stringify(scaleTable());
  return `(() => {
  try {
    var N = ${names}, T = ${themes}, F = ${fonts}, S = ${scales};
    var paint = function () {
      var body = document.body
      if (!body) return
      // The harness's own bootstrap sets BOTH the body attribute and the root
      // colorScheme, so a set colorScheme means it has run and the attribute is
      // authoritative. Otherwise we are ahead of it and the OS is the best
      // guess; the DOMContentLoaded repaint below corrects that case.
      var booted = document.documentElement.style.colorScheme !== ''
      var dark = booted
        ? body.hasAttribute('data-ds-dark-theme')
        : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
      // Cookie first, for the same reason the plugin writes one: DSH Desktop
      // serves from a new ephemeral port every launch, so localStorage is a
      // fresh origin each time while the cookie survives (cookies are not
      // isolated by port). Without this the flash fix would work on the CLI
      // and fail on the Desktop, which is where it matters most.
      var themeId = null, fontId = null, scaleId = null
      try {
        var jar = document.cookie || ''
        for (var c = 0, parts = jar.split(';'); c < parts.length; c++) {
          var eq = parts[c].indexOf('=')
          if (eq === -1 || parts[c].slice(0, eq).trim() !== ${JSON.stringify(COOKIE)}) continue
          var fields = decodeURIComponent(parts[c].slice(eq + 1).trim()).split('.')
          themeId = fields[0] || null
          fontId = fields[2] || null
          scaleId = fields[5] || null
          break
        }
      } catch (e) {}
      if (themeId === null) {
        try {
          themeId = localStorage.getItem(${JSON.stringify(KEY_THEME)})
          fontId = localStorage.getItem(${JSON.stringify(KEY_FONT)})
          scaleId = localStorage.getItem(${JSON.stringify(KEY_SCALE)})
        } catch (e) {}
      }
      var row = themeId && T[themeId]
      if (row) {
        var values = dark ? row.d : row.l
        for (var i = 0; i < N.length; i++) if (values[i]) body.style.setProperty(N[i], values[i])
      }
      var font = fontId && F[fontId]
      if (font) {
        body.style.setProperty('--dsw-font-family', font[0])
        body.style.setProperty('--ds-font-family-code', font[1])
      }
      // Scale needs its rule present before #root exists, or the shell paints
      // once at 100% and jumps. The rule is idempotent \u2014 the client bundle
      // injects the same text later.
      var scale = scaleId && S[scaleId]
      if (scale && scale !== 1) {
        body.style.setProperty(${JSON.stringify(SCALE_TOKEN)}, String(scale))
        if (!document.getElementById('dshth-scale')) {
          var tag = document.createElement('style')
          tag.id = 'dshth-scale'
          tag.textContent = ${JSON.stringify(SCALE_RULE)}
          document.head.appendChild(tag)
        }
      }
    }
    paint()
    document.addEventListener('DOMContentLoaded', paint, { once: true })
  } catch (e) {}
})()`;
}
function bootInjection() {
  return { kind: "script", placement: "body", text: bootScript() };
}

// src/detect.ts
function familiesOf(stack) {
  return stack.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "").trim()).filter((part) => part.length > 0);
}

// src/layers.ts
function schemeToRestore(pinned, current, enteredWith) {
  if (pinned !== void 0) return void 0;
  return current === enteredWith ? void 0 : enteredWith;
}

// src/index.ts
function apply(ctx) {
  if (typeof ctx?.on !== "function") return;
  ctx.on("webserver/index-inject", (table) => {
    table.push(bootInjection());
  });
}
export {
  ACCENTS,
  CONTRAST_LEVELS,
  COOKIE,
  DEFAULT_ACCENT,
  DEFAULT_CONTRAST,
  DEFAULT_FONT,
  DEFAULT_SCALE,
  DEFAULT_SELECTION,
  FONTS,
  SCALE_LEVELS,
  SCALE_RULE,
  SCALE_TOKEN,
  STOCK_THEME,
  THEMES,
  THEME_ALIASES,
  accentPairs,
  alpha,
  apply,
  bootInjection,
  bootScript,
  buildTokens,
  contrast,
  css,
  familiesOf,
  findAccent,
  findContrast,
  findFont,
  findScale,
  findTheme,
  fontPairs,
  formatSelection,
  legibleFill,
  luminance,
  mix,
  paletteRoles,
  parse,
  parseSelection,
  readCookie,
  readable,
  scalePairs,
  schemeToRestore,
  themePairs,
  withContrast
};
