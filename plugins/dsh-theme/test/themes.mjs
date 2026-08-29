/**
 * Catalogue suite: validates every shipped theme, accent and font pairing
 * against the built host half (`lib/index.js`), with no DOM.
 *
 * This is the gate that makes "add a lot of themes" safe. A new theme file is
 * data, and data goes wrong quietly: a typo'd hex renders as an unset custom
 * property (the browser keeps the stock value and nothing looks broken), and a
 * pretty-but-unreadable grey only shows up when someone tries to read a
 * timestamp. Both fail here instead.
 *
 * The contrast floors are deliberately not uniform AAA. They encode where
 * legibility actually matters, and they are calibrated to what the harness
 * itself ships: DeepSeek's own `state-warn-primary` is #f59e0b, which is
 * 2.1:1 on white, so demanding 3:1 of a theme's amber would hold themes to a
 * standard the product does not meet.
 */
import assert from 'node:assert/strict'
import {
  ACCENTS,
  CONTRAST_LEVELS,
  DEFAULT_FONT,
  COOKIE,
  DEFAULT_SCALE,
  SCALE_LEVELS,
  SCALE_RULE,
  SCALE_TOKEN,
  THEME_ALIASES,
  findTheme,
  scalePairs,
  withContrast,
  DEFAULT_ACCENT,
  DEFAULT_SELECTION,
  FONTS,
  fontPairs,
  THEMES,
  buildTokens,
  contrast,
  familiesOf,
  formatSelection,
  legibleFill,
  paletteRoles,
  parse,
  parseSelection,
  readCookie,
  schemeToRestore,
  themePairs,
} from '../lib/index.js'

let checks = 0
const failures = []

/**
 * Run one check, recording its failure instead of throwing.
 *
 * Adding a theme usually trips several floors at once, and a suite that dies
 * on the first one turns that into a build-fix-build loop. Every failure is
 * reported together so the palette can be corrected in a single pass.
 */
const check = (label, fn) => {
  checks += 1
  try {
    fn()
  } catch (error) {
    failures.push(`${label}: ${error instanceof assert.AssertionError ? error.message : String(error)}`)
  }
}

/** Contrast floors, by role. */
const FLOOR = {
  /** Body text on its own background: WCAG AA for normal text. */
  primary: 4.5,
  /** Secondary text is still prose someone has to read. */
  secondary: 4.5,
  /** Captions and timestamps: AA for large text / incidental UI. */
  tertiary: 3.0,
  /** Non-text contrast for a colour used as a fill, border and focus ring. */
  accent: 3.0,
  /** Errors are the one state colour you must never miss. */
  error: 3.0,
  /** Success and warning are fills first; a hue floor catches inversions. */
  state: 2.0,
  /** Code has to be read character by character. */
  code: 4.5,
  /** Comments are secondary but still read. */
  comment: 3.0,
}

const ratio = (a, b) => contrast(a, b)

// --- themes ----------------------------------------------------------------

check('catalogue is non-empty', () => {
  assert.ok(THEMES.length >= 1, 'no themes shipped')
})

check('theme ids are unique and url-safe', () => {
  const seen = new Set()
  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z0-9-]+$/, `theme id "${theme.id}" is not kebab-case`)
    assert.ok(!seen.has(theme.id), `duplicate theme id "${theme.id}"`)
    seen.add(theme.id)
    assert.ok(theme.label.length > 0, `${theme.id} has no label`)
    assert.ok(theme.blurb.length > 0, `${theme.id} has no blurb`)
  }
})

