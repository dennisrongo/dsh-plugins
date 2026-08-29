/**
 * dsh-theme — themes, accents and font pairings for the DeepSeek Harness UI.
 *
 * A pure-consumer client plugin. It owns no palette of its own at runtime:
 * everything it does is three `ctx.theme.overrideTokens` layers over whatever
 * base palette the user's light/dark/system preference selects, plus one
 * `settings.section` page to pick them. See `layers.ts` for why the selection
 * lives in localStorage and why a theme is a layer rather than a registered
 * theme id.
 *
 * CSS classes are namespaced `dshth-`; service access is per-fiber via
 * `export const inject`.
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ACCENTS, DEFAULT_ACCENT, DEFAULT_ACCENT_LABEL } from './accents.ts'
import { CONTRAST_LEVELS, findContrast } from './contrast.ts'
import { resolvedFamily } from './detect.ts'
import { FONT_FACES } from './font-faces.ts'
import { DEFAULT_FONT, FONTS } from './fonts.ts'
import { STOCK_THEME, THEMES, findTheme } from './themes/index.ts'
import { applySelection, retractAll, schemeToRestore, type ThemeService } from './layers.ts'
import { loadSelection, saveSelection, type Selection } from './storage.ts'
import { SCALE_LEVELS, SCALE_RULE, findScale } from './scale.ts'
import { paletteRoles } from './tokens.ts'
import type { Mode, ThemeSpec } from './types.ts'

/**
 * Required services. `theme` is the harness's own theme runtime — a harness
 * without it never activates this fiber, which is the intended degradation.
 */
export const inject = ['slots', 'theme']

/** Held for the duration of a preview so arrow-key repeat cannot thrash. */
const PREVIEW_DEBOUNCE_MS = 90

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
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
   This is a local reveal, not a preview — nothing is applied on hover. */
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
/* What the stack actually resolves to here — drawn in the UI font, not the
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
`

let stylesInjected = false
/** Inject the panel stylesheet once per page. */
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dennisrongo/dsh-theme'
  tag.textContent = STYLES
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// Radio-group keyboard behaviour
// ---------------------------------------------------------------------------

/**
 * Arrow-key handling for a `role="radiogroup"`: arrows move AND select, which
 * is what makes keyboard preview work the same way clicking does.
 * @param ids - option ids in visual order.
 * @param current - the selected id.
 * @param key - the pressed key.
 * @param columns - grid width, so Up/Down step a row rather than an item.
 * @returns the id to select next, or undefined when the key is not ours.
 */
