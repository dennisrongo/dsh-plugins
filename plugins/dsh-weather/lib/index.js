// src/position.ts
var POS_COOKIE = "dsh-weather-pos";
var POS_KEY = "dsh-weather:pos";
var MAX_AGE = 31536e4;
function formatPos(pos) {
  return `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`;
}
function parsePos(raw) {
  if (raw == null || raw === "") return null;
  const comma = raw.indexOf(",");
  if (comma === -1) return null;
  const x = Number(raw.slice(0, comma));
  const y = Number(raw.slice(comma + 1));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
function rangeOf(box) {
  const minLeft = box.pad;
  const maxLeft = Math.max(minLeft, box.viewW - box.width - box.pad);
  const minTop = Math.max(box.pad, box.minTop);
  const maxTop = Math.max(minTop, box.viewH - box.height - box.pad);
  return { minLeft, maxLeft, minTop, maxTop };
}
function clampPx(left, top, box) {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box);
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top))
  };
}
function posToPx(pos, box) {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box);
  return {
    left: minLeft + pos.x * (maxLeft - minLeft),
    top: minTop + pos.y * (maxTop - minTop)
  };
}
function pxToPos(left, top, box) {
  const { minLeft, maxLeft, minTop, maxTop } = rangeOf(box);
  const spanX = maxLeft - minLeft;
  const spanY = maxTop - minTop;
  return {
    x: spanX <= 0 ? 0 : (left - minLeft) / spanX,
    y: spanY <= 0 ? 0 : (top - minTop) / spanY
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
function posCookieWrite(pos) {
  return `${POS_COOKIE}=${encodeURIComponent(formatPos(pos))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}
function loadPosFromStores(jar, storageGet) {
  try {
    const cookie = readCookie(jar, POS_COOKIE);
    const fromCookie = parsePos(cookie);
    if (fromCookie) return fromCookie;
  } catch {
  }
  try {
    return parsePos(storageGet(POS_KEY));
  } catch {
    return null;
  }
}

// src/index.ts
function apply() {
}
export {
  POS_COOKIE,
  POS_KEY,
  apply,
  clampPx,
  formatPos,
  loadPosFromStores,
  parsePos,
  posCookieWrite,
  posToPx,
  pxToPos
};