for (const theme of THEMES) {
  for (const mode of ['light', 'dark']) {
    const p = theme.variants[mode]
    const where = `${theme.id}/${mode}`

    check(`${where}: every authored colour parses`, () => {
      const colours = [
        p.bg, p.surface, p.overlay, p.fg, p.muted, p.faint, p.border,
        p.accent, p.error, p.success, p.warn,
        p.info, p.sidebar, p.accentFg, p.bubble,
        ...Object.values(p.code),
      ].filter((value) => value !== undefined)
      for (const colour of colours) parse(colour)
    })

    check(`${where}: text clears its contrast floor`, () => {
      for (const surface of [p.bg, p.surface]) {
        assert.ok(
          ratio(p.fg, surface) >= FLOOR.primary,
          `${where}: fg ${p.fg} on ${surface} is ${ratio(p.fg, surface).toFixed(2)}:1, floor ${FLOOR.primary}`,
        )
        assert.ok(
          ratio(p.muted, surface) >= FLOOR.secondary,
          `${where}: muted ${p.muted} on ${surface} is ${ratio(p.muted, surface).toFixed(2)}:1, floor ${FLOOR.secondary}`,
        )
        assert.ok(
          ratio(p.faint, surface) >= FLOOR.tertiary,
          `${where}: faint ${p.faint} on ${surface} is ${ratio(p.faint, surface).toFixed(2)}:1, floor ${FLOOR.tertiary}`,
        )
      }
    })

    check(`${where}: accent and state colours are distinguishable`, () => {
      assert.ok(ratio(p.accent, p.bg) >= FLOOR.accent, `${where}: accent ${ratio(p.accent, p.bg).toFixed(2)}:1`)
      assert.ok(ratio(p.error, p.bg) >= FLOOR.error, `${where}: error ${ratio(p.error, p.bg).toFixed(2)}:1`)
      assert.ok(ratio(p.success, p.bg) >= FLOOR.state, `${where}: success ${ratio(p.success, p.bg).toFixed(2)}:1`)
      assert.ok(ratio(p.warn, p.bg) >= FLOOR.state, `${where}: warn ${ratio(p.warn, p.bg).toFixed(2)}:1`)
    })

    check(`${where}: code reads on its own background`, () => {
      const codeFg = p.code.fg ?? p.fg
      assert.ok(ratio(codeFg, p.code.bg) >= FLOOR.code, `${where}: code fg ${ratio(codeFg, p.code.bg).toFixed(2)}:1`)
      assert.ok(
        ratio(p.code.comment, p.code.bg) >= FLOOR.comment,
        `${where}: comment ${ratio(p.code.comment, p.code.bg).toFixed(2)}:1`,
      )
      for (const role of ['keyword', 'string', 'constant', 'function', 'parameter', 'punctuation', 'link']) {
        assert.ok(
          ratio(p.code[role], p.code.bg) >= FLOOR.comment,
          `${where}: ${role} ${ratio(p.code[role], p.code.bg).toFixed(2)}:1`,
        )
      }
    })

    check(`${where}: the primary control is visible and its icon legible`, () => {
      // dsh's send button reads this token and hardcodes a white icon, so the
      // fill has to clear two bars at once: the glyph on it, and its own edge
      // against the page. 3:1 each, because the content is an icon.
      const tokens = buildTokens(p, mode)
      const fill = tokens['--dsw-alias-button-info-fill']
      assert.ok(
        ratio(fill, '#ffffff') >= 3.0,
        `${where}: send-button icon is ${ratio(fill, '#ffffff').toFixed(2)}:1 on ${fill}`,
      )
      assert.ok(
        ratio(fill, p.bg) >= 3.0,
        `${where}: send button is ${ratio(fill, p.bg).toFixed(2)}:1 against the page`,
      )
    })

    check(`${where}: the accent reaches the surfaces that show it`, () => {
      // An accent routed only to tokens the UI never paints is applied and
      // invisible — the defect this list exists to prevent. These are the
      // surfaces a colour scan found actually carrying it.
      const tokens = buildTokens(p, mode)
      for (const token of [
        '--dsw-alias-state-business-primary',
        '--dsw-static-blue-500',
        '--dsw-static-blue-450',
        '--dsw-static-deepseek-500',
        '--dsw-alias-brand-primary',
      ]) {
        assert.equal(tokens[token], p.accent, `${where}: ${token} is not the theme accent`)
      }
      // state-business-primary is drawn as TEXT on the page, so it has to clear
      // the non-text bar against the background it sits on.
      assert.ok(
        ratio(tokens['--dsw-alias-state-business-primary'], p.bg) >= 3.0,
        `${where}: accent-as-text is ${ratio(tokens['--dsw-alias-state-business-primary'], p.bg).toFixed(2)}:1`,
      )
    })

    check(`${where}: the tinted selection row keeps its label legible`, () => {
      // The active session row is now accent-tinted rather than a neutral lift.
      // It is a BACKGROUND under label-primary, so the tint must not eat the text.
      const tokens = buildTokens(p, mode)
      const row = tokens['--dsw-specific-sidebar-nav-item-active']
      assert.ok(
        ratio(p.fg, row) >= FLOOR.primary,
        `${where}: label on the selected row is ${ratio(p.fg, row).toFixed(2)}:1 over ${row}`,
      )
    })

    check(`${where}: the hover palette resolves every role`, () => {
      // The strip shown on card hover must reflect what the theme will really
      // look like, so optional fields appear as their derived value, never blank.
      const roles = paletteRoles(p, mode)
      assert.ok(roles.length >= 14, `${where}: only ${roles.length} roles shown`)
      for (const { role, color } of roles) {
        assert.ok(typeof color === 'string' && color.length > 0, `${where}: role "${role}" has no colour`)
        parse(color)
      }
      const names = roles.map((r) => r.role)
      assert.equal(new Set(names).size, names.length, `${where}: duplicate role in the strip`)
      for (const required of ['bg', 'fg', 'accent', 'sidebar', 'info']) {
        assert.ok(names.includes(required), `${where}: strip omits "${required}"`)
      }
    })

    check(`${where}: the token map is complete and well-formed`, () => {
      const tokens = buildTokens(p, mode)
      // The builder covers the whole semantic layer the harness declares plus
      // the ramp slots components read directly; a big drop means a regression
      // in the builder rather than in this theme.
      assert.ok(Object.keys(tokens).length >= 100, `${where}: only ${Object.keys(tokens).length} tokens`)
      for (const [name, value] of Object.entries(tokens)) {
        assert.match(name, /^--[a-z0-9-]+$/, `${where}: "${name}" is not a custom property name`)
        assert.equal(typeof value, 'string', `${where}: ${name} is not a string`)
        assert.ok(value.length > 0, `${where}: ${name} is empty`)
        assert.ok(!value.includes('undefined'), `${where}: ${name} = "${value}" leaked an undefined`)
        assert.ok(!value.includes('NaN'), `${where}: ${name} = "${value}" leaked a NaN`)
      }
    })
  }

  check(`${theme.id}: pairs carry both modes for every token`, () => {
    const pairs = themePairs(theme)
    const light = buildTokens(theme.variants.light, 'light')
    const dark = buildTokens(theme.variants.dark, 'dark')
    assert.deepEqual(
      Object.keys(pairs).sort(),
      [...new Set([...Object.keys(light), ...Object.keys(dark)])].sort(),
      `${theme.id}: pair key set does not match the two variants`,
    )
    for (const [name, modes] of Object.entries(pairs)) {
      // The runtime rejects a bare string with a teaching error; both sides
      // must be present or a scheme flip leaves the token on the stock value.
      assert.equal(typeof modes.light, 'string', `${theme.id}: ${name} has no light value`)
      assert.equal(typeof modes.dark, 'string', `${theme.id}: ${name} has no dark value`)
    }
  })

  check(`${theme.id}: a pinned scheme names a real mode`, () => {
    if (theme.pinScheme === undefined) return
    assert.ok(
      theme.pinScheme === 'light' || theme.pinScheme === 'dark',
      `${theme.id}: pinScheme "${theme.pinScheme}" is not a base palette`,
    )
  })
}

