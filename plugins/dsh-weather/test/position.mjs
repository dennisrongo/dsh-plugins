/**
 * Position persistence — cookie payload, parse/format, and clamp.
 *
 * Breaks this catches:
 * - a malformed store value placing the bar at NaN
 * - a ratio outside 0..1 surviving into layout
 * - clamp letting the pill leave the viewport or enter the Windows drag strip
 * - cookie losing to localStorage (Desktop restart would then forget the spot)
 */
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  parsePos,
  formatPos,
  clampPx,
  posToPx,
  pxToPos,
  loadPosFromStores,
  posCookieWrite,
  POS_COOKIE,
  POS_KEY,
} = await import(pathToFileURL(join(root, 'lib/index.js')).href)

const BOX = {
  width: 200,
  height: 32,
  viewW: 1000,
  viewH: 800,
  minTop: 44,
  pad: 8,
}

assert.equal(POS_COOKIE, 'dsh-weather-pos')
assert.equal(POS_KEY, 'dsh-weather:pos')

assert.equal(formatPos({ x: 0.25, y: 0.5 }), '0.2500,0.5000')
assert.deepEqual(parsePos('0.2500,0.5000'), { x: 0.25, y: 0.5 })
assert.equal(parsePos('nope'), null)
assert.equal(parsePos('1.5,0.2'), null)
assert.equal(parsePos('-0.1,0.2'), null)
assert.equal(parsePos(''), null)
assert.equal(parsePos(undefined), null)

assert.deepEqual(
  clampPx(-10, -10, BOX),
  { left: 8, top: 44 },
)
assert.deepEqual(
  clampPx(9999, 9999, BOX),
  { left: 792, top: 760 },
)

assert.deepEqual(posToPx({ x: 0, y: 0 }, BOX), { left: 8, top: 44 })
assert.deepEqual(posToPx({ x: 1, y: 1 }, BOX), { left: 792, top: 760 })
assert.deepEqual(posToPx({ x: 0.5, y: 0.5 }, BOX), { left: 400, top: 402 })

assert.deepEqual(pxToPos(400, 402, BOX), { x: 0.5, y: 0.5 })

assert.equal(
  posCookieWrite({ x: 0.25, y: 0.5 }),
  'dsh-weather-pos=0.2500%2C0.5000; Path=/; Max-Age=315360000; SameSite=Lax',
)

assert.deepEqual(
  loadPosFromStores('dsh-weather-pos=0.2500%2C0.5000', () => '0.9000,0.9000'),
  { x: 0.25, y: 0.5 },
)
assert.deepEqual(
  loadPosFromStores('', () => '0.3000,0.4000'),
  { x: 0.3, y: 0.4 },
)
assert.equal(loadPosFromStores('', () => null), null)

console.log('position OK')
