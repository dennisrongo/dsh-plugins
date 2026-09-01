/**
 * Host half of dsh-weather — no services, no routes.
 *
 * The weather bar still fetches Open-Meteo from the browser and renders into
 * `shell.overlay`. Position helpers are re-exported so the suite can exercise
 * the cookie payload and clamp math under Node; they are not a host service.
 */
export function apply() {}

export {
  POS_COOKIE,
  POS_KEY,
  clampPx,
  formatPos,
  loadPosFromStores,
  parsePos,
  posCookieWrite,
  posToPx,
  pxToPos,
} from './position'