// --- accents ---------------------------------------------------------------

check('accent ids are unique and their colours parse', () => {
  const seen = new Set()
  for (const accent of ACCENTS) {
    assert.match(accent.id, /^[a-z0-9-]+$/, `accent id "${accent.id}" is not kebab-case`)
    assert.ok(!seen.has(accent.id), `duplicate accent id "${accent.id}"`)
    seen.add(accent.id)
    parse(accent.light)
    parse(accent.dark)
  }
})

check('the catalogue holds no "no accent" sentinel', () => {
  // "Theme default" means the absence of a layer; it belongs to the picker, not
  // to data that every other consumer then has to special-case.
  assert.ok(
    !ACCENTS.some((accent) => accent.id === DEFAULT_ACCENT),
    `"${DEFAULT_ACCENT}" must not be a catalogue entry`,
  )
})

check('every accent yields a usable primary fill on both base palettes', () => {
  for (const accent of ACCENTS) {
    for (const [surface, hue] of [['#ffffff', accent.light], ['#1b1b1c', accent.dark]]) {
      const fill = legibleFill(hue, surface)
      assert.ok(
        ratio(fill, '#ffffff') >= 3.0,
        `accent ${accent.id}: icon ${ratio(fill, '#ffffff').toFixed(2)}:1 on ${fill}`,
      )
      assert.ok(
        ratio(fill, surface) >= 3.0,
        `accent ${accent.id}: fill ${ratio(fill, surface).toFixed(2)}:1 against ${surface}`,
      )
    }
  }
})

