/**
 * The modal, measured in a real browser against the BUILT stylesheet.
 *
 * The failure this exists for cannot be seen by reading CSS: DSH Desktop paints
 * a window-drag strip (#dsh-desktop-windows-drag-region) at z-index 2147483644,
 * and it swallows clicks even under `pointer-events: none` because the
 * compositor resolves drag regions BEFORE hit-testing. Raising the dialog's
 * z-index cannot beat it — the panel has to stay physically clear of the strip.
 * `dsh-todo` learned that the hard way; this asserts dsh-git inherited the fix
 * rather than the bug.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DRAG_STRIP_Z = 2147483644
const DRAG_STRIP_H = 36

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
// The stylesheet is a template literal in the bundle; slice it the same way the
// other probes do so this tests what actually ships.
const css = (() => {
  const start = bundle.indexOf('.dshgit {')
  assert.ok(start > 0, 'could not find the stylesheet in the built bundle')
  const end = bundle.indexOf('`', start)
  return bundle.slice(start, end > start ? end : undefined)
})()
assert.match(css, /\.dshgit-modal-backdrop/, 'the modal CSS must be in the shipped bundle')

// Every destructive action goes through the in-app dialog. A stray window.confirm
// would be a SECOND confirmation UI in one tab — the browser's grey box beside a
// themed dialog — and it is exactly what this replaced. dsh-todo pins the same
// guard for the same reason.
assert.ok(
  !bundle.includes('window.confirm'),
  'window.confirm must be replaced by the in-app confirmation dialog',
)

const html = [
  '<!doctype html><meta charset=utf-8>',
  '<style>html,body{margin:0;height:100%}</style>',
  '<style>' + css + '</style>',
  // The drag strip, exactly as the Desktop paints it.
  '<div id="dsh-desktop-windows-drag-region" style="position:fixed;top:0;left:0;right:0;',
  'height:' + DRAG_STRIP_H + 'px;z-index:' + DRAG_STRIP_Z + ';pointer-events:none"></div>',
  '<div class="dshgit"><div class="dshgit-scroll" style="height:200px;overflow-y:auto">',
  '<div style="height:2000px">tab content</div></div></div>',
  '<div class="dshgit-modal-backdrop"><div class="dshgit-modal">',
  '<div class="dshgit-modal-head"><span class="dshgit-modal-title">New worktree</span>',
  '<button class="dshgit-icon" id=close>x</button></div>',
  '<div class="dshgit-modal-body"><div class="dshgit-form wtform">',
  '<label class="dshgit-flabel">Branch</label><input class="dshgit-fgrow" id=first>',
  '<button class="dshgit-btn ai">AI name</button>',
  '<label class="dshgit-flabel">Folder</label><input class="dshgit-fgrow">',
  '<label class="dshgit-fromsel">from<select><option>main</option></select></label>',
  // A REAL path, not a token. The preview's job is to show where a worktree
  // will land, and a grid column sizes itself to the longest thing in it — so a
  // short placeholder here hides the exact defect this fixture exists to catch.
  '<div class="dshgit-preview">C:/Users/me/Documents/GitHub/dsh-plugins-swift-falcon</div>',
  // A TALL body on purpose. With a short panel the backdrop's align-items:center
  // keeps it clear of the drag strip by accident, so deleting the top padding
  // changes nothing and the probe proves nothing. Only a panel driven to
  // max-height: 100% shows what the padding is actually for.
  '<div style="height:1200px">tall</div>',
  '</div></div>',
  '<div class="dshgit-modal-foot"><span class="dshgit-spacer"></span>',
  '<button class="dshgit-btn" id=cancel>Cancel</button>',
  '<button class="dshgit-btn primary" id=primary>Add worktree</button></div>',
  '</div></div>',
  // A second dialog, the destructive one, so one page can compare the danger
  // button against the neutral and accent variants.
  //
  // position:static is forced ONLY here. Two fixed full-screen backdrops overlap
  // by construction, and the second would intercept the first's hit test — a
  // fixture artifact, not a product fault. Stacking for this class is already
  // proven by the dialog above; this instance is measured for PAINT alone.
  '<div class="dshgit-modal-backdrop" id=cbackdrop style="position:static;background:transparent">',
  '<div class="dshgit-modal">',
  '<div class="dshgit-modal-head"><span class="dshgit-modal-title">Delete this branch?</span></div>',
  '<div class="dshgit-modal-body"><div class="dshgit-confirm">',
  '<span class="dshgit-confirm-text">Commits only on this branch are lost.</span>',
  '<span class="dshgit-confirm-subject">feature/test-branch</span>',
  '</div></div>',
  '<div class="dshgit-modal-foot"><span class="dshgit-spacer"></span>',
  '<button class="dshgit-btn" id=ccancel>Cancel</button>',
  '<button class="dshgit-btn danger" id=cdanger>Delete branch</button></div>',
  '</div></div>',
].join('')

const dir = mkdtempSync(join(tmpdir(), 'dshgit-modal-'))

const script = `
  const panel = document.querySelector('.dshgit-modal')
  const back = document.querySelector('.dshgit-modal-backdrop')
  const p = panel.getBoundingClientRect()
  const primary = document.getElementById('primary').getBoundingClientRect()
  const cs = getComputedStyle(back)
  const hit = (x, y) => { const el = document.elementFromPoint(x, y); return el ? (el.id || el.className) : null }
  return JSON.stringify({
    panel: { top: p.top, left: p.left, bottom: p.bottom, right: p.right, w: p.width, h: p.height },
    viewport: { w: innerWidth, h: innerHeight },
    backdropZ: cs.zIndex,
    backdropOpacity: cs.opacity,
    panelOpacity: getComputedStyle(panel).opacity,
    panelBg: getComputedStyle(panel).backgroundColor,
    hitPanelTop: hit(p.left + p.width / 2, p.top + 4),
    hitPrimary: hit(primary.left + primary.width / 2, primary.top + primary.height / 2),
    primaryTop: primary.top,
    primaryBg: getComputedStyle(document.getElementById('primary')).backgroundColor,
    primaryColor: getComputedStyle(document.getElementById('primary')).color,
    cancelBorder: getComputedStyle(document.querySelector('.dshgit-modal-foot .dshgit-btn')).borderTopColor,
    inputColor: getComputedStyle(document.getElementById('first')).color,
    inputW: document.getElementById('first').getBoundingClientRect().width,
    inputs: Array.from(document.querySelectorAll('.dshgit-modal input[type=text], .dshgit-modal input:not([type])'))
      .map((el) => Math.round(el.getBoundingClientRect().width)),
    labelW: document.querySelector('.dshgit-flabel').getBoundingClientRect().width,
    dangerBg: getComputedStyle(document.getElementById('cdanger')).backgroundColor,
    dangerColor: getComputedStyle(document.getElementById('cdanger')).color,
    neutralBg: getComputedStyle(document.getElementById('ccancel')).backgroundColor,
    subjectFont: getComputedStyle(document.querySelector('.dshgit-confirm-subject')).fontFamily,
    dangerRect: (() => { const r = document.getElementById('cdanger').getBoundingClientRect(); return { w: r.width, h: r.height } })(),
  })
`

const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
// Chrome's --dump-dom has no evaluate step, so the measurement runs inline and
// parks its result in document.title, which the dumped DOM carries back.
const evalPage = join(dir, 'eval.html')
writeFileSync(evalPage, html + '<script>window.__r = (function(){' + script + '})();' +
  'document.title = window.__r;<\/script>')
const evaluated = spawnSync(chrome, [
  '--headless=new', '--disable-gpu', '--window-size=1200,800',
  '--virtual-time-budget=800', '--dump-dom', 'file://' + evalPage.replace(/\\\\/g, '/'),
], { encoding: 'utf8' })
assert.equal(evaluated.status, 0, 'headless Chrome failed on the eval page')
const found = /<title>([^<]*)<\/title>/.exec(evaluated.stdout)
assert.ok(found, 'the probe script did not run; no title was set')
const m = JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
rmSync(dir, { recursive: true, force: true })

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('  ok  ' + name) }

check('the panel clears the window-drag strip', () => {
  // The whole point. A panel under the strip cannot be clicked, however high
  // its z-index, because drag regions resolve before hit-testing.
  assert.ok(
    m.panel.top >= DRAG_STRIP_H,
    'panel top ' + m.panel.top + ' is under the ' + DRAG_STRIP_H + 'px drag strip',
  )
})

check('the backdrop sits BELOW the drag strip, not above it', () => {
  const z = Number(m.backdropZ)
  assert.ok(Number.isFinite(z), 'backdrop z-index is not a number: ' + m.backdropZ)
  assert.ok(z < DRAG_STRIP_Z, 'z ' + z + ' tries to out-stack the drag strip')
  assert.ok(z > 1000, 'z ' + z + ' is too low to clear the tab chrome')
})

check('the panel is on-screen and not clipped', () => {
  assert.ok(m.panel.top >= 0 && m.panel.left >= 0, 'panel starts off-screen')
  assert.ok(m.panel.bottom <= m.viewport.h, 'panel bottom is past the viewport')
  assert.ok(m.panel.right <= m.viewport.w, 'panel right is past the viewport')
  assert.ok(m.panel.w > 320, 'panel is too narrow to hold a path: ' + m.panel.w)
  assert.ok(m.panel.h > 120, 'panel collapsed: ' + m.panel.h)
})

check('the panel is opaque, not a see-through overlay', () => {
  assert.equal(m.panelOpacity, '1')
  assert.notEqual(m.panelBg, 'rgba(0, 0, 0, 0)', 'panel has no background of its own')
})

check('the panel and its primary action are actually hittable', () => {
  // elementFromPoint is what a click resolves to. A backdrop painted over the
  // panel would pass every geometric check above and still be unusable.
  assert.ok(
    String(m.hitPanelTop).includes('dshgit-modal'),
    'the top of the panel resolves to ' + m.hitPanelTop,
  )
  assert.equal(m.hitPrimary, 'primary', 'the primary button resolves to ' + m.hitPrimary)
  assert.ok(m.primaryTop >= DRAG_STRIP_H, 'the primary action sits under the drag strip')
})

check('the palette reaches CONTROLS inside the portal, not just the panel', () => {
  // The panel's own background has a literal fallback, so it looks fine even
  // when every --g-* is undefined. The controls do not: the primary button's
  // background comes from --g-accent with NO fallback, and its text colour is a
  // hard-coded near-black — so an unresolved palette renders the main action as
  // a blank rectangle. That shipped, and only a user clicking it found it.
  assert.notEqual(m.primaryBg, 'rgba(0, 0, 0, 0)', 'primary button has no background')
  assert.notEqual(m.primaryBg, m.primaryColor, 'primary button is text-on-itself')
  assert.notEqual(m.cancelBorder, 'rgba(0, 0, 0, 0)', 'secondary button has no border')
  assert.notEqual(m.inputColor, 'rgba(0, 0, 0, 0)', 'input text is invisible')
})

check('the fields are wide enough to read a path in', () => {
  // The whole reason this form became a grid. A rule that spans the preview
  // across all columns is what keeps it from stretching the AUTO-sized label
  // column to the width of a full filesystem path — which collapsed both
  // inputs to a few pixels and shipped that way.
  assert.ok(m.labelW < 140, 'the label column is ' + m.labelW + 'px: something is stretching it')
  for (const w of m.inputs) {
    assert.ok(w > 200, 'an input is only ' + w + 'px wide; fields: ' + JSON.stringify(m.inputs))
  }
})

check('a destructive confirm is visibly destructive, not just another button', () => {
  // The whole point of the danger variant. If it renders identically to Cancel,
  // "Delete branch" and "Cancel" are two grey buttons and the dialog has stopped
  // communicating which one destroys work.
  assert.notEqual(m.dangerBg, 'rgba(0, 0, 0, 0)', 'the danger button has no fill')
  assert.notEqual(m.dangerBg, m.neutralBg, 'danger and Cancel are painted the same')
  assert.notEqual(m.dangerBg, m.primaryBg, 'danger is not distinct from the accent action')
  assert.notEqual(m.dangerBg, m.dangerColor, 'danger is text-on-itself')
  assert.ok(m.dangerRect.w > 40 && m.dangerRect.h > 16, 'the danger button collapsed')
})

check('the confirm subject is monospaced so a name can be read exactly', () => {
  // These questions name a branch or a path. A name the user cannot read
  // character-for-character is a name they cannot check before deleting it.
  assert.match(m.subjectFont, /mono/i, 'subject font is ' + m.subjectFont)
})

console.log('\n' + passed + ' modal checks passed')