export function nextOption(
  ids: readonly string[],
  current: string,
  key: string,
  columns = 1,
): string | undefined {
  const at = ids.indexOf(current)
  if (at === -1) return ids[0]
  const step =
    key === 'ArrowRight' ? 1
    : key === 'ArrowLeft' ? -1
    : key === 'ArrowDown' ? columns
    : key === 'ArrowUp' ? -columns
    : 0
  if (step === 0) {
    if (key === 'Home') return ids[0]
    if (key === 'End') return ids[ids.length - 1]
    return undefined
  }
  // Wrap, so a grid never traps focus at an edge.
  const next = (at + step + ids.length * 2) % ids.length
  return ids[next]
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** The three swatches shown on a theme card, for the active base palette. */
function chipsOf(spec: ThemeSpec, mode: Mode): string[] {
  const palette = spec.variants[mode]
  return [palette.bg, palette.surface, palette.accent]
}

interface PanelProps {
  /** Close the settings panel; the shell owns open state. */
  close?: () => void
  /** The plugin's context, bound at registration. */
  ctx: ClientContext
}

/**
 * The Themes settings page: pick a theme, an accent and a font pairing, with
 * the whole app previewing the choice live and an explicit Apply/Revert.
 * @param props - owner share plus the bound context.
 * @returns the page element tree.
 */
function ThemePanel({ ctx }: PanelProps): React.JSX.Element {
  const theme = (ctx as unknown as { theme: ThemeService }).theme
  const [committed, setCommitted] = React.useState<Selection>(loadSelection)
  const [draft, setDraft] = React.useState<Selection>(committed)
  const [mode, setMode] = React.useState<Mode>(() => theme.getTheme().active.colorScheme)

  React.useEffect(() => injectStyles(), [])

  // Chips and previews describe the palette the user is actually in, so the
  // page has to follow a light/dark flip made from the built-in Appearance row
  // while this page is open.
  React.useEffect(() => {
    const off = (ctx as unknown as {
      on: (event: string, cb: (snapshot: { active: { colorScheme: Mode } }) => void) => () => void
    }).on('theme/change', (snapshot) => {
      setMode(snapshot.active.colorScheme)
    })
    return off
  }, [ctx])

  // Preview: one trailing-debounced apply, so holding an arrow key repaints
  // once per pause rather than once per repeat.
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  React.useEffect(() => {
    const timer = window.setTimeout(() => applySelection(theme, draftRef.current), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, theme])

  // Leaving the page with an uncommitted preview restores what was committed.
  // This covers the modal being closed mid-preview, which unmounts the section
  // without any chance to ask.
  //
  // The base colour scheme needs restoring too. Previewing a `pinScheme` theme
  // writes a built-in preference through `setTheme` — a DURABLE write — so
  // without this, glancing at a single-mode theme would leave the user's
  // Light/Dark setting changed after they backed out.
  const committedRef = React.useRef(committed)
  committedRef.current = committed
  const enteredWith = React.useRef(theme.getTheme().preference)
  const restore = React.useCallback(
    (selection: Selection) => {
      applySelection(theme, selection)
      const scheme = schemeToRestore(
        findTheme(selection.theme)?.pinScheme,
        theme.getTheme().preference,
        enteredWith.current,
      )
      if (scheme !== undefined) theme.setTheme(scheme)
    },
    [theme],
  )
  const restoreRef = React.useRef(restore)
  restoreRef.current = restore
  React.useEffect(
    () => () => {
      restoreRef.current(committedRef.current)
    },
    [],
  )

  const dirty =
    draft.theme !== committed.theme ||
    draft.accent !== committed.accent ||
    draft.font !== committed.font ||
    draft.contrast !== committed.contrast ||
    draft.scale !== committed.scale

  const apply = (): void => {
    saveSelection(draft)
    setCommitted(draft)
    applySelection(theme, draft)
    // A pinned scheme is now the user's choice, so it becomes the baseline the
    // unmount restore compares against rather than something to undo.
    enteredWith.current = theme.getTheme().preference
  }
  const revert = (): void => {
    setDraft(committed)
    restore(committed)
  }

  // "No layer" leads each list: the harness's own palette, and the theme's own
  // accent. Neither is a catalogue entry — they mean the absence of one — so
  // the picker adds them here rather than the data carrying a sentinel row.
  const accentOptions: { id: string; label: string; swatch?: string }[] = [
    { id: DEFAULT_ACCENT, label: DEFAULT_ACCENT_LABEL },
    ...ACCENTS.map((accent) => ({ id: accent.id, label: accent.label, swatch: accent[mode] })),
  ]
  // What each stack actually resolves to here. A system stack names the best
  // face per platform and falls through the rest, so two presets can land on
  // the same installed family and look identical — saying so is the difference
  // between "nothing happened" and "this machine has no Inter".
  const resolved = React.useMemo(() => {
    const systemFamily = resolvedFamily(FONTS.find((f) => f.id === DEFAULT_FONT)?.ui ?? '')
    return new Map(
      FONTS.map((font) => {
        const family = resolvedFamily(font.ui)
        const sameAsSystem = font.id !== DEFAULT_FONT && family === systemFamily
        return [font.id, { family, sameAsSystem }]
      }),
    )
  }, [])


  const themeIds = [STOCK_THEME, ...THEMES.map((t) => t.id)]
  const cards: {
    id: string
    label: string
    blurb: string
    chips: string[]
    palette: { role: string; color: string }[]
  }[] = [
    {
      id: STOCK_THEME,
      label: 'DeepSeek',
      blurb: 'The palette the harness ships with.',
      chips:
        mode === 'dark'
          ? ['#151517', '#232324', '#f9fafb']
          : ['#ffffff', '#f9fafb', '#0f1115'],
      palette: [],
    },
    ...THEMES.map((spec) => ({
      id: spec.id,
      label: spec.label,
      blurb: spec.blurb,
      chips: chipsOf(spec, mode),
      palette: paletteRoles(spec.variants[mode], mode),
    })),
  ]

  return (
    <div className="dshth">
      <div>
        <h2 className="dshth-title">Themes</h2>
        <p className="dshth-intro">
          Themes layer over your Light/Dark/System choice in General — each one ships both
          palettes, so switching appearance keeps the theme. Changes preview immediately;
          nothing is saved until you apply.
        </p>
      </div>

      <section className="dshth-group">
        <h3 className="dshth-legend">Theme</h3>
        <div
          className="dshth-themes"
          role="radiogroup"
          aria-label="Theme"
          onKeyDown={(event) => {
            const next = nextOption(themeIds, draft.theme, event.key, 2)
            if (next === undefined) return
            event.preventDefault()
            setDraft((prev) => ({ ...prev, theme: next }))
            const node = event.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)
            node?.focus()
          }}
        >
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              role="radio"
              data-id={card.id}
              {...(card.palette.length > 0 ? { 'data-palette': '' } : {})}
              aria-checked={draft.theme === card.id}
              tabIndex={draft.theme === card.id ? 0 : -1}
              className="dshth-card"
              onClick={() => setDraft((prev) => ({ ...prev, theme: card.id }))}
            >
              <span className="dshth-chips" aria-hidden="true">
                {card.chips.map((color, i) => (
                  <span className="dshth-chip" key={i} style={{ background: color }} />
                ))}
              </span>
              <span className="dshth-card-text">
                <span className="dshth-card-name">{card.label}</span>
                <span className="dshth-card-blurb">{card.blurb}</span>
                {card.palette.length > 0 ? (
                  <span className="dshth-card-palette" aria-hidden="true">
                    {card.palette.map((entry) => (
                      <span
                        key={entry.role}
                        className="dshth-swatch"
                        style={{ background: entry.color }}
                        title={`${entry.role} ${entry.color}`}
                      />
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="dshth-group">
        <h3 className="dshth-legend">Accent</h3>
        <p className="dshth-hint">Recolours primary buttons and active navigation, over any theme.</p>
        <div
          className="dshth-accents"
          role="radiogroup"
          aria-label="Accent colour"
          onKeyDown={(event) => {
            const next = nextOption(accentOptions.map((a) => a.id), draft.accent, event.key)
            if (next === undefined) return
            event.preventDefault()
            setDraft((prev) => ({ ...prev, accent: next }))
            event.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus()
          }}
        >
          {accentOptions.map((accent) => (
            <button
              key={accent.id}
              type="button"
              role="radio"
              data-id={accent.id}
              aria-checked={draft.accent === accent.id}
              tabIndex={draft.accent === accent.id ? 0 : -1}
              className="dshth-accent"
              onClick={() => setDraft((prev) => ({ ...prev, accent: accent.id }))}
            >
              <span
                className={accent.swatch === undefined ? 'dshth-dot dshth-dot-auto' : 'dshth-dot'}
                style={accent.swatch === undefined ? undefined : { background: accent.swatch }}
                aria-hidden="true"
              />
              {accent.label}
            </button>
          ))}
        </div>
      </section>

      <section className="dshth-group">
        <h3 className="dshth-legend">Contrast</h3>
        <p className="dshth-hint">
          Pushes surfaces and text apart without touching the theme’s accent, states or syntax
          colours — so you can have any palette at any legibility, instead of the two being the
          same choice.
        </p>
        <div className="dshth-slider-row">
          <input
            type="range"
            className="dshth-slider"
            min={0}
            max={CONTRAST_LEVELS.length - 1}
            step={1}
            value={Math.max(0, CONTRAST_LEVELS.findIndex((l) => l.id === draft.contrast))}
            aria-label="Contrast"
            aria-valuetext={findContrast(draft.contrast)?.label ?? 'Regular'}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, contrast: CONTRAST_LEVELS[Number(event.target.value)].id }))
            }
          />
          <span className="dshth-slider-value">{findContrast(draft.contrast)?.label ?? 'Regular'}</span>
        </div>
        <div className="dshth-slider-ticks" aria-hidden="true">
          <span>{CONTRAST_LEVELS[0].label}</span>
          <span>{CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1].label}</span>
        </div>
      </section>

      <section className="dshth-group">
        <h3 className="dshth-legend">UI scale</h3>
        <p className="dshth-hint">
          Scales the whole interface — text, controls and spacing together, like browser zoom.
          A text-only size control is not possible from a plugin: the harness sets most of its
          font sizes literally rather than through a token.
        </p>
        <div className="dshth-slider-row">
          <input
            type="range"
            className="dshth-slider"
            min={0}
            max={SCALE_LEVELS.length - 1}
            step={1}
            value={Math.max(0, SCALE_LEVELS.findIndex((l) => l.id === draft.scale))}
            aria-label="Interface scale"
            aria-valuetext={findScale(draft.scale)?.label ?? '100%'}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, scale: SCALE_LEVELS[Number(event.target.value)].id }))
            }
          />
          <span className="dshth-slider-value">{findScale(draft.scale)?.label ?? '100%'}</span>
        </div>
        <div className="dshth-slider-ticks" aria-hidden="true">
          <span>{SCALE_LEVELS[0].label}</span>
          <span>{SCALE_LEVELS[SCALE_LEVELS.length - 1].label}</span>
        </div>
      </section>

      <section className="dshth-group">
        <h3 className="dshth-legend">Font</h3>
        <p className="dshth-hint">
          One face for the whole interface, code included. Everything but Default ships inside
          the plugin, so it renders the same on every machine with nothing to install — the
          column on the right says which you are getting.
        </p>
        <div
          className="dshth-fonts"
          role="radiogroup"
          aria-label="Interface font"
          onKeyDown={(event) => {
            const ids = FONTS.map((f) => f.id)
            const next = nextOption(ids, draft.font, event.key)
            if (next === undefined) return
            event.preventDefault()
            setDraft((prev) => ({ ...prev, font: next }))
            event.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus()
          }}
        >
          {FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              role="radio"
              data-id={font.id}
              aria-checked={draft.font === font.id}
              tabIndex={draft.font === font.id ? 0 : -1}
              className="dshth-font"
              style={{ fontFamily: font.ui }}
              onClick={() => setDraft((prev) => ({ ...prev, font: font.id }))}
            >
              <span className="dshth-font-name">{font.label}</span>
              <span className="dshth-font-blurb">{font.blurb}</span>
              <span className="dshth-font-resolved">
                {font.bundled ? 'bundled' : (resolved.get(font.id)?.family ?? '')}
              </span>
            </button>
          ))}
        </div>
      </section>


      {dirty ? (
        <div className="dshth-bar" role="group" aria-label="Unsaved appearance changes">
          <span className="dshth-bar-text">Previewing — not saved yet.</span>
          <button type="button" className="dshth-btn" onClick={revert}>
            Revert
          </button>
          <button type="button" className="dshth-btn dshth-btn-primary" onClick={apply}>
            Apply
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: apply the stored selection, then register the Themes
 * page into the settings panel's section list.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const theme = (ctx as unknown as { theme: ThemeService }).theme

  // Applied in the plugin body, not in the panel, so the selection is live
  // from activation whether or not the settings modal is ever opened. The
  // effect's disposer retracts every layer, so unloading the plugin returns
  // the UI to the stock palette instead of freezing it mid-theme.
  // The stylesheet carries the one rule that turns --dshth-ui-scale into a
  // zoom, so it has to be present from activation rather than from the first
  // time the settings page is opened.
  injectStyles()

  ctx.effect(() => {
    applySelection(theme, loadSelection())
    return () => retractAll(theme)
  }, 'dsh-theme: apply stored selection')

  const Panel = (props: { close?: () => void }): React.JSX.Element =>
    React.createElement(ThemePanel, { ...props, ctx })

  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-theme',
            order: 15,
            label: () => 'Themes',
          },
          Panel,
        ),
      ),
    'dsh-theme: settings.section registration',
  )
}