check('legibleFill leaves an accent alone when it already works', () => {
  // A mid-tone blue on white already clears both bars, so nothing should move.
  const fill = legibleFill('#2563eb', '#ffffff')
  assert.equal(fill, '#2563eb', 'an already-usable accent must not be altered')
})

check('every accent is visible on the base palettes it targets', () => {
  for (const accent of ACCENTS) {
    assert.ok(
      ratio(accent.light, '#ffffff') >= FLOOR.accent,
      `accent ${accent.id} light is ${ratio(accent.light, '#ffffff').toFixed(2)}:1 on white`,
    )
    assert.ok(
      ratio(accent.dark, '#151517') >= FLOOR.accent,
      `accent ${accent.id} dark is ${ratio(accent.dark, '#151517').toFixed(2)}:1 on the dark base`,
    )
  }
})

// --- contrast --------------------------------------------------------------
//
// The whole point of the axis is that legibility and palette are independent,
// so the only invariant that matters is directional: raising the level must
// never lower a measured ratio, for any theme, in either mode.

check('contrast levels are ordered and start at "as authored"', () => {
  assert.equal(CONTRAST_LEVELS[0].amount, 0, 'the first level must leave the palette untouched')
  for (let i = 1; i < CONTRAST_LEVELS.length; i++) {
    assert.ok(
      CONTRAST_LEVELS[i].amount > CONTRAST_LEVELS[i - 1].amount,
      `level ${CONTRAST_LEVELS[i].id} does not increase on ${CONTRAST_LEVELS[i - 1].id}`,
    )
  }
})

for (const theme of THEMES) {
  for (const mode of ['light', 'dark']) {
    check(`${theme.id}/${mode}: raising contrast never lowers contrast`, () => {
      let previous = null
      for (const level of CONTRAST_LEVELS) {
        const p = withContrast(theme.variants[mode], mode, level.amount)
        const measured = {
          fg: ratio(p.fg, p.bg),
          muted: ratio(p.muted, p.bg),
          faint: ratio(p.faint, p.bg),
          code: ratio(p.code.fg ?? p.fg, p.code.bg),
        }
        if (previous !== null) {
          for (const role of Object.keys(measured)) {
            assert.ok(
              // A hair of tolerance: these are 8-bit channel mixes, so a step
              // can round to the same ratio without having gone backwards.
              measured[role] >= previous[role] - 0.01,
              `${theme.id}/${mode} ${role}: ${level.id} is ${measured[role].toFixed(2)}:1, below the previous ${previous[role].toFixed(2)}:1`,
            )
          }
        }
        previous = measured
      }
    })
  }
}

check('maximum contrast is meaningfully higher than authored', () => {
  const max = CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1]
  for (const theme of THEMES) {
    for (const mode of ['light', 'dark']) {
      const authored = theme.variants[mode]
      const pushed = withContrast(authored, mode, max.amount)
      // Bumble Bee is already at 21:1, so it cannot gain — everything else must.
      if (ratio(authored.fg, authored.bg) > 19) continue
      assert.ok(
        ratio(pushed.fg, pushed.bg) > ratio(authored.fg, authored.bg) + 0.5,
        `${theme.id}/${mode}: maximum only reached ${ratio(pushed.fg, pushed.bg).toFixed(2)}:1 from ${ratio(authored.fg, authored.bg).toFixed(2)}:1`,
      )
    }
  }
})

check('contrast leaves the theme’s identity colours alone', () => {
  // This is the reason the axis exists: any palette at any legibility.
  for (const theme of THEMES) {
    for (const mode of ['light', 'dark']) {
      const authored = theme.variants[mode]
      const pushed = withContrast(authored, mode, 1)
      for (const role of ['accent', 'error', 'success', 'warn']) {
        assert.equal(pushed[role], authored[role], `${theme.id}/${mode}: contrast moved ${role}`)
      }
      assert.equal(pushed.code.keyword, authored.code.keyword, `${theme.id}/${mode}: contrast moved a syntax colour`)
    }
  }
})

// --- scale -----------------------------------------------------------------

check('scale levels are ordered and include an untouched 100%', () => {
  assert.ok(SCALE_LEVELS.some((l) => l.id === DEFAULT_SCALE && l.value === 1), 'no 1.0 level')
  for (let i = 1; i < SCALE_LEVELS.length; i++) {
    assert.ok(SCALE_LEVELS[i].value > SCALE_LEVELS[i - 1].value, 'scale levels are not ascending')
  }
})

check('the scale layer sets exactly the token its rule reads', () => {
  const pairs = scalePairs(SCALE_LEVELS[3])
  assert.deepEqual(Object.keys(pairs), [SCALE_TOKEN])
  assert.ok(SCALE_RULE.includes(SCALE_TOKEN), 'the injected rule does not read the token the layer sets')
  assert.ok(SCALE_RULE.includes('zoom'), 'the rule must scale via zoom — the only lever that moves hardcoded px')
})

// --- renames ---------------------------------------------------------------

check('a renamed theme id still resolves', () => {
  // Renaming without this silently resets everyone who had it selected.
  for (const [was, now] of Object.entries(THEME_ALIASES)) {
    assert.ok(findTheme(was) !== undefined, `alias "${was}" resolves to nothing`)
    assert.equal(findTheme(was)?.id, now, `alias "${was}" does not point at "${now}"`)
  }
  assert.equal(findTheme('high-contrast')?.id, 'bumble-bee')
})

// --- persistence -----------------------------------------------------------
//
// The selection rides a cookie because DSH Desktop serves the UI from a new
// ephemeral port every launch: localStorage is origin-scoped and would be
// empty each time, while cookies are not isolated by port.

check('a selection survives the round trip', () => {
  for (const theme of THEMES) {
    // Spread the defaults so adding an axis does not require editing this.
    const selection = {
      ...DEFAULT_SELECTION,
      theme: theme.id,
      accent: ACCENTS[0].id,
      font: FONTS[1].id,
    }
    assert.deepEqual(parseSelection(formatSelection(selection)), selection)
  }
})

check('a cookie written before the code axis existed still parses', () => {
  // Per-field fallback is what makes the format extensible in place: three
  // fields is what every selection saved before this axis looks like.
  assert.deepEqual(parseSelection('nord.teal.geist-mono'), {
    ...DEFAULT_SELECTION,
    theme: 'nord',
    accent: 'teal',
    font: 'geist-mono',
  })
})

check('the default selection round-trips', () => {
  assert.deepEqual(parseSelection(formatSelection(DEFAULT_SELECTION)), DEFAULT_SELECTION)
})

check('a malformed value falls back per field, not wholesale', () => {
  // A newer version writing a fourth axis must still yield a usable theme.
  assert.equal(parseSelection('nord.blue.geist-mono.-.high.125.extra').theme, 'nord')
  // A junk field takes the default while its siblings survive.
  assert.deepEqual(parseSelection('nord.NOT VALID.geist-mono'), {
    ...DEFAULT_SELECTION,
    theme: 'nord',
    font: 'geist-mono',
  })
  assert.deepEqual(parseSelection(''), DEFAULT_SELECTION)
  assert.deepEqual(parseSelection(undefined), DEFAULT_SELECTION)
  assert.deepEqual(parseSelection(null), DEFAULT_SELECTION)
})

check('a cookie is read out of a realistic jar', () => {
  const raw = 'gruvbox.teal.jetbrains-mono.-.high.125'
  const jar = `other=1; ${COOKIE}=${encodeURIComponent(raw)}; another=x`
  assert.equal(readCookie(jar, COOKIE), raw)
  assert.deepEqual(parseSelection(readCookie(jar, COOKIE)), {
    ...DEFAULT_SELECTION,
    theme: 'gruvbox',
    accent: 'teal',
    font: 'jetbrains-mono',
    contrast: 'high',
    scale: '125',
  })
})

check('a cookie whose name merely contains ours is not mistaken for it', () => {
  assert.equal(readCookie(`${COOKIE}-other=nope`, COOKIE), undefined)
  assert.equal(readCookie('nothing=here', COOKIE), undefined)
})

// --- preview restore -------------------------------------------------------
//
// Previewing a `pinScheme` theme writes a built-in preference, which the
// runtime persists. Backing out has to undo that, and only that.

check('backing out of a preview restores the scheme the page was opened with', () => {
  assert.equal(
    schemeToRestore(undefined, 'dark', 'system'),
    'system',
    'a preview that pinned dark must be undone on the way out',
  )
  assert.equal(schemeToRestore(undefined, 'light', 'dark'), 'dark')
})

check('an unchanged scheme is left alone', () => {
  assert.equal(schemeToRestore(undefined, 'system', 'system'), undefined)
  assert.equal(schemeToRestore(undefined, 'light', 'light'), undefined)
})

check('a theme that pins the scheme itself keeps it', () => {
  // Restoring TO a pinned theme must not undo its pin — that is the theme
  // working as designed, not a preview artefact.
  assert.equal(schemeToRestore('dark', 'dark', 'system'), undefined)
  assert.equal(schemeToRestore('light', 'light', 'dark'), undefined)
})

// --- fonts -----------------------------------------------------------------

check('a font stack parses into its families', () => {
  assert.deepEqual(familiesOf('Inter, "Segoe UI Variable Text", sans-serif'), [
    'Inter',
    'Segoe UI Variable Text',
    'sans-serif',
  ])
  assert.deepEqual(familiesOf("  'Fira Code' ,Consolas,  monospace "), [
    'Fira Code',
    'Consolas',
    'monospace',
  ])
  assert.deepEqual(familiesOf(''), [])
})

check('every font stack parses and names at least one real family', () => {
  for (const font of FONTS.flatMap(f => [{ id: f.id, stack: f.ui }, { id: f.id, stack: f.code }])) {
    for (const stack of [font.stack]) {
      const families = familiesOf(stack)
      assert.ok(families.length >= 2, `${font.id}: "${stack}" has no fallback`)
      // A stack of nothing but generics offers the user no actual choice.
      assert.ok(
        families.some((family) => !/^(sans-)?serif$|^monospace$|^system-ui$/.test(family)),
        `${font.id}: "${stack}" names no concrete family`,
      )
    }
  }
})

check('fonts are unique, complete, and end in a generic family', () => {
  const seen = new Set()
  for (const font of FONTS) {
    assert.match(font.id, /^[a-z0-9-]+$/, `font id "${font.id}" is not kebab-case`)
    assert.ok(!seen.has(font.id), `duplicate font id "${font.id}"`)
    seen.add(font.id)
    assert.ok(font.label.length > 0, `${font.id} has no label`)
    assert.ok(font.blurb.length > 0, `${font.id} has no blurb`)
    // A stack with no generic tail leaves the browser to pick when nothing in
    // the list is installed, which is how a themed UI ends up in Times.
    for (const stack of [font.ui, font.code]) {
      assert.match(
        stack,
        /(sans-serif|serif|monospace|system-ui)\s*$/,
        `font ${font.id} has a stack with no generic fallback`,
      )
    }
  }
})

check('one font choice drives both faces', () => {
  // Interface and code are a single axis: picking a face applies it to the
  // whole UI, code included, which is what people actually want from it.
  for (const font of FONTS) {
    assert.deepEqual(
      Object.keys(fontPairs(font)).sort(),
      ['--ds-font-family-code', '--dsw-font-family'],
      `${font.id} does not set both faces`,
    )
  }
})

check('every non-default face is bundled', () => {
  // A named face that is not installed falls through silently and looks like a
  // setting that did nothing. Bundling is what removes that failure mode, so
  // the catalogue only carries faces we can legally ship.
  for (const font of FONTS) {
    if (font.id === DEFAULT_FONT) {
      assert.equal(font.bundled, false, 'the default entry must not claim to be bundled')
      continue
    }
    assert.equal(font.bundled, true, `${font.id} is neither the default nor bundled`)
    const first = font.ui.split(',')[0].trim().replace(/^["']|["']$/g, '')
    assert.equal(
      first,
      font.code.split(',')[0].trim().replace(/^["']|["']$/g, ''),
      `${font.id} leads with different faces for interface and code`,
    )
  }
})

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`)
  console.error(`\n${failures.length} of ${checks} checks failed`)
  process.exit(1)
}

console.log(`ok — ${checks} checks over ${THEMES.length} themes, ${ACCENTS.length} accents, ${FONTS.length} fonts, ${CONTRAST_LEVELS.length} contrast + ${SCALE_LEVELS.length} scale steps`)
