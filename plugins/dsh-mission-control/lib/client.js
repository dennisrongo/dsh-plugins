window.__ModuleLoader__.load({
	id: "@dennisrongo/dsh-mission-control",
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
  CACHE_READ_MULTIPLIER: () => CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER: () => CACHE_WRITE_MULTIPLIER,
  CATALOG_REPOLL_MS: () => CATALOG_REPOLL_MS,
  DEFAULT_BREAK_MINUTES: () => DEFAULT_BREAK_MINUTES,
  DEFAULT_FLEET_SORT: () => DEFAULT_FLEET_SORT,
  DEFAULT_LONG_BREAK_MINUTES: () => DEFAULT_LONG_BREAK_MINUTES,
  DEFAULT_SESSIONS_PER_WORKSPACE: () => DEFAULT_SESSIONS_PER_WORKSPACE,
  DEFAULT_WORK_MINUTES: () => DEFAULT_WORK_MINUTES,
  FLEET_SORT_CHOICES: () => FLEET_SORT_CHOICES,
  MODEL_PRICES: () => MODEL_PRICES,
  MissionControl: () => MissionControl,
  POMODORO_LONG_EVERY: () => POMODORO_LONG_EVERY,
  POMODORO_MAX_MINUTES: () => POMODORO_MAX_MINUTES,
  POMODORO_MIN_MINUTES: () => POMODORO_MIN_MINUTES,
  SESSIONS_PER_WORKSPACE_ALL: () => SESSIONS_PER_WORKSPACE_ALL,
  SESSIONS_PER_WORKSPACE_CHOICES: () => SESSIONS_PER_WORKSPACE_CHOICES,
  advancePomodoro: () => advancePomodoro,
  answerComplete: () => answerComplete,
  apply: () => apply,
  buildAnswer: () => buildAnswer,
  buildFleet: () => buildFleet,
  buildGroups: () => buildGroups,
  compareFleetGroups: () => compareFleetGroups,
  compareFleetRows: () => compareFleetRows,
  computeRate: () => computeRate,
  countDescendants: () => countDescendants,
  countFleet: () => countFleet,
  diffFleetEvents: () => diffFleetEvents,
  displayNow: () => displayNow,
  elapsedSince: () => elapsedSince,
  estimateCost: () => estimateCost,
  extractTail: () => extractTail,
  fmtClock: () => fmtClock,
  fmtMs: () => fmtMs,
  fmtRelative: () => fmtRelative,
  fmtTokens: () => fmtTokens,
  initialPomodoro: () => initialPomodoro,
  inject: () => inject,
  lastErrorOf: () => lastErrorOf,
  limitGroups: () => limitGroups,
  llmActivityOf: () => llmActivityOf,
  newWaitKeys: () => newWaitKeys,
  nextPhase: () => nextPhase,
  normalizeFleetSort: () => normalizeFleetSort,
  normalizeMinutes: () => normalizeMinutes,
  normalizeSessionLimit: () => normalizeSessionLimit,
  openCatalogSubscriptions: () => openCatalogSubscriptions,
  orderSubagents: () => orderSubagents,
  parseSettings: () => parseSettings,
  pausePomodoro: () => pausePomodoro,
  pendingOf: () => pendingOf,
  phaseDurationMs: () => phaseDurationMs,
  phaseLabel: () => phaseLabel,
  phaseProgress: () => phaseProgress,
  priceRowFor: () => priceRowFor,
  questionsOf: () => questionsOf,
  remainingOf: () => remainingOf,
  resetPomodoro: () => resetPomodoro,
  shouldOpenHistory: () => shouldOpenHistory,
  shouldPullCatalog: () => shouldPullCatalog,
  skipPomodoro: () => skipPomodoro,
  sparklinePoints: () => sparklinePoints,
  stageRank: () => stageRank,
  stageRows: () => stageRows,
  startPomodoro: () => startPomodoro,
  toggleInSet: () => toggleInSet,
  toggleSelection: () => toggleSelection,
  toolDetailOf: () => toolDetailOf,
  totalBurn: () => totalBurn,
  treePending: () => treePending,
  treeRunning: () => treeRunning,
  useObservable: () => useObservable,
  waitHeadline: () => waitHeadline
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_react2 = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "sessions", "workspaces", "modelDirectories"];
var asSessionId = (id) => id;
var MarkdownText = (() => {
  try {
    if (typeof require !== "function") return void 0;
    const p = require("@deepseek-ai/dsh-client-ui-primitives");
    return p?.MarkdownText;
  } catch {
    return void 0;
  }
})();
function useObservable(observable) {
  return (0, import_react2.useSyncExternalStore)(
    observable.subscribe.bind(observable),
    () => observable.getSnapshot()
  );
}
var CACHE_READ_MULTIPLIER = 0.1;
var CACHE_WRITE_MULTIPLIER = 1.25;
var MODEL_PRICES = {
  "claude-sonnet": { in: 3, out: 15 },
  "claude-opus": { in: 15, out: 75 },
  "claude-haiku": { in: 0.8, out: 4 },
  "grok": { in: 3, out: 15 },
  "glm": { in: 0.6, out: 2.2 },
  "deepseek-chat": { in: 0.27, out: 1.1 },
  "deepseek-reasoner": { in: 0.55, out: 2.19 },
  "kimi": { in: 0.6, out: 2.5 },
  "qwen": { in: 0.5, out: 2 }
};
function priceRowFor(model) {
  if (!model) return void 0;
  const m = model.toLowerCase();
  for (const key of Object.keys(MODEL_PRICES)) {
    if (m.includes(key)) return MODEL_PRICES[key];
  }
  return void 0;
}
function estimateCost(usage, price) {
  if (!usage || !price) return 0;
  const input = usage.uncachedInputTokens + usage.cacheReadTokens;
  return input / 1e6 * price.in + usage.outputTokens / 1e6 * price.out;
}
function computeRate(prevOut, nowOut, elapsedMs) {
  if (prevOut === void 0 || elapsedMs <= 0) return 0;
  return Math.max(0, (nowOut - prevOut) / (elapsedMs / 1e3));
}
function sparklinePoints(values, width, height, pad = 2) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const yFor = (v) => span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2);
  return values.map((v, i) => `${(pad + i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
}
function newWaitKeys(waits, seen) {
  const fresh = [];
  for (const w of waits) {
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    fresh.push(w.key);
  }
  return fresh;
}
function diffFleetEvents(prev, next, now, mountAt = 0) {
  if (prev === null) return [];
  const events = [];
  let seq = 0;
  const push = (kind, sessionId, title, detail) => {
    events.push({ id: `${now}:${seq++}:${sessionId}`, at: now, kind, sessionId, title, detail });
  };
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (p === void 0) {
      if (n.updatedAt !== void 0 && n.updatedAt < mountAt) continue;
      push("new", id, n.title, n.origin === "subagent" ? "subagent" : void 0);
      continue;
    }
    if (!p.pending && n.pending) push("wait", id, n.title, n.pending);
    else if (p.pending && !n.pending) push("wait-done", id, n.title, n.running ? "resumed" : void 0);
    else if (!p.completed && n.completed) push("done", id, n.title);
    else if (!p.running && n.running) push("run", id, n.title);
    else if (p.running && !n.running) push("idle", id, n.title, "turn ended");
  }
  for (const [id, p] of prev) {
    if (!next.has(id)) push("gone", id, p.title, p.origin === "subagent" ? "subagent" : void 0);
  }
  return events;
}
function sessionOutTokens(s) {
  return s?.projectionValues?.tokenUsage?.outputTokens;
}
function subagentTitle(entry) {
  return entry.label ?? `subagent ${entry.id.slice(-6)}`;
}
function catalogRow(list, entry, seen) {
  if (entry.kind !== "child" || seen.has(entry.id)) return void 0;
  seen.add(entry.id);
  const live = list.byId[entry.id];
  return {
    id: entry.id,
    title: live?.displayTitle ?? subagentTitle(entry),
    running: live?.running ?? entry.activity === "running",
    pending: live?.pendingInteraction,
    completed: live?.completed,
    preset: live?.agentPreset,
    cwd: live?.cwd,
    updatedAt: live?.updatedAt,
    outTokens: live ? sessionOutTokens(live) : void 0,
    // Always recurse: `hasChildren` is a durable-persistence hint, so it can be
    // false for a child that has just spawned live grandchildren into `byId`.
    // catalogChildren is cheap when both sources are empty.
    children: catalogChildren(list, entry.id, seen)
  };
}
function catalogChildren(list, parentId, seen) {
  const rows = [];
  const emitted = /* @__PURE__ */ new Set();
  for (const entry of list.subagentsByParent?.[parentId]?.entries ?? []) {
    const row = catalogRow(list, entry, seen);
    if (row) {
      rows.push(row);
      emitted.add(row.id);
    }
  }
  for (const id of Object.keys(list.byId)) {
    const s = list.byId[id];
    if (s === void 0 || s.origin !== "subagent" || s.parentId !== parentId || emitted.has(s.id) || seen.has(s.id)) {
      continue;
    }
    seen.add(s.id);
    rows.push({
      id: s.id,
      title: s.displayTitle,
      running: s.running,
      pending: s.pendingInteraction,
      completed: s.completed,
      preset: s.agentPreset,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      outTokens: sessionOutTokens(s),
      children: catalogChildren(list, s.id, seen)
    });
  }
  return orderSubagents(rows);
}
function buildFleet(list) {
  const roots = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && s.origin !== "subagent");
  const seen = /* @__PURE__ */ new Set();
  const toRow = (s) => ({
    id: s.id,
    title: s.displayTitle,
    running: s.running,
    pending: s.pendingInteraction,
    completed: s.completed,
    preset: s.agentPreset,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    outTokens: sessionOutTokens(s),
    children: catalogChildren(list, s.id, seen)
  });
  return roots.map(toRow);
}
var DEFAULT_FLEET_SORT = "recent";
var FLEET_SORT_CHOICES = [
  { value: "recent", label: "Most recently active" },
  { value: "oldest", label: "Least recently active" },
  { value: "name", label: "Name (A\u2013Z)" },
  { value: "burn", label: "Token burn" }
];
function normalizeFleetSort(value) {
  return FLEET_SORT_CHOICES.some((c) => c.value === value) ? value : DEFAULT_FLEET_SORT;
}
function compareFleetGroups(a, b, order = DEFAULT_FLEET_SORT) {
  const loose = (g) => g.key === "__ungrouped__" ? 1 : 0;
  const byLoose = loose(a) - loose(b);
  if (byLoose !== 0) return byLoose;
  if (order === "name") {
    const byName = a.title.localeCompare(b.title, void 0, { sensitivity: "base" });
    if (byName !== 0) return byName;
  }
  const rank = (g) => {
    const r = g.rows[0];
    if (!r) return 4;
    return r.pending ? 0 : r.running ? 1 : r.completed ? 2 : 3;
  };
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const latest = (g) => g.rows.reduce((max, r) => r.updatedAt !== void 0 && r.updatedAt > max ? r.updatedAt : max, 0);
  const byRecency = latest(b) - latest(a);
  if (byRecency !== 0) return byRecency;
  return a.title.localeCompare(b.title, void 0, { sensitivity: "base" });
}
function compareFleetRows(a, b, order = DEFAULT_FLEET_SORT) {
  const rank = (r) => r.pending ? 0 : r.running ? 1 : r.completed ? 2 : 3;
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const recent = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (order === "oldest") {
    const oldest = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
    if (oldest !== 0) return oldest;
  } else if (order === "name") {
    const byName = (a.title ?? "").localeCompare(b.title ?? "", void 0, {
      sensitivity: "base"
    });
    if (byName !== 0) return byName;
  } else if (order === "burn") {
    const byBurn = (b.outTokens ?? 0) - (a.outTokens ?? 0);
    if (byBurn !== 0) return byBurn;
  }
  return recent;
}
function buildGroups(list, workspaces, order = DEFAULT_FLEET_SORT) {
  const archived = new Set(workspaces?.archivedSessionIds ?? []);
  const walked = /* @__PURE__ */ new Set();
  const toRowLocal = (s) => ({
    id: s.id,
    title: s.displayTitle,
    running: s.running,
    pending: s.pendingInteraction,
    completed: s.completed,
    preset: s.agentPreset,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    outTokens: sessionOutTokens(s),
    children: catalogChildren(list, s.id, walked)
  });
  const visibleRoots = list.ids.map((id) => list.byId[id]).filter(
    (s) => s !== void 0 && s.origin !== "subagent" && !s.blank && !archived.has(s.id)
  );
  const rowsBySession = /* @__PURE__ */ new Map();
  for (const row of visibleRoots) rowsBySession.set(row.id, toRowLocal(row));
  const sortRows = (rows) => rows.sort((a, b) => compareFleetRows(a, b, order));
  const groups = [];
  const grouped = /* @__PURE__ */ new Set();
  for (const w of workspaces?.items ?? []) {
    const rows = w.sessionIds.map((id) => rowsBySession.get(id)).filter((r) => r !== void 0);
    if (rows.length === 0) continue;
    for (const r of rows) {
      grouped.add(r.id);
      r.workspace = w.title;
    }
    groups.push({ key: w.workspaceId, title: w.title, rows: sortRows(rows) });
  }
  const loose = [...rowsBySession.values()].filter((r) => !grouped.has(r.id));
  if (loose.length > 0) groups.push({ key: "__ungrouped__", title: "Ungrouped", rows: sortRows(loose) });
  return groups.sort((a, b) => compareFleetGroups(a, b, order));
}
var CATALOG_REPOLL_MS = 4e3;
function shouldPullCatalog(last, running, now, intervalMs = CATALOG_REPOLL_MS) {
  if (last === void 0) return true;
  if (!running) return false;
  return now - last >= intervalMs;
}
function openCatalogSubscriptions(sessions, ids, open) {
  const seam = sessions?.setSubagentCatalogOpen;
  if (typeof seam !== "function") return { opened: [], supported: false };
  const opened = [];
  for (const id of ids) {
    try {
      seam.call(sessions, id, open);
      opened.push(id);
    } catch {
    }
  }
  return { opened, supported: true };
}
function orderSubagents(rows) {
  const ordinal = /* @__PURE__ */ new Map();
  rows.forEach((r, i) => ordinal.set(r.id, i));
  const live = (r) => r.pending ? 0 : r.running ? 1 : 2;
  return [...rows].sort((a, b) => {
    const byLive = live(a) - live(b);
    if (byLive !== 0) return byLive;
    if (a.updatedAt !== void 0 && b.updatedAt !== void 0) {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    }
    return (ordinal.get(b.id) ?? 0) - (ordinal.get(a.id) ?? 0);
  });
}
function toggleInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
function countDescendants(row) {
  let n = 0;
  for (const child of row.children) n += 1 + countDescendants(child);
  return n;
}
var DEFAULT_SESSIONS_PER_WORKSPACE = 3;
var SESSIONS_PER_WORKSPACE_ALL = 0;
var SESSIONS_PER_WORKSPACE_CHOICES = [3, 5, 10, 25, SESSIONS_PER_WORKSPACE_ALL];
function normalizeSessionLimit(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SESSIONS_PER_WORKSPACE;
  const i = Math.floor(n);
  if (i <= 0) return SESSIONS_PER_WORKSPACE_ALL;
  return i;
}
function limitGroups(groups, limit, expanded) {
  const max = normalizeSessionLimit(limit);
  return groups.map((g) => {
    const capped = max !== SESSIONS_PER_WORKSPACE_ALL && !expanded?.has(g.key) && g.rows.length > max;
    return {
      ...g,
      visible: capped ? g.rows.slice(0, max) : g.rows,
      hidden: capped ? g.rows.length - max : 0
    };
  });
}
function totalBurn(stats) {
  let steps = 0;
  let llmMs = 0;
  let decodeTokens = 0;
  for (const s of stats) {
    if (!s) continue;
    steps += s.steps;
    llmMs += s.llmMs;
    decodeTokens += s.decodeTokens;
  }
  return { steps, llmMs, decodeTokens };
}
function countFleet(rows) {
  let sessions = 0;
  let running = 0;
  let subagents = 0;
  const isLive = (r) => r.running === true || r.pending !== void 0;
  const walk = (list, isRoot) => {
    for (const r of list) {
      if (isRoot) {
        sessions++;
        if (isLive(r)) running++;
      } else if (isLive(r)) subagents++;
      if (r.children.length > 0) walk(r.children, false);
    }
  };
  walk(rows, true);
  return { sessions, running, subagents, active: running + subagents };
}
function stageRank(row) {
  let best = row.pending ? 0 : row.running ? 1 : 2;
  for (const child of row.children) {
    if (best === 0) break;
    const r = stageRank(child);
    if (r < best) best = r;
  }
  return best;
}
function treePending(row) {
  if (row.pending) return row.pending;
  for (const child of row.children) {
    const p = treePending(child);
    if (p) return p;
  }
  return void 0;
}
function treeRunning(row) {
  if (row.running) return true;
  return row.children.some(treeRunning);
}
function stageRows(rows, now, windowMs) {
  const active = (r) => r.running || !!r.pending || r.updatedAt !== void 0 && now - r.updatedAt < windowMs || r.children.some(active);
  const touchedAt = (r) => {
    let latest = r.updatedAt ?? 0;
    for (const child of r.children) {
      const t = touchedAt(child);
      if (t > latest) latest = t;
    }
    return latest;
  };
  return rows.filter(active).map((row, index) => ({ row, index, rank: stageRank(row), touched: touchedAt(row) })).sort((a, b) => a.rank - b.rank || b.touched - a.touched || a.index - b.index).map((e) => e.row);
}
var fmtInt = new Intl.NumberFormat("en-US");
function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return fmtInt.format(n);
}
function fmtMs(n) {
  n = Math.max(0, n);
  if (n >= 36e5) return `${(n / 36e5).toFixed(1)}h`;
  if (n >= 6e4) return `${(n / 6e4).toFixed(1)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}
function elapsedSince(start, now) {
  if (start === void 0 || !Number.isFinite(start) || start < 1e12) return 0;
  const delta = now - start;
  return delta < 0 ? 0 : delta;
}
function fmtRelative(ts, now = Date.now()) {
  if (!ts) return "";
  const s = Math.round(elapsedSince(ts, now) / 1e3);
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}
var PANEL_STYLES = `
/* Mission Control \u2014 re-themed onto the shell's design tokens (--dsw-*).
   Follows the left sidebar's fill/label/interactive colors and inherits
   light + dark themes automatically; state colors come from the shell's
   state tokens (business blue accent, success, warn, error). */
.dshmc,
.dshmc-stage {
  --mc-bg: var(--dsw-specific-sidebar-fill, #1b1b1c);
  --mc-elev: var(--dsw-specific-menu, #353638);
  --mc-input: var(--dsw-specific-input-major, #2c2c2e);
  --mc-surface: transparent;
  --mc-surface-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
  --mc-surface-active: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.14));
  --mc-nav-active: var(--dsw-specific-sidebar-nav-item-active, rgba(255,255,255,0.10));
  --mc-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  --mc-border-subtle: var(--dsw-alias-border-l1, rgba(255,255,255,0.06));
  --mc-text: var(--dsw-alias-label-primary, #f9fafb);
  --mc-text-2: var(--dsw-alias-label-secondary, #cfd3d6);
  --mc-text-3: var(--dsw-alias-label-tertiary, #adb2b8);
  --mc-text-4: var(--dsw-alias-label-caption, #81858c);
  --mc-dimmed: var(--dsw-alias-label-dimmed, #43454a);
  --mc-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --mc-accent-hover: var(--dsw-alias-button-info-hover, #679efe);
  --mc-on-accent: var(--dsw-alias-label-primary-foreground, #ffffff);
  --mc-green: var(--dsw-alias-state-success-primary, #22c55e);
  --mc-green-soft: var(--dsw-alias-state-success-tertiary, #233c2c);
  --mc-amber: var(--dsw-alias-state-warn-primary, #f59e0b);
  --mc-amber-label: var(--dsw-alias-state-warn-label, #dd8629);
  --mc-amber-soft: var(--dsw-alias-state-warn-tertiary, #27241f);
  --mc-red: var(--dsw-alias-state-error-primary, #ef4444);
  --mc-blue: var(--dsw-alias-state-business-primary, #4176e6);
  --mc-scrollbar: var(--dsw-alias-scrollbar-bg-l2, #545557);
  --mc-scrollbar-hover: var(--dsw-alias-scrollbar-hover-l2, #65676b);
  /* One message text size across every tile surface \u2014 grid + stage, all kinds. */
  --mc-msg-size: 11px;
  --mc-msg-line: 1.45;
  --mc-ease: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}
.dshmc {
  position: fixed;
  right: 16px;
  top: 16px;
  bottom: 16px;
  width: 400px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--mc-border);
  background: var(--mc-bg);
  color: var(--mc-text);
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 12px 32px rgba(0,0,0,0.12));
  z-index: 2147483000;
  pointer-events: auto;
  overflow: hidden;
  animation: mc-in 0.22s var(--mc-ease);
}
body[data-ds-dark-theme] .dshmc {
  box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 16px 48px rgba(0,0,0,0.55);
}
@keyframes mc-in {
  from { opacity: 0; transform: translateY(6px) scale(0.995); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.dshmc *,
.dshmc-stage * { box-sizing: border-box; }
.dshmc[hidden] { display: none; }

/* Header \u2014 flat, shell-weight title */
.dshmc-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
}
.dshmc-title {
  font-weight: 500;
  font-size: 14px;
  line-height: 22px;
  letter-spacing: 0;
}
.dshmc-sub { color: var(--mc-text-3); font-size: 11.5px; margin-top: 1px; }
.dshmc-sub b { color: var(--mc-text-2); font-weight: 500; }
.dshmc-header > div:first-child { flex: 1; min-width: 0; }
.dshmc-close {
  margin-left: auto;
  flex: none;
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: transparent;
  color: var(--mc-text-3); cursor: pointer;
  font-size: 15px; line-height: 1;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-close:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-header-actions {
  margin-left: auto;
  flex: none;
  display: flex; align-items: center; gap: 2px;
}
.dshmc-header-actions .dshmc-close { margin-left: 0; }
.dshmc-icon-btn {
  flex: none;
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: transparent;
  color: var(--mc-text-3); cursor: pointer;
  font-size: 13px; line-height: 1;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-icon-btn:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-icon-btn.on { background: var(--mc-surface-active); color: var(--mc-text); }

/* Settings drawer */
.dshmc-settings {
  padding: 10px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
  background: var(--mc-surface-hover);
}
.dshmc-settings-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.dshmc-settings-label { font-size: 11.5px; color: var(--mc-text-2); }
.dshmc-settings-select {
  flex: none;
  background: var(--mc-input);
  color: var(--mc-text);
  border: 1px solid var(--mc-border);
  border-radius: 7px;
  padding: 3px 7px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.dshmc-settings-select:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.dshmc-settings-hint { margin-top: 5px; font-size: 10.5px; color: var(--mc-text-4); }

/* "Show N more" affordance under a trimmed workspace group */
.dshmc-group-more {
  display: block;
  width: 100%;
  margin: 1px 0 3px;
  padding: 4px 6px 4px 22px;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mc-text-4);
  font: inherit; font-size: 11px;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-group-more:hover { background: var(--mc-surface-hover); color: var(--mc-text-2); }
.dshmc-group-more:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
.dshmc-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-body::-webkit-scrollbar { width: 8px; }
.dshmc-body::-webkit-scrollbar-thumb { background: var(--mc-scrollbar); border-radius: 4px; }
.dshmc-body::-webkit-scrollbar-thumb:hover { background: var(--mc-scrollbar-hover); }
.dshmc-body::-webkit-scrollbar-track { background: transparent; }

/* Pomodoro footer \u2014 pinned below the scroll area.
   flex:none in the .dshmc flex column means it reserves its own row and the
   scrolling body shrinks around it: it can never overlap fleet rows or burn
   data, and it is not rendered inside Stage at all. */
.dshmc-pomo {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--mc-border);
  background: var(--mc-elev);
  overflow: hidden;
  /* Per-phase accent: every colored part of the footer reads this one token,
     so a phase switch recolors the whole bar through a single transition. */
  --mc-pomo-hue: var(--mc-accent);
}
.dshmc-pomo.is-break { --mc-pomo-hue: var(--mc-green); }
.dshmc-pomo.is-long { --mc-pomo-hue: var(--mc-amber); }
/* Hairline of phase color along the top edge, so the footer is identifiable
   even when the timer is idle and the wash is empty. */
.dshmc-pomo::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--mc-pomo-hue) 55%, transparent) 35%,
    color-mix(in srgb, var(--mc-pomo-hue) 55%, transparent) 65%,
    transparent
  );
  opacity: 0.5;
  transition: opacity 0.3s var(--mc-ease);
  pointer-events: none;
}
.dshmc-pomo.is-running::before { opacity: 1; }
/* Elapsed-progress wash, painted under the controls. Gradient fades toward the
   leading edge so the fill reads as a sweep rather than a flat block. */
.dshmc-pomo-progress {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  transform: scaleX(0);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--mc-pomo-hue) 4%, transparent),
    color-mix(in srgb, var(--mc-pomo-hue) 20%, transparent)
  );
  transition: transform 1s linear, background 0.45s var(--mc-ease);
  pointer-events: none;
}
/* Bright leading edge on the wash \u2014 the only part that tracks the second hand. */
.dshmc-pomo-progress::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 2px;
  background: var(--mc-pomo-hue);
  opacity: 0;
  transition: opacity 0.3s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-progress::after { opacity: 0.9; }
/* Slow sheen travelling across the footer while the clock runs. */
.dshmc-pomo.is-running .dshmc-pomo-progress {
  animation: dshmc-pomo-breathe 4s var(--mc-ease) infinite;
}
@keyframes dshmc-pomo-breathe {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
.dshmc-pomo-main {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dshmc-pomo-phase {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mc-text-4);
  white-space: nowrap;
  transition: color 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-phase { color: var(--mc-pomo-hue); }
.dshmc-pomo.is-break .dshmc-pomo-phase { color: var(--mc-pomo-hue); }
/* Pulsing bead beside the phase label \u2014 the running heartbeat of the timer. */
.dshmc-pomo-pulse {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--mc-pomo-hue);
  opacity: 0.35;
  transition: opacity 0.3s var(--mc-ease), background 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-pulse {
  opacity: 1;
  animation: dshmc-pomo-pulse 2s var(--mc-ease) infinite;
}
@keyframes dshmc-pomo-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-pomo-hue) 45%, transparent); }
  50% { transform: scale(1.25); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mc-pomo-hue) 0%, transparent); }
}
.dshmc-pomo-clock {
  font-size: 15px;
  font-weight: 500;
  color: var(--mc-text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  transition: color 0.45s var(--mc-ease), text-shadow 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-clock {
  color: var(--mc-text);
  text-shadow: 0 0 14px color-mix(in srgb, var(--mc-pomo-hue) 35%, transparent);
}
/* Final 60 seconds: the clock turns urgent and ticks. */
.dshmc-pomo.is-ending .dshmc-pomo-clock {
  color: var(--mc-pomo-hue);
  animation: dshmc-pomo-tick 1s steps(1, end) infinite;
}
@keyframes dshmc-pomo-tick {
  0%, 60% { opacity: 1; }
  61%, 100% { opacity: 0.55; }
}
.dshmc-pomo-dots { display: flex; align-items: center; gap: 3px; margin-left: 2px; }
.dshmc-pomo-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--mc-dimmed);
  transition: background 0.3s var(--mc-ease), transform 0.3s var(--mc-ease),
    box-shadow 0.3s var(--mc-ease);
}
.dshmc-pomo-dot.on {
  background: var(--mc-pomo-hue);
  transform: scale(1.35);
  box-shadow: 0 0 6px color-mix(in srgb, var(--mc-pomo-hue) 60%, transparent);
  animation: dshmc-pomo-pop 0.4s var(--mc-ease);
}
@keyframes dshmc-pomo-pop {
  0% { transform: scale(0.4); }
  60% { transform: scale(1.7); }
  100% { transform: scale(1.35); }
}
.dshmc-pomo-actions {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
.dshmc-pomo-btn {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  border: 0; border-radius: 6px;
  background: transparent;
  color: var(--mc-text-3);
  cursor: pointer;
  font-size: 10px; line-height: 1;
  font-family: inherit;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease),
    transform 0.15s var(--mc-ease);
}
.dshmc-pomo-btn:hover {
  background: var(--mc-surface-hover);
  color: var(--mc-text);
  transform: translateY(-1px);
}
.dshmc-pomo-btn:active { transform: translateY(0) scale(0.92); }
.dshmc-pomo-btn.on { background: var(--mc-surface-active); color: var(--mc-text); }
.dshmc-pomo-btn.is-primary {
  color: var(--mc-text-2);
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease),
    transform 0.15s var(--mc-ease), box-shadow 0.3s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-btn.is-primary {
  color: var(--mc-pomo-hue);
  background: color-mix(in srgb, var(--mc-pomo-hue) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-pomo-hue) 30%, transparent);
}
.dshmc-pomo-btn:focus-visible { outline: 2px solid var(--mc-pomo-hue); outline-offset: -2px; }

/* Number inputs in the settings drawer (pomodoro durations) */
.dshmc-settings-num {
  flex: none;
  width: 62px;
  background: var(--mc-input);
  color: var(--mc-text);
  border: 1px solid var(--mc-border);
  border-radius: 7px;
  padding: 3px 7px;
  font-size: 11.5px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.dshmc-settings-num:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.dshmc-settings-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.dshmc-settings-sep {
  margin: 9px 0 7px;
  border-top: 1px solid var(--mc-border-subtle);
  padding-top: 8px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mc-text-4);
}
.dshmc-settings-row + .dshmc-settings-row { margin-top: 6px; }

/* Burn strip (header, under the sub line) \u2014 cost row + model chips */
.dshmc-burn {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 7px;
}
.dshmc-burn-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dshmc-burn-cost {
  color: var(--mc-text);
  font-weight: 500;
  font-size: 15px;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  transition: color 0.3s var(--mc-ease), text-shadow 0.3s var(--mc-ease);
}
/* Burn is actively climbing: the cost figure warms up and breathes */
.dshmc-burn.is-burning .dshmc-burn-cost {
  color: var(--mc-amber-label);
  animation: mc-burn-glow 2.2s ease-in-out infinite;
}
@keyframes mc-burn-glow {
  0%, 100% { text-shadow: 0 0 0 transparent; }
  50% { text-shadow: 0 0 10px color-mix(in srgb, var(--mc-amber) 55%, transparent); }
}
.dshmc-burn.is-burning .dshmc-burn-tokens { color: var(--mc-text-2); }
/* Tokens tick up: brief lift on each change */
.dshmc-burn-tokens.is-bumped { animation: mc-burn-tick 0.45s var(--mc-ease); }
@keyframes mc-burn-tick {
  0% { transform: none; opacity: 1; }
  35% { transform: translateY(-1.5px); opacity: 0.65; }
  100% { transform: none; opacity: 1; }
}
.dshmc-burn-est {
  margin-left: 4px;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--mc-text-4);
}
.dshmc-burn-tokens {
  color: var(--mc-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.dshmc-burn-models {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dshmc-burn-model {
  font-size: 10px;
  font-weight: 500;
  color: var(--mc-accent);
  background: color-mix(in srgb, var(--mc-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent);
  border-radius: 999px;
  padding: 1.5px 8px;
  font-variant-numeric: tabular-nums;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshmc-spark { margin-left: auto; flex: none; opacity: 0.9; color: var(--mc-accent); }
.dshmc-spark polyline { stroke: currentColor; }
/* Live sparkline pulses and draws a soft trail */
.dshmc-burn.is-burning .dshmc-spark {
  color: var(--mc-green);
  animation: mc-spark-live 2.2s ease-in-out infinite;
}
@keyframes mc-spark-live {
  0%, 100% { opacity: 0.55; filter: none; }
  50% { opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--mc-green) 65%, transparent)); }
}

/* Mode tabs \u2014 full-width segmented control on its own row */
.dshmc-modes {
  display: flex;
  gap: 2px;
  margin: 10px 12px 2px;
  padding: 2px;
  border-radius: 9px;
  background: var(--mc-surface-hover);
}
.dshmc-mode {
  flex: 1;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--mc-text-3);
  font: inherit; font-size: 11.5px; font-weight: 500;
  padding: 4px 10px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-mode:hover { color: var(--mc-text); }
.dshmc-mode.on { background: var(--mc-bg); color: var(--mc-text); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
body[data-ds-dark-theme] .dshmc-mode.on { background: var(--mc-surface-active); box-shadow: none; }
.dshmc-mode-badge {
  margin-left: 4px;
  font-size: 9.5px;
  color: var(--mc-amber-label);
  font-variant-numeric: tabular-nums;
}

/* Stats strip \u2014 flat cards, color carries the signal */
.dshmc-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 4px;
}
.dshmc-stat {
  border: 1px solid var(--mc-border-subtle);
  border-radius: 10px;
  padding: 8px 10px 7px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  position: relative;
  overflow: hidden;
  transition: border-color 0.25s var(--mc-ease), box-shadow 0.25s var(--mc-ease);
}
.dshmc-stat-value {
  font-weight: 500; font-size: 15px; letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  transition: color 0.25s var(--mc-ease);
}
.dshmc-stat-label { color: var(--mc-text-4); font-size: 10.5px; margin-top: 2px; }
.dshmc-stat.is-live { border-color: color-mix(in srgb, var(--mc-green) 35%, transparent); }
.dshmc-stat.is-live .dshmc-stat-value { color: var(--mc-green); }
.dshmc-stat.is-waiting-live { border-color: color-mix(in srgb, var(--mc-amber) 35%, transparent); }
.dshmc-stat.is-waiting-live .dshmc-stat-value { color: var(--mc-amber-label); }
/* Swarm (subagents): accent-toned so a live swarm is distinguishable at a
   glance from "running" (green) and "waiting on you" (amber). */
.dshmc-stat.is-swarm-live { border-color: color-mix(in srgb, var(--mc-accent) 35%, transparent); }
.dshmc-stat.is-swarm-live .dshmc-stat-value { color: var(--mc-accent); }

/* Active stat cards glow gently so live numbers read as alive, not static */
.dshmc-stat.is-live { animation: mc-stat-glow-green 3s ease-in-out infinite; }
.dshmc-stat.is-waiting-live { animation: mc-stat-glow-amber 2s ease-in-out infinite; }
.dshmc-stat.is-swarm-live { animation: mc-stat-glow-accent 2.6s ease-in-out infinite; }
@keyframes mc-stat-glow-green {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-green) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-green) 45%, transparent); }
}
@keyframes mc-stat-glow-amber {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-amber) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-amber) 55%, transparent); }
}
@keyframes mc-stat-glow-accent {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-accent) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-accent) 50%, transparent); }
}
/* A sheen sweeps across a live card \u2014 reads as throughput at a glance */
.dshmc-stat.is-live::after,
.dshmc-stat.is-waiting-live::after,
.dshmc-stat.is-swarm-live::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-green) 14%, transparent) 50%,
    transparent 80%
  );
  transform: translateX(-100%);
  animation: mc-stat-sheen 3.4s var(--mc-ease) infinite;
}
.dshmc-stat.is-waiting-live::after {
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-amber) 16%, transparent) 50%,
    transparent 80%
  );
  animation-duration: 2.4s;
}
.dshmc-stat.is-swarm-live::after {
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-accent) 15%, transparent) 50%,
    transparent 80%
  );
  animation-duration: 2.9s;
}
@keyframes mc-stat-sheen {
  0% { transform: translateX(-100%); }
  55%, 100% { transform: translateX(100%); }
}
/* Value flash \u2014 fires for one beat whenever the underlying count changes */
.dshmc-stat-value.is-bumped { animation: mc-stat-bump 0.5s var(--mc-ease); }
@keyframes mc-stat-bump {
  0% { transform: none; }
  30% { transform: translateY(-2px) scale(1.09); }
  100% { transform: none; }
}
.dshmc-stat.is-bumped-card { animation: mc-stat-bump-card 0.5s var(--mc-ease); }
@keyframes mc-stat-bump-card {
  0% { border-color: var(--mc-accent); box-shadow: 0 0 14px -3px color-mix(in srgb, var(--mc-accent) 60%, transparent); }
  100% { border-color: var(--mc-border-subtle); box-shadow: none; }
}

/* Section labels */
.dshmc-section {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--mc-text-4);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin: 16px 2px 6px;
}

/* Groups \u2014 separated so each workspace reads as its own block */
.dshmc-group + .dshmc-group { margin-top: 10px; }

/* Group headers \u2014 sidebar section-header pattern */
.dshmc-group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  margin: 2px 0;
  cursor: pointer;
  border-radius: 8px;
  user-select: none;
  transition: background 0.15s var(--mc-ease);
}
.dshmc-group-header:hover { background: var(--mc-surface-hover); }
.dshmc-caret {
  color: var(--mc-text-4);
  font-size: 9px;
  transition: transform 0.18s var(--mc-ease);
  display: inline-block;
}
.dshmc-caret.open { transform: rotate(90deg); }
.dshmc-group-title {
  font-weight: 500; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-group-count {
  font-size: 10px; color: var(--mc-text-4);
  background: var(--mc-surface-hover);
  border-radius: 999px; padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}
.dshmc-group-live { font-size: 10px; color: var(--mc-green); margin-left: 1px; font-weight: 500; position: relative; }
.dshmc-group-live::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  display: inline-block;
  margin-right: 4px;
  vertical-align: 1px;
  animation: mc-pulse-dot 1.6s ease-in-out infinite;
}
@keyframes mc-pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* Session rows \u2014 sidebar nav-item fills; state shown by dot + edge bar */
.dshmc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin: 3px 0;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  position: relative;
  transition: background 0.15s var(--mc-ease);
}
.dshmc-row:hover { background: var(--mc-surface-hover); }
.dshmc-row.current { background: var(--mc-nav-active); }
/* Running: soft success wash + breathing edge bar + outer glow */
.dshmc-row.is-running {
  background: var(--mc-green-soft);
  animation: mc-breathe 2.6s ease-in-out infinite;
  overflow: hidden;
}
.dshmc-row.is-running:hover {
  background: linear-gradient(var(--mc-surface-hover), var(--mc-surface-hover)), var(--mc-green-soft);
}
@keyframes mc-breathe {
  0%, 100% {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--mc-green) 55%, transparent),
                0 0 0 0 transparent;
  }
  50% {
    box-shadow: inset 2px 0 0 var(--mc-green),
                0 0 10px -2px color-mix(in srgb, var(--mc-green) 40%, transparent);
  }
}
/* A light sweeps left-to-right along a running row: work is moving */
.dshmc-row.is-running::after,
.dshmc-row.is-waiting::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(
    100deg,
    transparent 25%,
    color-mix(in srgb, var(--mc-green) 12%, transparent) 50%,
    transparent 75%
  );
  transform: translateX(-100%);
  animation: mc-row-sweep 2.8s var(--mc-ease) infinite;
}
@keyframes mc-row-sweep {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(100%); }
}
/* Waiting-on-you: soft warn wash, faster edge pulse, warmer glow */
.dshmc-row.is-waiting {
  background: var(--mc-amber-soft);
  animation: mc-breathe-amber 1.8s ease-in-out infinite;
  overflow: hidden;
}
.dshmc-row.is-waiting:hover {
  background: linear-gradient(var(--mc-surface-hover), var(--mc-surface-hover)), var(--mc-amber-soft);
}
.dshmc-row.is-waiting::after {
  background: linear-gradient(
    100deg,
    transparent 25%,
    color-mix(in srgb, var(--mc-amber) 16%, transparent) 50%,
    transparent 75%
  );
  animation-duration: 1.9s;
}
@keyframes mc-breathe-amber {
  0%, 100% {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--mc-amber) 55%, transparent),
                0 0 0 0 transparent;
  }
  50% {
    box-shadow: inset 2px 0 0 var(--mc-amber),
                0 0 10px -2px color-mix(in srgb, var(--mc-amber) 50%, transparent);
  }
}
/* Row content sits above the sweep layer */
.dshmc-row > * { position: relative; z-index: 1; }
/* Freshly-changed row: one-shot accent flash when a session turns active */
.dshmc-row.is-flashing { animation: mc-row-flash 0.6s var(--mc-ease); }
@keyframes mc-row-flash {
  0% { background: color-mix(in srgb, var(--mc-accent) 22%, transparent); }
  100% { background: transparent; }
}
.dshmc-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--mc-dimmed); flex: none;
}
.dshmc-dot.running { background: var(--mc-green); animation: mc-pulse 2s ease-in-out infinite; }
.dshmc-dot.pending { background: var(--mc-amber); animation: mc-pulse-amber 1.4s ease-in-out infinite; }
.dshmc-dot.done { background: var(--mc-blue); }
@keyframes mc-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-green) 45%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes mc-pulse-amber {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-amber) 55%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.dshmc-title-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px;
  color: var(--mc-text-2);
  font-weight: 400;
}
.dshmc-row:hover .dshmc-title-text,
.dshmc-row.current .dshmc-title-text { color: var(--mc-text); }
/* Per-session subagent collapse toggle. Sized to the dot it sits beside so the
   row rhythm is unchanged; the spacer keeps childless rows aligned. */
.dshmc-rowcaret {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--mc-text-4);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s var(--mc-ease), background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-rowcaret.open { transform: rotate(90deg); }
.dshmc-rowcaret:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowcaret:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 1px;
}
.dshmc-rowcaret-spacer { flex: none; width: 14px; }
/* A folded row's count is the only remaining evidence of its swarm, so it
   gains weight instead of sitting muted like the expanded case. */
.dshmc-tag.is-folded {
  border-color: color-mix(in srgb, var(--mc-accent) 40%, transparent);
  color: var(--mc-accent);
}
.dshmc-branch {
  flex: none;
  height: 100%;
  min-height: 20px;
  margin-left: -8px;
  border-left: 1px solid var(--mc-border);
  margin-right: 8px;
}
.dshmc-time {
  flex: none;
  font-size: 10.5px;
  color: var(--mc-text-4);
  font-variant-numeric: tabular-nums;
}
.dshmc-tag {
  flex: none;
  font-size: 10px;
  font-weight: 500;
  padding: 1.5px 7px;
  border-radius: 999px;
  border: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-3);
  background: transparent;
}
.dshmc-tag-model {
  color: var(--mc-accent);
  border-color: color-mix(in srgb, var(--mc-accent) 30%, transparent);
  background: color-mix(in srgb, var(--mc-accent) 10%, transparent);
  max-width: 132px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-rate {
  flex: none;
  font-size: 10px;
  color: var(--mc-green);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  animation: mc-rate-glow 1.8s ease-in-out infinite;
}
/* Token rate is the loudest activity signal in a row \u2014 let it shimmer */
@keyframes mc-rate-glow {
  0%, 100% { opacity: 0.7; text-shadow: 0 0 0 transparent; }
  50% { opacity: 1; text-shadow: 0 0 7px color-mix(in srgb, var(--mc-green) 60%, transparent); }
}

/* Buttons \u2014 shell patterns (were unstyled browser defaults) */
.dshmc-btnrow { display: flex; gap: 6px; align-items: center; }
.dshmc-btn {
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--dsw-alias-button-floating-fill, transparent);
  color: var(--mc-text-2);
  font: inherit; font-size: 12px; font-weight: 500;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-btn:hover:not(:disabled) { background: var(--dsw-alias-button-floating-hover, var(--mc-surface-hover)); color: var(--mc-text); }
.dshmc-btn.primary {
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  border-color: transparent;
  color: var(--mc-on-accent);
}
.dshmc-btn.primary:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); color: var(--mc-on-accent); }
.dshmc-btn.ghost { background: transparent; border-color: var(--mc-border-subtle); color: var(--mc-text-3); }
.dshmc-btn.ghost:hover:not(:disabled) { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-btn:disabled { opacity: 0.5; cursor: default; }

/* Permission inbox */
.dshmc-inbox-item {
  border: 1px solid color-mix(in srgb, var(--mc-amber) 30%, transparent);
  background: var(--mc-amber-soft);
  border-radius: 10px;
  padding: 10px 11px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: border-color 0.15s var(--mc-ease);
}
.dshmc-inbox-item:hover { border-color: color-mix(in srgb, var(--mc-amber) 55%, transparent); }
.dshmc-inbox-kind { font-weight: 500; color: var(--mc-amber-label); font-size: 11px; letter-spacing: 0.01em; }
.dshmc-inbox-title { margin: 3px 0 8px; font-size: 12px; color: var(--mc-text-2); }
.dshmc-inbox-error { margin-top: 6px; font-size: 11px; color: var(--mc-red); }
.dshmc-inbox-item.is-attention {
  border-color: color-mix(in srgb, var(--mc-red) 30%, transparent);
  background: color-mix(in srgb, var(--mc-red) 7%, transparent);
}
.dshmc-inbox-item.is-attention:hover { border-color: color-mix(in srgb, var(--mc-red) 55%, transparent); }
.dshmc-inbox-item.is-attention .dshmc-inbox-kind { color: var(--mc-red); }
.dshmc-inbox-note {
  color: var(--mc-text-4);
  font-size: 10.5px;
  line-height: 1.45;
  margin: 6px 2px 0;
}
.dshmc-inbox-zero { text-align: center; padding: 26px 12px 10px; color: var(--mc-text-3); font-size: 12px; }
.dshmc-inbox-zero-mark { color: var(--mc-green); font-size: 16px; margin-bottom: 4px; }

/* Inline question answering: mirrors the session's real options 1:1 */
.dshmc-q { margin: 7px 0 9px; }
.dshmc-q + .dshmc-q { border-top: 1px solid var(--mc-border-subtle); padding-top: 9px; }
.dshmc-q-header {
  font-size: 10.5px; font-weight: 500;
  color: var(--mc-text-4);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 2px;
}
.dshmc-q-text { font-size: 12px; color: var(--mc-text-2); line-height: 1.4; }
.dshmc-q-detail { font-size: 11px; color: var(--mc-text-3); line-height: 1.45; margin-top: 3px; }
.dshmc-q-options { display: flex; flex-direction: column; gap: 4px; margin: 7px 0 6px; }
.dshmc-q-option {
  display: flex; flex-direction: column; gap: 2px;
  text-align: left;
  border: 1px solid var(--mc-border);
  background: var(--mc-input);
  color: var(--mc-text-2);
  border-radius: 7px;
  padding: 6px 9px;
  font: inherit; font-size: 11.5px;
  cursor: pointer;
  transition: border-color 0.12s var(--mc-ease), background 0.12s var(--mc-ease);
}
.dshmc-q-option:hover:not(:disabled) { border-color: var(--mc-accent); }
.dshmc-q-option:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.dshmc-q-option.is-selected {
  border-color: var(--mc-accent);
  background: color-mix(in srgb, var(--mc-accent) 16%, transparent);
  color: var(--mc-text);
}
.dshmc-q-option:disabled { opacity: 0.55; cursor: default; }
.dshmc-q-option-label { font-weight: 500; }
.dshmc-q-option-desc { color: var(--mc-text-3); font-size: 10.5px; line-height: 1.4; }
.dshmc-q-custom {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--mc-border);
  background: var(--mc-input);
  color: var(--mc-text-2);
  border-radius: 7px;
  padding: 5px 8px;
  font: inherit; font-size: 11.5px;
  margin-top: 2px;
}
.dshmc-q-custom:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-q-custom:disabled { opacity: 0.55; }

/* Empty states */
.dshmc-empty {
  color: var(--mc-text-4);
  font-size: 12px;
  padding: 6px 8px;
}

/* Reopen pill */
.dshmc-reopen {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  pointer-events: auto;
  border-radius: 999px;
  border: 1px solid var(--mc-border);
  background: var(--mc-bg);
  color: var(--mc-text-2);
  padding: 8px 14px;
  cursor: pointer;
  font: 500 12px/1 var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif);
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 12px 32px rgba(0,0,0,0.12));
  display: inline-flex; align-items: center; gap: 7px;
  transition: color 0.15s var(--mc-ease), border-color 0.15s var(--mc-ease);
}
body[data-ds-dark-theme] .dshmc-reopen { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.5); }
.dshmc-reopen::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--mc-accent);
}
.dshmc-reopen:hover { color: var(--mc-text); border-color: var(--dsw-alias-border-l3, var(--mc-border)); }
.dshmc-reopen.is-live { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-reopen.is-live::before { background: var(--mc-green); animation: mc-pulse-dot 1.6s ease-in-out infinite; }
.dshmc-reopen.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 40%, transparent); }
.dshmc-reopen.is-waiting::before { background: var(--mc-amber); animation: mc-pulse-dot 1.2s ease-in-out infinite; }

/* Row actions popover */
.dshmc-rowmenu-btn {
  opacity: 0;
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: transparent;
  color: var(--mc-text-3);
  cursor: pointer;
  font-size: 13px; line-height: 1;
  padding: 0;
  flex: none;
}
.dshmc-row:hover .dshmc-rowmenu-btn,
.dshmc-row:focus-within .dshmc-rowmenu-btn,
.dshmc-rowmenu-btn[aria-expanded="true"] { opacity: 1; }
.dshmc-rowmenu-btn:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowmenu {
  position: fixed;
  z-index: 2147483200;
  min-width: 168px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--mc-border);
  background: var(--mc-elev);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,0.2));
}
body[data-ds-dark-theme] .dshmc-rowmenu { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.5); }
.dshmc-rowmenu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--mc-text-2);
  font: inherit; font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dshmc-rowmenu-item:hover:not(:disabled) { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowmenu-item:disabled { opacity: 0.45; cursor: default; }
.dshmc-rowmenu-item.danger { color: var(--mc-red); }
.dshmc-rowmenu-item.danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); color: var(--mc-red); }
.dshmc-rowmenu-divider { height: 1px; margin: 4px 6px; background: var(--mc-border-subtle); }
.dshmc-rowmenu-note { padding: 6px 8px 4px; color: var(--mc-text-4); font-size: 10.5px; }
.dshmc-rowmenu-error { padding: 6px 8px 4px; color: var(--mc-red); font-size: 11px; }
.dshmc-rowmenu-send {
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px;
  min-width: 224px;
}
.dshmc-rowmenu-send textarea,
.dshmc-rename-input {
  resize: none;
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--mc-input);
  color: var(--mc-text);
  font: inherit; font-size: 12px;
  padding: 6px 8px;
}
.dshmc-rowmenu-send textarea { min-height: 46px; }
.dshmc-rowmenu-send textarea:focus,
.dshmc-rename-input:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-rowmenu-send-row { display: flex; align-items: center; gap: 6px; }
.dshmc-rowmenu-send-mode { color: var(--mc-text-4); font-size: 10.5px; }
.dshmc-rowmenu-send-btn {
  margin-left: auto;
  border: 0; border-radius: 7px;
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  color: var(--mc-on-accent);
  font: inherit; font-size: 11.5px; font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
}
.dshmc-rowmenu-send-btn:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); }
.dshmc-rowmenu-send-btn:disabled { opacity: 0.5; cursor: default; }
.dshmc-backdrop { position: fixed; inset: 0; z-index: 2147483100; }

/* Search */
.dshmc-search { padding: 0 2px 6px; }
.dshmc-search-input {
  width: 100%;
  border: 1px solid var(--mc-border);
  border-radius: 9px;
  background: var(--mc-input);
  color: var(--mc-text);
  font: inherit; font-size: 12.5px;
  padding: 6px 10px;
}
.dshmc-search-input::placeholder { color: var(--mc-text-4); }
.dshmc-search-input:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-search-result {
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.dshmc-search-result:hover { background: var(--mc-surface-hover); }
.dshmc-search-result-title { font-size: 12.5px; color: var(--mc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmc-search-result-snippet { font-size: 10.5px; color: var(--mc-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Event feed */
.dshmc-feed { display: flex; flex-direction: column; padding: 4px 2px 14px; }
.dshmc-feed-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  margin: 1px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease);
}
.dshmc-feed-item:hover { background: var(--mc-surface-hover); }
.dshmc-feed-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dshmc-feed-title {
  font-size: 12.5px;
  color: var(--mc-text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-feed-item:hover .dshmc-feed-title { color: var(--mc-text); }
.dshmc-feed-verb {
  font-size: 10.5px;
  color: var(--mc-text-4);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-feed-verb.is-wait { color: var(--mc-amber-label); }
.dshmc-feed-verb.is-run { color: var(--mc-green); }

.dshmc-tile {
  display: flex; flex-direction: column;
  min-height: 150px;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
  animation: mc-tile-in 0.2s var(--mc-ease);
}
@keyframes mc-tile-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
.dshmc-tile.is-running { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-tile.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 45%, transparent); }
.dshmc-tile-head {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--mc-border-subtle);
}
.dshmc-tile-title {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.dshmc-tile-title:hover { color: var(--mc-accent); }
.dshmc-tile-body {
  flex: 1;
  overflow-y: auto;
  padding: 7px 9px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: var(--mc-msg-size); line-height: var(--mc-msg-line);
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-tile-msg { white-space: pre-wrap; word-break: break-word; }
/* User messages: right-aligned bubble, mirroring the chat's userRow/bubble */
.dshmc-tile-msg.user {
  align-self: flex-end;
  max-width: 88%;
  background: var(--dsw-specific-bubble, var(--mc-surface-hover));
  color: var(--mc-text);
  border-radius: 14px;
  padding: 6px 11px;
}
.dshmc-tile-msg.assistant { color: var(--mc-text); }
.dshmc-tile-msg.tool { color: var(--mc-accent); }
.dshmc-tile-msg.err { color: var(--mc-red); }
/* Host markdown inside tiles: inherit tile metrics, tighten block rhythm */
.dshmc-md { white-space: normal; font-size: inherit; line-height: inherit; }
.dshmc-md p { margin: 0 0 6px; }
.dshmc-md p:last-child { margin-bottom: 0; }
.dshmc-md h1, .dshmc-md h2, .dshmc-md h3, .dshmc-md h4 { margin: 8px 0 4px; font-size: 12.5px; line-height: 1.4; }
.dshmc-md ul, .dshmc-md ol { margin: 4px 0; padding-left: 18px; }
.dshmc-md pre { margin: 6px 0; font-size: 11px; }
.dshmc-md code { font-size: 11px; }
.dshmc-md table { font-size: 11px; }
.dshmc-tile-foot {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 9px;
  border-top: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-4);
  font-size: 10px;
}
.dshmc-tile-foot .dshmc-time { margin-left: auto; }
/* Live LLM activity line: phase + elapsed (+ tok/s) under a tile's body */
.dshmc-llm {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 9px;
  border-top: 1px solid var(--mc-border-subtle);
  font-size: 10px; line-height: 1.4;
  color: var(--mc-text-3);
  min-width: 0;
}
.dshmc-llm .dshmc-dot { flex: none; }
.dshmc-llm-label { color: var(--mc-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshmc-llm-time { color: var(--mc-text-4); font-variant-numeric: tabular-nums; }
.dshmc-llm-rate { margin-left: auto; color: var(--mc-green); font-variant-numeric: tabular-nums; }
/* Expandable tool rows: head button + details panel */
.dshmc-tool { border: 1px solid var(--mc-border-subtle); border-radius: 8px; overflow: hidden; }
.dshmc-tool.is-err { border-color: color-mix(in srgb, var(--mc-red) 36%, transparent); }
.dshmc-tool-head {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0;
  border: 0; border-radius: 8px;
  background: var(--mc-elev); color: var(--mc-accent);
  font: inherit; text-align: left;
  padding: 3px 8px; cursor: pointer;
}
.dshmc-tool-head:hover { background: var(--mc-surface-hover); }
.dshmc-tool-head:focus-visible { outline: 1px solid var(--mc-accent); outline-offset: -1px; }
.dshmc-tool-caret { flex: none; width: 1em; color: var(--mc-text-4); }
.dshmc-tool-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshmc-tool-badge { margin-left: auto; flex: none; color: var(--mc-text-4); font-size: 10px; font-variant-numeric: tabular-nums; }
.dshmc-tool-badge.running { color: var(--mc-amber-label); }
.dshmc-tool-badge.failed { color: var(--mc-red); }
.dshmc-tool-subs { flex: none; color: var(--mc-text-4); font-size: 10px; }
.dshmc-tool-body {
  display: flex; flex-direction: column; gap: 4px;
  border-top: 1px solid var(--mc-border-subtle);
  padding: 5px 8px;
}
.dshmc-tool-args, .dshmc-tool-result {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 10px; line-height: 1.45; color: var(--mc-text-2);
  max-height: 140px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-tool-error { color: var(--mc-red); font-size: 10px; word-break: break-word; }
.dshmc-tool-none { color: var(--mc-text-4); font-size: 10px; }
.dshmc-tile-stop {
  border: 0; border-radius: 6px;
  background: color-mix(in srgb, var(--mc-red) 14%, transparent);
  color: var(--mc-red);
  font: inherit; font-size: 10px; font-weight: 500;
  padding: 1px 7px;
  cursor: pointer;
}
.dshmc-tile-stop:hover { background: color-mix(in srgb, var(--mc-red) 24%, transparent); }
.dshmc-caret-blink { animation: mc-blink 1s steps(1) infinite; color: var(--mc-accent); }
@keyframes mc-blink { 50% { opacity: 0; } }

/* Stage \u2014 full-screen live grid (swaps the panel in stage mode) */
.dshmc-stage {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  background: var(--mc-bg);
  color: var(--mc-text);
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  pointer-events: auto;
  animation: mc-in 0.22s var(--mc-ease);
}
.dshmc-stage-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-title { font-weight: 500; font-size: 14px; }
.dshmc-stage-count { color: var(--mc-text-3); font-size: 11.5px; }
.dshmc-stage-count b { color: var(--mc-text-2); font-weight: 500; }
.dshmc-stage-window {
  display: flex;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border-radius: 9px;
  background: var(--mc-surface-hover);
}
.dshmc-stage-bar .dshmc-close { margin-left: 0; }
.dshmc-stage-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  grid-auto-rows: minmax(260px, 1fr);
  gap: 10px;
  padding: 12px 16px 16px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-stage-empty { color: var(--mc-text-4); font-size: 12.5px; padding: 24px 16px; }
.dshmc-stage-tile {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
}
.dshmc-stage-tile.is-running { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-stage-tile.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 45%, transparent); }
.dshmc-stage-tile-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-tile-title {
  flex: 1; min-width: 0;
  font-size: 12.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.dshmc-stage-tile-title:hover { color: var(--mc-accent); }
.dshmc-stage-tile-ws {
  flex: none;
  max-width: 40%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 6px;
  padding: 1px 6px;
  color: var(--mc-text-4);
  font-size: 10.5px;
}
.dshmc-stage-tile-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
  font-size: var(--mc-msg-size); line-height: var(--mc-msg-line);
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-stage-tile-input {
  display: flex; gap: 6px; align-items: flex-end;
  padding: 8px 10px;
  border-top: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-tile-input textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--mc-input);
  color: var(--mc-text);
  font: inherit; font-size: 12px;
  padding: 6px 9px;
  max-height: 96px;
}
.dshmc-stage-tile-input textarea:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-stage-tile-send {
  border: 0; border-radius: 7px;
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  color: var(--mc-on-accent);
  font: inherit; font-size: 11.5px; font-weight: 500;
  padding: 6px 12px;
  cursor: pointer;
  flex: none;
}
.dshmc-stage-tile-send:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); }
.dshmc-stage-tile-send:disabled { opacity: 0.5; cursor: default; }
.dshmc-stage-tile-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px;
  border-top: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-4);
  font-size: 10.5px;
  flex: none;
}
/* A wait rendered inside its tile \u2014 reuses the inbox card, re-scoped to the
   narrower tile column so options wrap instead of overflowing. */
.dshmc-stage-tile-wait {
  border-top: 1px solid var(--mc-border-subtle);
  max-height: 46%;
  overflow: auto;
  flex: 0 0 auto;
}
.dshmc-stage-tile-wait .dshmc-inbox-item {
  border: none;
  border-left: 2px solid var(--mc-amber);
  border-radius: 0;
  background: color-mix(in srgb, var(--mc-amber) 7%, transparent);
  margin: 0;
}
.dshmc-stage-tile-wait .dshmc-q-option { white-space: normal; }
.dshmc-stage-tile-foot .dshmc-time { margin-left: auto; }
.dshmc-stage-tile-error { color: var(--mc-red); }

/* Reduced motion: state colors stay, movement stops */
@media (prefers-reduced-motion: reduce) {
  .dshmc,
  .dshmc-stage,
  .dshmc-row.is-running,
  .dshmc-row.is-waiting,
  .dshmc-row.is-flashing,
  .dshmc-group-live::before,
  .dshmc-dot.running,
  .dshmc-dot.pending,
  .dshmc-reopen.is-live::before,
  .dshmc-reopen.is-waiting::before,
  .dshmc-tile,
  .dshmc-caret-blink,
  .dshmc-stat.is-live,
  .dshmc-stat.is-waiting-live,
  .dshmc-stat.is-swarm-live,
  .dshmc-stat.is-bumped-card,
  .dshmc-stat-value.is-bumped,
  .dshmc-rate,
  .dshmc-burn.is-burning .dshmc-burn-cost,
  .dshmc-burn.is-burning .dshmc-spark,
  .dshmc-burn-tokens.is-bumped,
  .dshmc-pomo.is-running .dshmc-pomo-progress,
  .dshmc-pomo.is-running .dshmc-pomo-pulse,
  .dshmc-pomo.is-ending .dshmc-pomo-clock,
  .dshmc-pomo-dot.on {
    animation: none;
  }
  /* Sweep/sheen overlays are pure motion \u2014 remove them entirely */
  .dshmc-row.is-running::after,
  .dshmc-row.is-waiting::after,
  .dshmc-stat.is-live::after,
  .dshmc-stat.is-waiting-live::after,
  .dshmc-stat.is-swarm-live::after {
    content: none;
    animation: none;
  }
  /* Keep the standing state color that the animation would otherwise carry */
  .dshmc-row.is-running { box-shadow: inset 2px 0 0 var(--mc-green); }
  .dshmc-row.is-waiting { box-shadow: inset 2px 0 0 var(--mc-amber); }
  .dshmc-burn.is-burning .dshmc-spark { color: var(--mc-green); opacity: 1; }
  .dshmc-rate { opacity: 1; }
  .dshmc-caret { transition: none; }
  /* The rotation is decorative; aria-expanded still conveys the state. */
  .dshmc-rowcaret { transition: none; }
  /* Phase color survives; only the movement it rode in on is dropped. */
  .dshmc-pomo-progress { transition: none; }
  .dshmc-pomo-pulse { opacity: 1; }
  .dshmc-pomo.is-ending .dshmc-pomo-clock { opacity: 1; }
  .dshmc-pomo-dot,
  .dshmc-pomo-btn,
  .dshmc-pomo-phase,
  .dshmc-pomo-clock { transition: none; }
  .dshmc-pomo-dot.on { transform: none; }
  .dshmc-pomo-btn:hover,
  .dshmc-pomo-btn:active { transform: none; }
  .dshmc-stat { transition: none; }
  .dshmc-stat-value { transition: none; }
  .dshmc-burn-cost { transition: none; }
}
`;
var stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dennisrongo/dsh-mission-control";
  tag.textContent = PANEL_STYLES;
  document.head.appendChild(tag);
}
function pendingWaitsFor(ctx, sessionId) {
  try {
    const scoped = ctx.sessions.scope(asSessionId(sessionId));
    const face = scoped ? ctx.sessions.sessionOf(scoped) : void 0;
    const snap = face?.getSnapshot?.();
    return snap?.pending ?? [];
  } catch {
    return [];
  }
}
function questionsOf(wait) {
  if (wait.kind !== "question") return [];
  const raw = wait.payload?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (q) => !!q && typeof q.id === "string" && typeof q.question === "string"
  );
}
function waitHeadline(wait) {
  const questions = questionsOf(wait);
  if (questions.length > 0) {
    const first = questions[0];
    const head = first.header ? `${first.header}: ${first.question}` : first.question;
    return questions.length > 1 ? `${head} (+${questions.length - 1} more)` : head;
  }
  return wait.payload?.reason ?? (wait.payload?.toolName ? `${wait.payload.toolName} needs approval` : wait.kind);
}
function toggleSelection(prev, id, label, multiSelect) {
  const selected = prev?.selected ?? [];
  if (!multiSelect) {
    return { id, selected: selected[0] === label ? [] : [label], custom: prev?.custom };
  }
  const next = selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
  return { id, selected: next, custom: prev?.custom };
}
function answerComplete(questions, draft) {
  if (questions.length === 0) return false;
  return questions.every((q) => {
    const a = draft[q.id];
    if (!a) return false;
    return a.selected.length > 0 || (a.custom ?? "").trim().length > 0;
  });
}
function buildAnswer(questions, draft) {
  return {
    answers: questions.map((q) => {
      const a = draft[q.id];
      const custom = (a?.custom ?? "").trim();
      const item = { id: q.id, selected: a?.selected ?? [] };
      if (custom.length > 0) item.custom = custom;
      return item;
    })
  };
}
function InboxItem({ ctx, sessionTitle, wait, onJump }) {
  const questions = questionsOf(wait);
  if (questions.length > 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InboxQuestion, { sessionTitle, wait, questions, onJump });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InboxApproval, { sessionTitle, wait, onJump });
}
function InboxApproval({ sessionTitle, wait, onJump }) {
  const [busy, setBusy] = import_react.default.useState(null);
  const [error, setError] = import_react.default.useState(null);
  const answer = async (outcome) => {
    if (busy) return;
    setBusy(outcome === "allowed-once" ? "allow" : "deny");
    setError(null);
    try {
      const receipt = await wait.respond({
        ok: true,
        value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome }
      });
      if (receipt && receipt.accepted === false) setError(receipt.reason ?? "rejected by host");
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const headline = waitHeadline(wait);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-item", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-kind", children: [
      "Approval \xB7 ",
      sessionTitle
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-title", title: headline, children: headline }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-btnrow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn", disabled: busy !== null, onClick: () => void answer("rejected"), children: busy === "deny" ? "\u2026" : "Deny" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn primary", disabled: busy !== null, onClick: () => void answer("allowed-once"), children: busy === "allow" ? "\u2026" : "Approve" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn ghost", disabled: busy !== null, onClick: onJump, children: "Open" })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-error", children: error }) : null
  ] });
}
function InboxQuestion({ sessionTitle, wait, questions, onJump }) {
  const [draft, setDraft] = import_react.default.useState({});
  const [busy, setBusy] = import_react.default.useState(false);
  const [error, setError] = import_react.default.useState(null);
  const pick = (q, label) => {
    setDraft((prev) => ({
      ...prev,
      [q.id]: toggleSelection(prev[q.id], q.id, label, q.multiSelect === true)
    }));
  };
  const setCustom = (q, text) => {
    setDraft((prev) => ({
      ...prev,
      [q.id]: { id: q.id, selected: prev[q.id]?.selected ?? [], custom: text }
    }));
  };
  const submit = async () => {
    if (busy || !answerComplete(questions, draft)) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await wait.respond({
        ok: true,
        value: { sessionId: wait.sessionId, answer: buildAnswer(questions, draft) }
      });
      if (receipt && receipt.accepted === false) setError(receipt.reason ?? "rejected by host");
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const ready = answerComplete(questions, draft);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-item", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-kind", children: [
      "Question \xB7 ",
      sessionTitle
    ] }),
    questions.map((q) => {
      const selected = draft[q.id]?.selected ?? [];
      const multi = q.multiSelect === true;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-q", children: [
        q.header ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-q-header", children: q.header }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-q-text", children: q.question }),
        q.detail ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-q-detail", children: q.detail }) : null,
        q.options && q.options.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-q-options", role: multi ? "group" : "radiogroup", "aria-label": q.question, children: q.options.map((opt) => {
          const on = selected.includes(opt.label);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              role: multi ? "checkbox" : "radio",
              "aria-checked": on,
              disabled: busy,
              className: `dshmc-q-option${on ? " is-selected" : ""}`,
              onClick: () => pick(q, opt.label),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-q-option-label", children: opt.label }),
                opt.description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-q-option-desc", children: opt.description }) : null
              ]
            },
            opt.label
          );
        }) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "dshmc-q-custom",
            type: "text",
            disabled: busy,
            value: draft[q.id]?.custom ?? "",
            placeholder: q.options && q.options.length > 0 ? "Other\u2026" : "Your answer\u2026",
            "aria-label": `Custom answer for: ${q.question}`,
            onChange: (e) => setCustom(q, e.target.value)
          }
        )
      ] }, q.id);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-btnrow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn primary", disabled: busy || !ready, onClick: () => void submit(), children: busy ? "\u2026" : "Send" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn ghost", disabled: busy, onClick: onJump, children: "Open" })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-error", children: error }) : null
  ] });
}
function modelTag(sel) {
  if (!sel) return void 0;
  const short = sel.model.replace(/^(anthropic\/|openai\/|xai\/|deepseek\/|zai-gl\w*-|glm-)/i, "");
  return sel.reasoningEffort ? `${short}\xB7${sel.reasoningEffort}` : short;
}
function ModelTag({ modelDirs, sessionId }) {
  let dir;
  try {
    dir = modelDirs?.directoryFor(sessionId);
  } catch {
    return null;
  }
  if (!dir) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelTagValue, { dir, sessionId });
}
function ModelTagValue({ dir, sessionId }) {
  const snap = useObservable(dir.store);
  import_react.default.useEffect(() => {
    void dir.load().catch(() => void 0);
  }, []);
  if (snap.current?.model) MODEL_OF_SESSION.set(sessionId, `${snap.current.provider}/${snap.current.model}`);
  const tag = modelTag(snap.current);
  if (!tag) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-tag dshmc-tag-model", title: `${snap.current.provider}/${snap.current.model}`, children: tag });
}
var MODEL_OF_SESSION = /* @__PURE__ */ new Map();
var DEFAULT_WORK_MINUTES = 25;
var DEFAULT_BREAK_MINUTES = 5;
var POMODORO_LONG_EVERY = 4;
var DEFAULT_LONG_BREAK_MINUTES = 15;
var POMODORO_MIN_MINUTES = 1;
var POMODORO_MAX_MINUTES = 180;
function normalizeMinutes(value, fallback) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  const whole = Math.round(n);
  if (whole < POMODORO_MIN_MINUTES) return POMODORO_MIN_MINUTES;
  if (whole > POMODORO_MAX_MINUTES) return POMODORO_MAX_MINUTES;
  return whole;
}
function phaseDurationMs(phase, config) {
  const minutes = phase === "work" ? config.workMinutes : phase === "long" ? config.longBreakMinutes : config.breakMinutes;
  return normalizeMinutes(minutes, DEFAULT_WORK_MINUTES) * 6e4;
}
function nextPhase(phase, completed) {
  if (phase !== "work") return "work";
  return completed > 0 && completed % POMODORO_LONG_EVERY === 0 ? "long" : "break";
}
function initialPomodoro(config) {
  return {
    phase: "work",
    running: false,
    endsAt: 0,
    remainingMs: phaseDurationMs("work", config),
    completed: 0
  };
}
function displayNow(state, now) {
  if (!state.running) return 0;
  const startedAt = state.endsAt - state.remainingMs;
  return now < startedAt ? startedAt : now;
}
function remainingOf(state, now) {
  const left = state.running ? state.endsAt - now : state.remainingMs;
  return left > 0 ? left : 0;
}
function advancePomodoro(state, now, config) {
  if (!state.running || now < state.endsAt) return { state, elapsed: null };
  const finished = state.phase;
  const completed = finished === "work" ? state.completed + 1 : state.completed;
  const upcoming = nextPhase(finished, completed);
  return {
    state: {
      phase: upcoming,
      // Auto-stop at the boundary: a break you didn't notice isn't a break.
      running: false,
      endsAt: 0,
      remainingMs: phaseDurationMs(upcoming, config),
      completed
    },
    elapsed: finished
  };
}
function startPomodoro(state, now, config) {
  if (state.running) return state;
  const left = state.remainingMs > 0 ? state.remainingMs : phaseDurationMs(state.phase, config);
  return { ...state, running: true, endsAt: now + left, remainingMs: left };
}
function pausePomodoro(state, now) {
  if (!state.running) return state;
  return { ...state, running: false, endsAt: 0, remainingMs: remainingOf(state, now) };
}
function resetPomodoro(state, config) {
  return { ...state, running: false, endsAt: 0, remainingMs: phaseDurationMs(state.phase, config) };
}
function skipPomodoro(state, config) {
  const completed = state.phase === "work" ? state.completed + 1 : state.completed;
  const upcoming = nextPhase(state.phase, completed);
  return {
    phase: upcoming,
    running: false,
    endsAt: 0,
    remainingMs: phaseDurationMs(upcoming, config),
    completed
  };
}
function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1e3));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
function phaseLabel(phase) {
  return phase === "work" ? "Focus" : phase === "long" ? "Long break" : "Break";
}
function phaseProgress(state, now, config) {
  const total = phaseDurationMs(state.phase, config);
  if (total <= 0) return 0;
  const done = (total - remainingOf(state, now)) / total;
  return done < 0 ? 0 : done > 1 ? 1 : done;
}
var SETTINGS_KEY = "dsh-mission-control:settings";
var DEFAULT_SETTINGS = {
  sessionsPerWorkspace: DEFAULT_SESSIONS_PER_WORKSPACE,
  fleetSort: DEFAULT_FLEET_SORT,
  workMinutes: DEFAULT_WORK_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  longBreakMinutes: DEFAULT_LONG_BREAK_MINUTES,
  pomodoroEnabled: true
};
function parseSettings(raw) {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    return {
      sessionsPerWorkspace: normalizeSessionLimit(
        parsed.sessionsPerWorkspace ?? DEFAULT_SESSIONS_PER_WORKSPACE
      ),
      fleetSort: normalizeFleetSort(parsed.fleetSort),
      workMinutes: normalizeMinutes(parsed.workMinutes, DEFAULT_WORK_MINUTES),
      breakMinutes: normalizeMinutes(parsed.breakMinutes, DEFAULT_BREAK_MINUTES),
      longBreakMinutes: normalizeMinutes(parsed.longBreakMinutes, DEFAULT_LONG_BREAK_MINUTES),
      pomodoroEnabled: parsed.pomodoroEnabled !== false
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function useSettings() {
  const [settings, setSettings] = import_react.default.useState(() => {
    try {
      return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
  const update = import_react.default.useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);
  return [settings, update];
}
function useTicker(active, ms) {
  const [now, setNow] = import_react.default.useState(() => Date.now());
  import_react.default.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
function useBump(value, ms = 500) {
  const [bumped, setBumped] = import_react.default.useState(false);
  const prev = import_react.default.useRef(value);
  import_react.default.useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setBumped(true);
    const t = setTimeout(() => setBumped(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return bumped;
}
function fleetOutTokens(list) {
  let total = 0;
  for (const id of list.ids) {
    const usage = list.byId[id]?.projectionValues?.tokenUsage;
    if (usage) total += usage.outputTokens;
  }
  return total;
}
function useFleetPulse(active, list, maxPoints = 60) {
  const now = useTicker(active, 1e3);
  const total = fleetOutTokens(list);
  const [pulse, setPulse] = import_react.default.useState({ rate: 0, history: [] });
  const [seenTotal, setSeenTotal] = import_react.default.useState(void 0);
  import_react.default.useEffect(() => {
    if (!active) return;
    setPulse((p) => {
      const prev = p.prev ?? { at: now, out: total };
      const elapsed = elapsedSince(prev.at, now);
      const rate = elapsed >= 900 ? computeRate(prev.out, total, elapsed) : p.rate;
      const history = elapsed >= 4500 ? [...p.history, rate].slice(-maxPoints) : p.history;
      return { rate, history, prev: { at: now, out: total } };
    });
    if (seenTotal === void 0 && total > 0) setSeenTotal(total);
  }, [now, active, total, maxPoints, seenTotal]);
  return pulse;
}
function useSessionRate(out, active) {
  const now = useTicker(active, 1e3);
  const [state, setState] = import_react.default.useState({ rate: 0 });
  import_react.default.useEffect(() => {
    if (!active || out === void 0) return;
    setState((s) => {
      const prev = s.prev ?? { at: now, out };
      const elapsed = elapsedSince(prev.at, now);
      const rate = elapsed >= 900 ? computeRate(prev.out, out, elapsed) : s.rate;
      return { rate, prev: { at: now, out } };
    });
  }, [now, active, out]);
  return { now: active ? now : Date.now(), rate: state.rate };
}
function useOpenTools() {
  const [open, setOpen] = import_react.default.useState(/* @__PURE__ */ new Set());
  const isOpen = (key) => open.has(key);
  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return { isOpen, toggle };
}
function useWaitNotifications(waits) {
  const seenRef = import_react.default.useRef(/* @__PURE__ */ new Set());
  const primedRef = import_react.default.useRef(false);
  import_react.default.useEffect(() => {
    const keyed = waits.map((w) => ({ key: w.wait.key, title: w.title }));
    if (!primedRef.current) {
      primedRef.current = true;
      newWaitKeys(keyed, seenRef.current);
      return;
    }
    const fresh = newWaitKeys(keyed, seenRef.current);
    if (fresh.length === 0) return;
    if (typeof Notification === "undefined") return;
    const notify = () => {
      for (const key of fresh) {
        const w = keyed.find((x) => x.key === key);
        if (!w) continue;
        try {
          const n = new Notification("Mission Control \u2014 approval needed", {
            body: w.title,
            tag: key
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
        }
      }
    };
    if (Notification.permission === "granted") notify();
    else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => {
      if (p === "granted") notify();
    });
  }, [waits]);
}
function useFleetBurn(list) {
  return import_react.default.useMemo(() => {
    let inTok = 0;
    let outTok = 0;
    let known = 0;
    const costByModel = /* @__PURE__ */ new Map();
    for (const id of list.ids) {
      const row = list.byId[id];
      const usage = row?.projectionValues?.tokenUsage;
      if (!usage) continue;
      known++;
      inTok += usage.uncachedInputTokens + usage.cacheReadTokens;
      outTok += usage.outputTokens;
      const model = MODEL_OF_SESSION.get(id);
      const price = priceRowFor(model?.split("/")[1] ?? model);
      const cost = estimateCost(usage, price);
      if (cost > 0) {
        const label = model ? model.split("/")[1] ?? model : "unknown";
        costByModel.set(label, (costByModel.get(label) ?? 0) + cost);
      }
    }
    const totalCost = [...costByModel.values()].reduce((a, b) => a + b, 0);
    const byModel = [...costByModel.entries()].map(([model, cost]) => ({ model, cost, share: totalCost > 0 ? cost / totalCost : 0 })).sort((a, b) => b.cost - a.cost).slice(0, 4);
    return { known, tokens: { in: inTok, out: outTok }, cost: totalCost, byModel };
  }, [list]);
}
function sessionFaceOf(ctx, id) {
  try {
    const scoped = ctx.sessions.scope(asSessionId(id));
    const face = scoped ? ctx.sessions.sessionOf(scoped) : void 0;
    return face ?? void 0;
  } catch {
    return void 0;
  }
}
function errText(e) {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
}
function RowMenu({
  ctx,
  row,
  root,
  onJump
}) {
  const [menuPos, setMenuPos] = import_react.default.useState(null);
  const [pane, setPane] = import_react.default.useState("main");
  const [text, setText] = import_react.default.useState("");
  const [title, setTitle] = import_react.default.useState(row.title);
  const [busy, setBusy] = import_react.default.useState(false);
  const [error, setError] = import_react.default.useState(null);
  const btnRef = import_react.default.useRef(null);
  const areaRef = import_react.default.useRef(null);
  const inputRef = import_react.default.useRef(null);
  const face = import_react.default.useMemo(() => sessionFaceOf(ctx, row.id), [ctx, row.id]);
  const open = menuPos !== null;
  const close = () => {
    setMenuPos(null);
    setPane("main");
    setError(null);
    setText("");
  };
  import_react.default.useEffect(() => {
    if (pane === "send" && areaRef.current) areaRef.current.focus();
    else if (pane === "rename" && inputRef.current) inputRef.current.focus();
  }, [pane]);
  const openMenu = () => {
    setError(null);
    setPane("main");
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const W = 236;
    const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
    const flip = r.bottom + 260 > window.innerHeight;
    const top = flip ? Math.max(8, r.top - 264) : r.bottom + 4;
    setMenuPos({ left, top });
  };
  const run = (label, fn) => {
    setBusy(true);
    setError(null);
    fn().catch((e) => setError(`${label}: ${errText(e)}`)).finally(() => setBusy(false));
  };
  const send = () => {
    const body = text.trim();
    if (!body || !face) return;
    const mode = row.running ? "steer" : "queue";
    run("send", async () => {
      const res = await face.prompt([{ type: "text", text: body }], mode);
      if (!res.ok) throw new Error(errText(res.error));
      close();
    });
  };
  const stop = () => {
    if (!face) return;
    run("stop", async () => {
      const res = await face.cancel();
      if (!res.ok) throw new Error(errText(res.error));
      close();
    });
  };
  const rename = () => {
    const t = title.trim();
    if (!t || !face) return;
    run("rename", async () => {
      const res = await face.rename(t);
      if (!res.ok) throw new Error(errText(res.error));
      close();
    });
  };
  const fork = () => {
    run("fork", async () => {
      const child = await ctx.sessions.fork({ sessionId: asSessionId(row.id), increaseTitle: true });
      close();
      ctx.sessions.open(child);
    });
  };
  const archive = () => {
    run("archive", async () => {
      const w = ctx.workspaces;
      if (!w?.archiveSession) throw new Error("workspaces face unavailable");
      await w.archiveSession(row.id);
      close();
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        ref: btnRef,
        className: "dshmc-rowmenu-btn",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-label": "Session actions",
        title: "Actions",
        onClick: (e) => {
          e.stopPropagation();
          if (open) close();
          else openMenu();
        },
        onKeyDown: (e) => e.stopPropagation(),
        children: "\u22EF"
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-backdrop", onClick: close }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: "dshmc-rowmenu",
          role: "menu",
          style: menuPos ?? void 0,
          onClick: (e) => e.stopPropagation(),
          children: pane === "main" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item", role: "menuitem", disabled: busy, onClick: onJump, children: "Jump to session" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item", role: "menuitem", disabled: busy || !face || !root, onClick: () => setPane("send"), children: "Send message\u2026" }),
            row.running && root ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item danger", role: "menuitem", disabled: busy || !face, onClick: stop, children: "Stop (cancel turn)" }) : null,
            root ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item", role: "menuitem", disabled: busy || !face, onClick: () => setPane("rename"), children: "Rename\u2026" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item", role: "menuitem", disabled: busy, onClick: fork, children: "Fork" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-divider" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-item danger", role: "menuitem", disabled: busy, onClick: archive, children: "Archive" })
            ] }) : null,
            busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-note", children: "working\u2026" }) : null,
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-error", children: error }) : null
          ] }) : pane === "send" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-rowmenu-send", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "textarea",
              {
                ref: areaRef,
                value: text,
                placeholder: "Message this session\u2026",
                onChange: (e) => setText(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  } else if (e.key === "Escape") {
                    close();
                  }
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-rowmenu-send-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-rowmenu-send-mode", children: row.running ? "steer \xB7 interrupts current turn" : "queue \xB7 starts a new turn" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-send-btn", disabled: busy || !text.trim(), onClick: send, children: busy ? "\u2026" : "Send" })
            ] }),
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-error", children: error }) : null
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-rowmenu-send", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                ref: inputRef,
                className: "dshmc-rename-input",
                value: title,
                onChange: (e) => setTitle(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") rename();
                  else if (e.key === "Escape") close();
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-rowmenu-send-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-rowmenu-send-mode", children: "Pins the title" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-rowmenu-send-btn", disabled: busy || !title.trim(), onClick: rename, children: busy ? "\u2026" : "Save" })
            ] }),
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-error", children: error }) : null
          ] })
        }
      )
    ] }) : null
  ] });
}
function SearchBox({
  ctx,
  list,
  onOpen
}) {
  const [query, setQuery] = import_react.default.useState("");
  const [results, setResults] = import_react.default.useState(null);
  const [searching, setSearching] = import_react.default.useState(false);
  const [error, setError] = import_react.default.useState(null);
  import_react.default.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      const needle = q.toLowerCase();
      const titleHits = [];
      for (const id of list.ids) {
        const row = list.byId[id];
        if (!row) continue;
        if ((row.displayTitle ?? "").toLowerCase().includes(needle)) {
          titleHits.push({ sessionId: id, snippet: "title match" });
        }
        if (titleHits.length >= 8) break;
      }
      const merge = (items) => {
        const seen = /* @__PURE__ */ new Set();
        const merged = [];
        for (const item of items.slice(0, 8)) {
          if (seen.has(item.sessionId)) continue;
          seen.add(item.sessionId);
          merged.push(item);
        }
        for (const h of titleHits) {
          if (seen.has(h.sessionId)) continue;
          if (merged.length >= 8) break;
          seen.add(h.sessionId);
          merged.push(h);
        }
        return merged;
      };
      const slowTimer = window.setTimeout(() => {
        if (!ctrl.signal.aborted) {
          setSearching(false);
          setResults(titleHits);
        }
      }, 1500);
      ctx.sessions.search(q, ctrl.signal).then((res) => {
        window.clearTimeout(slowTimer);
        if (ctrl.signal.aborted) return;
        setSearching(false);
        if (res.ok) setResults(merge(res.value.items));
        else setResults(titleHits);
      }).catch(() => {
        window.clearTimeout(slowTimer);
        if (ctrl.signal.aborted) return;
        setSearching(false);
        setResults(titleHits);
      });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query, ctx, list]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-search", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        className: "dshmc-search-input",
        value: query,
        placeholder: "Search sessions\u2026",
        onChange: (e) => setQuery(e.target.value)
      }
    ),
    searching ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-note", children: "searching\u2026" }) : null,
    error !== null && !searching ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-rowmenu-error", children: [
      "Search error: ",
      error
    ] }) : results !== null && !searching ? results.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-rowmenu-note", children: "No matches." }) : results.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "dshmc-search-result",
        role: "button",
        tabIndex: 0,
        onClick: () => onOpen(r.sessionId),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") onOpen(r.sessionId);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-search-result-title", children: list.byId[r.sessionId]?.displayTitle ?? r.sessionId }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-search-result-snippet", children: r.snippet })
        ]
      },
      r.sessionId
    )) : null
  ] });
}
function shouldOpenHistory(openState) {
  return openState === void 0 || openState === "cold";
}
function useSessionSnapshot(ctx, id) {
  const obs = import_react.default.useMemo(() => {
    if (!id) return void 0;
    try {
      const scoped = ctx.sessions.scope(asSessionId(id));
      const face = scoped ? ctx.sessions.sessionOf(scoped) : void 0;
      if (face) return face;
      return ctx.sessions.binding(asSessionId(id))?.session;
    } catch {
      return void 0;
    }
  }, [ctx, id]);
  const [snap, setSnap] = import_react.default.useState(() => obs?.getSnapshot());
  import_react.default.useEffect(() => {
    setSnap(obs?.getSnapshot());
    if (!obs) return;
    return obs.subscribe(() => setSnap(obs.getSnapshot()));
  }, [obs]);
  import_react.default.useEffect(() => {
    if (!obs || typeof obs.open !== "function") return;
    try {
      if (!shouldOpenHistory(obs.getSnapshot()?.openState)) return;
      void Promise.resolve(obs.open()).catch(() => void 0);
    } catch {
    }
  }, [obs]);
  return snap;
}
function toolDetailOf(root) {
  const r = root;
  const subs = Array.isArray(r.subCalls) ? r.subCalls.length : void 0;
  if (r.kind === "tool-result") {
    const texts = Array.isArray(r.content) ? r.content.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n") : "";
    return {
      name: r.call?.name ?? r.name ?? r.label ?? r.title ?? r.callId ?? "tool",
      running: false,
      argsRaw: r.call?.argsRaw ?? r.argsRaw,
      startedAt: r.callTime ?? void 0,
      endedAt: r.time,
      resultText: texts !== "" ? texts.slice(0, 800) : void 0,
      isError: !!r.isError,
      error: r.error ? `${r.error.name ?? "error"} ${r.error.code ?? ""}`.trim() : void 0,
      subCalls: subs
    };
  }
  return {
    name: r.name ?? r.label ?? r.title ?? r.callId ?? "tool",
    running: true,
    argsRaw: r.argsRaw,
    startedAt: r.time,
    subCalls: subs
  };
}
function extractTail(snap, limit, maxChars = 260) {
  if (!snap?.chat) return [];
  const out = [];
  const contentText = (blocks) => {
    if (!Array.isArray(blocks)) return "";
    return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
  };
  const assistantText = (blocks) => {
    if (!Array.isArray(blocks)) return "";
    return blocks.filter((b) => {
      const k = b.kind ?? b.type;
      return k === "text" || k === "reasoning";
    }).map((b) => b.text ?? "").join(" ");
  };
  try {
    for (const key of snap.chat.order) {
      const node = snap.chat.nodes.get(key);
      if (!node) continue;
      if (node.visibility === "hidden") continue;
      const kn = node.kind;
      const data = node.data ?? node;
      let text = "";
      let kind = "assistant";
      let tool;
      if (kn === "user" || kn === "steering") {
        kind = "user";
        text = contentText(data.content).slice(0, 220);
      } else if (kn === "assistant-step" || kn === "assistant") {
        kind = "assistant";
        text = assistantText(data.blocks).slice(0, maxChars);
      } else if (kn === "tool-call" || kn === "tool-result") {
        kind = "tool";
        tool = toolDetailOf(data.root ?? data);
        text = tool.name;
      } else if (kn === "turn-error" || kn === "turn-max-tokens" || kn === "model-retry") {
        kind = "err";
        const current = data.current ?? data;
        text = String(current.message ?? current.detail ?? kn);
      } else {
        continue;
      }
      if (text.trim() !== "") out.push({ key, kind, text, tool });
    }
  } catch {
  }
  return out.slice(-limit);
}
function llmActivityOf(snap, now) {
  if (!snap?.running) return null;
  const calls = snap.runningCalls ?? [];
  if (calls.length > 0) {
    const names = [];
    let at = Infinity;
    for (const c of calls) {
      const n = c.name ?? "tool";
      if (!names.includes(n)) names.push(n);
      if (c.time !== void 0 && c.time < at) at = c.time;
    }
    const detail = names.slice(0, 2).join(" + ") + (names.length > 2 ? ` +${names.length - 2}` : "");
    return { phase: "tools", elapsedMs: elapsedSince(Number.isFinite(at) ? at : void 0, now), detail };
  }
  const blocks = Array.isArray(snap.partial?.blocks) ? snap.partial.blocks : [];
  const content = blocks.filter((b) => (b.kind === "text" || b.kind === "reasoning") && (b.text ?? "") !== "");
  const partialTurn = snap.partial?.turn;
  let start = partialTurn !== void 0 ? snap.turnTimings?.get(partialTurn)?.startTime : void 0;
  if (start === void 0 && snap.turnTimings) {
    let openTurn = -1;
    for (const [turn, t] of snap.turnTimings) {
      if (t.endTime === void 0 && t.startTime !== void 0 && turn > openTurn) {
        openTurn = turn;
        start = t.startTime;
      }
    }
  }
  const elapsedMs = elapsedSince(start, now);
  if (content.length > 0) {
    return { phase: content[content.length - 1].kind === "reasoning" ? "reasoning" : "streaming", elapsedMs, detail: "" };
  }
  return { phase: "waiting", elapsedMs, detail: "" };
}
function TileMessage({ kind, text, streaming = false }) {
  if (kind === "assistant" && MarkdownText) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-tile-msg assistant dshmc-md", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarkdownText, { text, streaming }),
      streaming ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-caret-blink", children: "\u258D" }) : null
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dshmc-tile-msg ${kind}`, children: [
    text,
    streaming ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-caret-blink", children: "\u258D" }) : null
  ] });
}
function LlmStatus({ activity, rate }) {
  if (!activity) return null;
  const label = activity.phase === "tools" ? activity.detail : activity.phase === "waiting" ? "waiting for model" : activity.phase === "reasoning" ? "thinking" : "streaming";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-llm", role: "status", "aria-label": `LLM ${label}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-dot running", "aria-hidden": "true" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-llm-label", children: label }),
    activity.elapsedMs > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-llm-time", children: fmtMs(activity.elapsedMs) }) : null,
    activity.phase === "streaming" && rate > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-llm-rate", children: [
      Math.round(rate),
      " tok/s"
    ] }) : null
  ] });
}
function prettyArgs(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
function ToolMessage({ detail, now, expanded, onToggle }) {
  const dur = detail.running ? detail.startedAt !== void 0 ? elapsedSince(detail.startedAt, now) : void 0 : detail.endedAt !== void 0 && detail.startedAt !== void 0 ? elapsedSince(detail.startedAt, detail.endedAt) : void 0;
  const badge = detail.isError ? "failed" : detail.running ? "running" : "done";
  const args = detail.argsRaw ? prettyArgs(detail.argsRaw) : void 0;
  const clippedArgs = args !== void 0 && args.length > 4e3 ? `${args.slice(0, 4e3)}
\u2026` : args;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dshmc-tool${detail.isError ? " is-err" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dshmc-tool-head",
        onClick: onToggle,
        "aria-expanded": expanded,
        title: detail.argsRaw ?? detail.name,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-tool-caret", "aria-hidden": "true", children: expanded ? "\u25BE" : "\u25B8" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-tool-name", children: detail.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dshmc-tool-badge ${badge}`, children: [
            badge,
            dur !== void 0 && dur > 0 ? ` ${fmtMs(dur)}` : ""
          ] }),
          detail.subCalls ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-tool-subs", title: "sub-calls", children: [
            "\u21B3",
            detail.subCalls
          ] }) : null
        ]
      }
    ),
    expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-tool-body", children: [
      clippedArgs !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dshmc-tool-args", children: clippedArgs }) : null,
      detail.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-tool-error", children: detail.error }) : null,
      detail.resultText ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dshmc-tool-result", children: detail.resultText }) : null,
      clippedArgs === void 0 && !detail.resultText && !detail.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-tool-none", children: "no details in window" }) : null
    ] }) : null
  ] });
}
function partialText(p) {
  try {
    const po = p;
    if (typeof po.text === "string" && po.text !== "") return po.text.slice(-300);
    if (Array.isArray(po.blocks)) {
      return po.blocks.filter((b) => {
        const k = b.kind ?? b.type;
        return k === "text" || k === "reasoning";
      }).map((b) => b.text ?? "").join(" ").slice(-300);
    }
  } catch {
  }
  return "";
}
function lastErrorOf(snap) {
  if (!snap) return null;
  const order = snap.chat?.order;
  const nodes = snap.chat?.nodes;
  if (order && nodes) {
    for (let i = order.length - 1; i >= 0; i--) {
      let node;
      try {
        node = nodes.get(order[i]);
      } catch {
        return null;
      }
      const kn = node?.kind;
      if (!kn || kn === "manual-compaction" || kn === "compaction" || kn === "unknown" || kn === "context" || kn === "turn-tail") continue;
      if (kn === "turn-error" || kn === "turn-max-tokens" || kn === "model-retry") {
        const data = node.data ?? node;
        const current = data.current ?? data;
        const text = String(current.message ?? current.detail ?? kn);
        return { kind: kn === "turn-max-tokens" ? "max tokens" : kn === "model-retry" ? "model retry" : "error", text };
      }
      return null;
    }
    return null;
  }
  const le = snap.lastAgentError;
  if (typeof le === "string" && le !== "") return { kind: "agent error", text: le };
  return null;
}
var FEED_DOT = {
  new: "dshmc-dot",
  run: "dshmc-dot running",
  idle: "dshmc-dot",
  done: "dshmc-dot done",
  wait: "dshmc-dot pending",
  "wait-done": "dshmc-dot done",
  gone: "dshmc-dot"
};
var FEED_TEXT = {
  new: "joined the fleet",
  run: "started running",
  idle: "turn ended",
  done: "completed",
  wait: "waiting on you",
  "wait-done": "waiting resolved",
  gone: "left the fleet"
};
function FeedView({ events, onOpen, now }) {
  const items = [...events].reverse();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-feed", children: items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-empty", children: "No events yet \u2014 fleet activity lands here as it happens." }) : items.map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "dshmc-feed-item",
      role: "button",
      tabIndex: 0,
      onClick: () => onOpen(e.sessionId),
      onKeyDown: (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onOpen(e.sessionId);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: FEED_DOT[e.kind] ?? "dshmc-dot" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-feed-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-feed-title", title: e.title, children: e.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dshmc-feed-verb${e.kind === "wait" ? " is-wait" : e.kind === "run" ? " is-run" : ""}`, children: [
            FEED_TEXT[e.kind] ?? e.kind,
            e.detail ? ` \xB7 ${e.detail}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-time", children: fmtRelative(e.at, now) })
      ]
    },
    e.id
  )) });
}
function PendingRow({ title, kind, onJump }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "dshmc-inbox-item",
      role: "button",
      tabIndex: 0,
      onClick: onJump,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") onJump();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-kind", children: [
          kind,
          " \xB7 ",
          title
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-title", children: "Open the session to respond" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-btnrow", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn ghost", children: "Open" }) })
      ]
    }
  );
}
function AttentionCard({ ctx, row, onOpen, report }) {
  const snap = useSessionSnapshot(ctx, row.id);
  const err = lastErrorOf(snap);
  import_react.default.useEffect(() => {
    report(row.id, err !== null);
    return () => report(row.id, false);
  }, [err, row.id, report]);
  if (!err) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "dshmc-inbox-item is-attention",
      role: "button",
      tabIndex: 0,
      onClick: onOpen,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-kind", children: [
          err.kind,
          " \xB7 ",
          row.displayTitle
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-title", children: err.text.slice(0, 200) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-btnrow", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-btn ghost", children: "Open" }) })
      ]
    }
  );
}
function InboxView({ ctx, list, pendingRows, pendingWaits, counts, onOpen, now }) {
  const waitBySession = new Map(pendingWaits.map(({ wait }) => [wait.sessionId, wait]));
  const bare = pendingRows.filter((s) => !waitBySession.has(s.id));
  const ATTENTION_MS = 6 * 60 * 60 * 1e3;
  const candidates = import_react.default.useMemo(
    () => list.ids.map((id) => list.byId[id]).filter(
      (s) => s !== void 0 && !s.blank && s.origin !== "subagent" && !s.running && s.pendingInteraction === void 0 && !s.completed && now - (s.updatedAt ?? 0) < ATTENTION_MS
    ).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 12),
    [list, now]
  );
  const [attentionIds, setAttentionIds] = import_react.default.useState(/* @__PURE__ */ new Set());
  const report = import_react.default.useCallback((id, has) => {
    setAttentionIds((prev) => {
      const had = prev.has(id);
      if (has === had) return prev;
      const next = new Set(prev);
      if (has) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const zero = pendingRows.length === 0 && attentionIds.size === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-section", children: "Waiting on you" }),
    pendingRows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-empty", children: "Nothing is blocked on a decision." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
      pendingWaits.map(({ wait, title }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        InboxItem,
        {
          ctx,
          sessionTitle: title,
          wait,
          onJump: () => onOpen(wait.sessionId)
        },
        wait.key
      )),
      bare.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PendingRow, { title: s.displayTitle, kind: s.pendingInteraction ?? "waiting", onJump: () => onOpen(s.id) }, s.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-section", children: "Attention" }),
    candidates.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AttentionCard, { ctx, row: s, onOpen: () => onOpen(s.id), report }, s.id)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-note", children: "Scans sessions touched in the last 6h whose conversation ended on an error \u2014 history only exists for sessions opened in this window." }),
    zero ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-inbox-zero", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-inbox-zero-mark", children: "\u2713" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "Inbox zero \u2014 nothing needs you." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-sub", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: counts.running }),
        " running \xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: counts.subagents }),
        " subagents"
      ] })
    ] }) : null
  ] });
}
function pendingOf(snap) {
  const raw = snap?.pending;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (w) => !!w && typeof w.key === "string" && typeof w.respond === "function"
  );
}
function StageTileWait({ wait, onJump }) {
  const questions = questionsOf(wait);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-stage-tile-wait", role: "group", "aria-label": "Waiting on you", children: questions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InboxQuestion, { sessionTitle: "Waiting on you", wait, questions, onJump }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InboxApproval, { sessionTitle: "Waiting on you", wait, onJump }) });
}
function StageTile({
  ctx,
  row,
  modelDirs,
  now,
  onJump
}) {
  const snap = useSessionSnapshot(ctx, row.id);
  const running = row.running;
  const waiting = row.pending;
  const lastErr = snap?.lastAgentError ?? null;
  const { now: liveNow, rate } = useSessionRate(row.outTokens, running);
  const activity = llmActivityOf(snap, liveNow);
  const tools = useOpenTools();
  const waits = pendingOf(snap);
  const dispRunning = treeRunning(row);
  const dispWaiting = treePending(row) ?? (waits.length > 0 ? "question" : void 0);
  const tail = import_react.default.useMemo(() => extractTail(snap, 30, 1200), [snap]);
  const partial = snap?.running && tail.length === 0 ? partialText(snap.partial) : "";
  const bodyRef = import_react.default.useRef(null);
  const pinnedRef = import_react.default.useRef(true);
  import_react.default.useEffect(() => {
    const el = bodyRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [tail, waits.length]);
  const [draft, setDraft] = import_react.default.useState("");
  const [busy, setBusy] = import_react.default.useState(false);
  const [error, setError] = import_react.default.useState(null);
  const send = () => {
    const body = draft.trim();
    if (!body || busy) return;
    const face = sessionFaceOf(ctx, row.id);
    if (!face) {
      setError("session face unavailable");
      return;
    }
    setBusy(true);
    setError(null);
    face.prompt([{ type: "text", text: body }], running ? "steer" : "queue").then((res) => {
      if (!res.ok) setError(errText(res.error));
      else setDraft("");
    }).catch((e) => setError(errText(e))).finally(() => setBusy(false));
  };
  const cls = dispWaiting ? "is-waiting" : dispRunning ? "is-running" : "";
  const statusLabel = dispWaiting ? waits.length > 0 && waits[0].kind === "question" ? "waiting \u2014 answer below" : "waiting on you" : dispRunning ? "running" : row.updatedAt ? `idle ${fmtRelative(row.updatedAt, now)}` : "idle";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dshmc-stage-tile ${cls}`, "data-session-id": row.id, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-tile-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: dispWaiting ? "dshmc-dot pending" : dispRunning ? "dshmc-dot running" : "dshmc-dot" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "span",
        {
          className: "dshmc-stage-tile-title",
          title: row.cwd ?? row.title,
          role: "button",
          tabIndex: 0,
          onClick: onJump,
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") onJump();
          },
          children: row.title
        }
      ),
      row.workspace ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-stage-tile-ws", title: `Workspace: ${row.workspace}`, children: row.workspace }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelTag, { modelDirs, sessionId: row.id }),
      running ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: "dshmc-tile-stop",
          title: "Stop (cancel turn)",
          onClick: (e) => {
            e.stopPropagation();
            const face = sessionFaceOf(ctx, row.id);
            if (face) void face.cancel().catch(() => void 0);
          },
          children: "stop"
        }
      ) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: bodyRef,
        className: "dshmc-stage-tile-body",
        onScroll: (e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        },
        children: [
          tail.map((m, i) => m.tool ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            ToolMessage,
            {
              detail: m.tool,
              now: liveNow,
              expanded: tools.isOpen(m.key),
              onToggle: () => tools.toggle(m.key)
            },
            m.key
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            TileMessage,
            {
              kind: m.kind,
              text: m.text,
              streaming: !!snap?.running && i === tail.length - 1 && m.kind === "assistant"
            },
            m.key
          )),
          partial !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TileMessage, { kind: "assistant", text: partial, streaming: true }) : null,
          tail.length === 0 && partial === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-tile-msg tool", role: "note", children: "status only \u2014 click the title to open the conversation" }) : null,
          lastErr ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-tile-msg err", children: String(lastErr).slice(0, 160) }) : null
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LlmStatus, { activity, rate }),
    waits.length > 0 ? waits.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StageTileWait, { wait: w, onJump }, w.key)) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-tile-input", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          rows: 1,
          value: draft,
          placeholder: running ? "Steer this session\u2026" : "Message this session\u2026",
          "aria-label": `Message ${row.title}`,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-stage-tile-send", disabled: busy || !draft.trim(), onClick: send, children: busy ? "\u2026" : running ? "Steer" : "Send" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-tile-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: statusLabel }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-stage-tile-error", title: error, children: "send failed" }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-time", children: fmtRelative(row.updatedAt, now) })
    ] })
  ] });
}
function StageView({
  ctx,
  rows,
  modelDirs,
  now,
  onJump,
  onExit
}) {
  const [windowMin, setWindowMin] = import_react.default.useState(30);
  const tiles = import_react.default.useMemo(() => stageRows(rows, now, windowMin * 6e4), [rows, now, windowMin]);
  import_react.default.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-stage-title", children: "Stage" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-stage-count", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: tiles.length }),
        " active"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-window", role: "group", "aria-label": "Activity window", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: `dshmc-mode${windowMin === 30 ? " on" : ""}`, onClick: () => setWindowMin(30), children: "30m" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: `dshmc-mode${windowMin === 120 ? " on" : ""}`, onClick: () => setWindowMin(120), children: "2h" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-close", onClick: onExit, "aria-label": "Exit Stage", title: "Exit Stage (Esc)", children: "\xD7" })
    ] }),
    tiles.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stage-empty", children: [
      "Nothing active. Tiles appear while agents run, wait on you, or were active in the last ",
      windowMin === 30 ? "30 minutes" : "2 hours",
      "."
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-stage-grid", children: tiles.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StageTile, { ctx, row, modelDirs, now, onJump: () => onJump(row.id) }, row.id)) })
  ] });
}
function StatCard({
  value,
  label,
  tone
}) {
  const bumped = useBump(value);
  const active = tone !== void 0 && value > 0;
  const cls = [
    "dshmc-stat",
    active && tone === "live" ? "is-live" : "",
    active && tone === "waiting" ? "is-waiting-live" : "",
    active && tone === "swarm" ? "is-swarm-live" : "",
    bumped ? "is-bumped-card" : ""
  ].filter(Boolean).join(" ");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: `dshmc-stat-value${bumped ? " is-bumped" : ""}`, children: value }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-stat-label", children: label })
  ] });
}
function FleetRowView({
  ctx,
  row,
  depth = 0,
  current,
  onSelect,
  modelDirs,
  rate,
  collapsed,
  onToggleCollapsed
}) {
  const waiting = treePending(row);
  const hasChildren = row.children.length > 0;
  const isCollapsed = collapsed.has(row.id);
  const dotClass = waiting ? "dshmc-dot pending" : row.running ? "dshmc-dot running" : row.completed ? "dshmc-dot done" : "dshmc-dot";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: `dshmc-row${row.id === current ? " current" : ""}${waiting ? " is-waiting" : row.running ? " is-running" : ""}`,
        onClick: () => onSelect(row),
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") onSelect(row);
        },
        children: [
          depth > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-branch", style: { width: depth * 14 }, "aria-hidden": "true" }) : null,
          hasChildren ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              className: `dshmc-rowcaret${isCollapsed ? "" : " open"}`,
              onClick: (e) => {
                e.stopPropagation();
                onToggleCollapsed(row.id);
              },
              onKeyDown: (e) => e.stopPropagation(),
              "aria-expanded": !isCollapsed,
              "aria-label": `${isCollapsed ? "Show" : "Hide"} ${row.children.length} subagent${row.children.length === 1 ? "" : "s"} of ${row.title}`,
              title: isCollapsed ? "Show subagents" : "Hide subagents",
              children: "\u25B8"
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-rowcaret-spacer", "aria-hidden": "true" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              className: dotClass,
              role: "img",
              "aria-label": waiting ? row.pending ? "waiting on you" : "subagent waiting on you" : row.running ? "running" : row.completed ? "done" : "idle"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-title-text", title: row.cwd ?? row.title, children: row.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelTag, { modelDirs, sessionId: row.id }),
          hasChildren ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              className: `dshmc-tag${isCollapsed ? " is-folded" : ""}`,
              title: `${countDescendants(row)} subagent${countDescendants(row) === 1 ? "" : "s"} in this tree`,
              children: countDescendants(row)
            }
          ) : null,
          row.running && rate !== void 0 && rate > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-rate", title: "Fleet output rate", children: [
            Math.round(rate),
            " tok/s"
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-time", children: fmtRelative(row.updatedAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowMenu, { ctx, row, root: depth === 0, onJump: () => onSelect(row) })
        ]
      }
    ),
    !isCollapsed ? row.children.map((child) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      FleetRowView,
      {
        ctx,
        row: child,
        depth: depth + 1,
        current,
        onSelect,
        modelDirs,
        collapsed,
        onToggleCollapsed
      },
      child.id
    )) : null
  ] });
}
function GroupView({
  ctx,
  group,
  collapsed,
  onToggle,
  expanded,
  onToggleExpanded,
  current,
  onSelect,
  modelDirs,
  rate,
  collapsedRows,
  onToggleRow
}) {
  const hasLive = (rows) => rows.some((r) => r.running || r.pending || hasLive(r.children));
  const live = hasLive(group.rows);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-group", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "dshmc-group-header",
        onClick: onToggle,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dshmc-caret${collapsed ? "" : " open"}`, children: "\u25B8" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-group-title", children: group.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-group-count", children: group.rows.length }),
          live ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-group-live", children: "active" }) : null
        ]
      }
    ),
    !collapsed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      group.visible.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        FleetRowView,
        {
          ctx,
          row,
          depth: 0,
          current,
          onSelect,
          modelDirs,
          rate,
          collapsed: collapsedRows,
          onToggleCollapsed: onToggleRow
        },
        row.id
      )),
      group.hidden > 0 || expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: "dshmc-group-more",
          onClick: onToggleExpanded,
          "aria-expanded": expanded,
          "aria-label": expanded ? `Show fewer sessions in ${group.title}` : `Show ${group.hidden} more session${group.hidden === 1 ? "" : "s"} in ${group.title}`,
          children: expanded ? "Show fewer" : `Show ${group.hidden} more`
        }
      ) : null
    ] }) : null
  ] });
}
function notifyPhaseEnd(elapsed, upcoming) {
  if (typeof Notification === "undefined") return;
  const title = elapsed === "work" ? "Mission Control \u2014 time for a break" : "Mission Control \u2014 break over";
  const body = elapsed === "work" ? `${phaseLabel(upcoming)} time. Step away from the fleet.` : "Back to it \u2014 starting a new focus stretch.";
  const fire = () => {
    try {
      const n = new Notification(title, { body, tag: "dshmc-pomodoro" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
    }
  };
  if (Notification.permission === "granted") fire();
  else if (Notification.permission !== "denied") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") fire();
    });
  }
}
function PomodoroBar({
  config,
  settingsOpen,
  onConfigure
}) {
  const [state, setState] = import_react.default.useState(() => initialPomodoro(config));
  const now = useTicker(state.running, 1e3);
  import_react.default.useEffect(() => {
    if (!state.running) return;
    const { state: next, elapsed } = advancePomodoro(state, Date.now(), config);
    if (!elapsed) return;
    setState(next);
    notifyPhaseEnd(elapsed, next.phase);
  }, [now, state, config]);
  const idleKey = state.running ? "" : `${state.phase}:${phaseDurationMs(state.phase, config)}`;
  const lastIdleRef = import_react.default.useRef(idleKey);
  import_react.default.useEffect(() => {
    if (state.running) {
      lastIdleRef.current = "";
      return;
    }
    if (lastIdleRef.current === idleKey) return;
    lastIdleRef.current = idleKey;
    setState((s) => s.running ? s : { ...s, remainingMs: phaseDurationMs(s.phase, config) });
  }, [idleKey, state.running, config]);
  const at = displayNow(state, now);
  const remaining = remainingOf(state, at);
  const progress = phaseProgress(state, at, config);
  const label = phaseLabel(state.phase);
  const isBreak = state.phase !== "work";
  const cycle = state.completed % POMODORO_LONG_EVERY;
  const isEnding = state.running && remaining <= 6e4;
  const cls = "dshmc-pomo" + (isBreak ? " is-break" : "") + (state.phase === "long" ? " is-long" : "") + (state.running ? " is-running" : "") + (isEnding ? " is-ending" : "");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls, role: "group", "aria-label": "Pomodoro break timer", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        className: "dshmc-pomo-progress",
        style: { transform: `scaleX(${progress})` },
        "aria-hidden": "true"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-pomo-main", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-pomo-phase", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-pomo-pulse", "aria-hidden": "true" }),
        label
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "span",
        {
          className: "dshmc-pomo-clock",
          role: "timer",
          "aria-live": "off",
          "aria-label": `${label}: ${fmtClock(remaining)} remaining`,
          children: fmtClock(remaining)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-pomo-dots", "aria-label": `${state.completed} focus stretches completed`, children: Array.from({ length: POMODORO_LONG_EVERY }, (_, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dshmc-pomo-dot${i < cycle ? " on" : ""}`, "aria-hidden": "true" }, i)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-pomo-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: "dshmc-pomo-btn is-primary",
          onClick: () => setState((s) => s.running ? pausePomodoro(s, Date.now()) : startPomodoro(s, Date.now(), config)),
          "aria-label": state.running ? `Pause ${label} timer` : `Start ${label} timer`,
          title: state.running ? "Pause" : "Start",
          children: state.running ? "\u2759\u2759" : "\u25B6"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: "dshmc-pomo-btn",
          onClick: () => setState((s) => resetPomodoro(s, config)),
          "aria-label": "Reset current interval",
          title: "Reset",
          children: "\u21BA"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: "dshmc-pomo-btn",
          onClick: () => setState((s) => skipPomodoro(s, config)),
          "aria-label": `Skip to ${phaseLabel(nextPhase(state.phase, state.phase === "work" ? state.completed + 1 : state.completed))}`,
          title: "Skip",
          children: "\u23ED"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          className: `dshmc-pomo-btn${settingsOpen ? " on" : ""}`,
          onClick: onConfigure,
          "aria-label": "Configure pomodoro durations",
          "aria-expanded": settingsOpen,
          title: "Durations",
          children: "\u2699"
        }
      )
    ] })
  ] });
}
function MissionControl({ ctx }) {
  const [open, setOpen] = import_react.default.useState(true);
  const [collapsedGroups, setCollapsedGroups] = import_react.default.useState({
    __ungrouped__: true
  });
  const [expandedGroups, setExpandedGroups] = import_react.default.useState(/* @__PURE__ */ new Set());
  const [collapsedRows, setCollapsedRows] = import_react.default.useState(/* @__PURE__ */ new Set());
  const [settingsOpen, setSettingsOpen] = import_react.default.useState(false);
  const [settings, updateSettings] = useSettings();
  const [mode, setMode] = import_react.default.useState("fleet");
  const [stageOpen, setStageOpen] = import_react.default.useState(false);
  const [nowTick, setNowTick] = import_react.default.useState(() => Date.now());
  const [feed, setFeed] = import_react.default.useState([]);
  const [feedSeenAt, setFeedSeenAt] = import_react.default.useState(() => Date.now());
  const mountAtRef = import_react.default.useRef(Date.now());
  import_react.default.useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 3e4);
    return () => window.clearInterval(t);
  }, []);
  const list = useObservable(ctx.sessions.list);
  const workspaces = useObservable(ctx.workspaces.list);
  import_react.default.useEffect(() => injectStyles(), []);
  const groups = import_react.default.useMemo(
    () => buildGroups(list, workspaces, normalizeFleetSort(settings.fleetSort)),
    [list, workspaces, settings.fleetSort]
  );
  const limitedGroups = import_react.default.useMemo(
    () => limitGroups(groups, settings.sessionsPerWorkspace, expandedGroups),
    [groups, settings.sessionsPerWorkspace, expandedGroups]
  );
  const visibleRoots = import_react.default.useMemo(
    () => groups.flatMap((g) => g.rows),
    [groups]
  );
  const counts = import_react.default.useMemo(() => countFleet(visibleRoots), [visibleRoots]);
  const requestedCatalogsRef = import_react.default.useRef(/* @__PURE__ */ new Map());
  const [catalogTick, setCatalogTick] = import_react.default.useState(0);
  import_react.default.useEffect(() => {
    const now = Date.now();
    const wanted = [];
    const want = (id, live) => {
      if (shouldPullCatalog(requestedCatalogsRef.current.get(id), live, now)) {
        wanted.push(id);
      }
    };
    const collect = (rows) => {
      for (const r of rows) {
        want(r.id, r.running === true);
        if (r.children.length > 0) collect(r.children);
      }
    };
    collect(visibleRoots);
    for (const id of Object.keys(list.byId)) {
      const s = list.byId[id];
      if (s?.origin === "subagent") want(id, s.running === true);
    }
    if (wanted.length === 0) return;
    let cancelled = false;
    for (const id of wanted) {
      requestedCatalogsRef.current.set(id, now);
      void Promise.resolve(ctx.sessions.refreshSubagents(asSessionId(id))).catch(() => {
        if (!cancelled) return;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [visibleRoots, list, catalogTick]);
  const anyRunning = import_react.default.useMemo(
    () => visibleRoots.some(treeRunning),
    [visibleRoots]
  );
  import_react.default.useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => setCatalogTick((n) => n + 1), CATALOG_REPOLL_MS);
    return () => window.clearInterval(t);
  }, [anyRunning]);
  const watchedRootIds = import_react.default.useMemo(
    () => visibleRoots.map((r) => r.id).join("\0"),
    [visibleRoots]
  );
  import_react.default.useEffect(() => {
    const ids = (watchedRootIds === "" ? [] : watchedRootIds.split("\0")).map(
      (id) => asSessionId(id)
    );
    const { opened } = openCatalogSubscriptions(ctx.sessions, ids, true);
    return () => {
      openCatalogSubscriptions(ctx.sessions, opened, false);
    };
  }, [watchedRootIds]);
  const pendingRows = import_react.default.useMemo(
    () => list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && s.pendingInteraction !== void 0),
    [list]
  );
  const toggleGroup = (key) => setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleGroupExpanded = (key) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleRowCollapsed = import_react.default.useCallback((id) => {
    setCollapsedRows((prev) => toggleInSet(prev, id));
  }, []);
  const openSession = (id) => {
    const session = list.byId[id];
    if (session?.origin === "subagent") {
      const address = ctx.sessions.subagentAddress(asSessionId(id));
      if (address) ctx.sessions.openSubagent(address);
      else ctx.sessions.open(asSessionId(id));
    } else {
      ctx.sessions.open(asSessionId(id));
    }
  };
  const selectSession = (row) => openSession(row.id);
  const pendingWaits = import_react.default.useMemo(() => {
    const waits = [];
    for (const s of pendingRows) {
      if (!s) continue;
      for (const w of pendingWaitsFor(ctx, s.id)) waits.push({ wait: w, title: s.displayTitle });
    }
    return waits;
  }, [pendingRows, ctx]);
  const pomodoroConfig = import_react.default.useMemo(
    () => ({
      workMinutes: normalizeMinutes(settings.workMinutes, DEFAULT_WORK_MINUTES),
      breakMinutes: normalizeMinutes(settings.breakMinutes, DEFAULT_BREAK_MINUTES),
      longBreakMinutes: normalizeMinutes(settings.longBreakMinutes, DEFAULT_LONG_BREAK_MINUTES)
    }),
    [settings.workMinutes, settings.breakMinutes, settings.longBreakMinutes]
  );
  const burn = useFleetBurn(list);
  const pulse = useFleetPulse(counts.active > 0, list);
  const tokensBumped = useBump(burn.tokens.in + burn.tokens.out, 450);
  useWaitNotifications(pendingWaits);
  const sample = import_react.default.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const id of list.ids) {
      const s = list.byId[id];
      if (!s || s.blank) continue;
      m.set(id, {
        running: !!s.running,
        pending: s.pendingInteraction,
        completed: !!s.completed,
        title: s.displayTitle,
        origin: s.origin,
        updatedAt: s.updatedAt
      });
    }
    return m;
  }, [list]);
  const sampleRef = import_react.default.useRef(null);
  import_react.default.useEffect(() => {
    const events = diffFleetEvents(sampleRef.current, sample, Date.now(), mountAtRef.current);
    sampleRef.current = sample;
    if (events.length > 0) setFeed((f) => [...f, ...events].slice(-200));
  }, [sample]);
  import_react.default.useEffect(() => {
    if (mode === "feed") setFeedSeenAt(Date.now());
  }, [mode, feed]);
  const unreadFeed = import_react.default.useMemo(
    () => feed.filter((e) => e.at > feedSeenAt).length,
    [feed, feedSeenAt]
  );
  const close = () => setOpen(false);
  const reopen = () => setOpen(true);
  const modelDirs = (() => {
    try {
      return ctx.modelDirectories;
    } catch {
      return void 0;
    }
  })();
  if (stageOpen) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      StageView,
      {
        ctx,
        rows: visibleRoots,
        modelDirs,
        now: nowTick,
        onJump: (id) => {
          setStageOpen(false);
          openSession(id);
        },
        onExit: () => setStageOpen(false)
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc", hidden: !open, "data-burn-known": burn.known, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-title", children: "Mission Control" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-sub", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: counts.running }),
            " running \xB7 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: counts.subagents }),
            " subagents \xB7 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: pendingWaits.length }),
            " waiting"
          ] }),
          burn.cost > 0 || burn.tokens.out > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              className: `dshmc-burn${counts.active > 0 ? " is-burning" : ""}`,
              title: "Estimated from token counts \xD7 public list prices. Not billing.",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-burn-row", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-burn-cost", children: [
                    "$",
                    burn.cost < 0.01 && burn.cost > 0 ? "<0.01" : burn.cost.toFixed(2),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-burn-est", children: "est" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dshmc-burn-tokens${tokensBumped ? " is-bumped" : ""}`, children: [
                    fmtTokens(burn.tokens.in + burn.tokens.out),
                    " tokens"
                  ] }),
                  pulse.history.length > 2 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "dshmc-spark", viewBox: "0 0 64 14", width: "64", height: "14", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", { points: sparklinePoints(pulse.history, 64, 14), fill: "none", stroke: "currentColor", strokeWidth: "1.25", strokeLinejoin: "round", strokeLinecap: "round" }) }) : null
                ] }),
                burn.byModel.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-burn-models", children: burn.byModel.slice(0, 3).map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshmc-burn-model", children: [
                  m.model,
                  " \xB7 ",
                  Math.round(m.share * 100),
                  "%"
                ] }, m.model)) }) : null
              ]
            }
          ) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-header-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              className: `dshmc-icon-btn${settingsOpen ? " on" : ""}`,
              onClick: () => setSettingsOpen((v) => !v),
              "aria-label": "Mission Control settings",
              "aria-expanded": settingsOpen,
              title: "Settings",
              children: "\u2699"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-close", onClick: close, "aria-label": "Close Mission Control", children: "\xD7" })
        ] })
      ] }),
      settingsOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings", role: "group", "aria-label": "Mission Control settings", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dshmc-settings-label", htmlFor: "dshmc-sessions-per-workspace", children: "Sessions per workspace" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              id: "dshmc-sessions-per-workspace",
              className: "dshmc-settings-select",
              value: String(normalizeSessionLimit(settings.sessionsPerWorkspace)),
              onChange: (e) => updateSettings({ sessionsPerWorkspace: normalizeSessionLimit(e.target.value) }),
              children: SESSIONS_PER_WORKSPACE_CHOICES.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: String(n), children: n === SESSIONS_PER_WORKSPACE_ALL ? "All" : `Last ${n}` }, n))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-settings-hint", children: "Fleet groups list this many sessions; the rest stay one click away." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dshmc-settings-label", htmlFor: "dshmc-fleet-sort", children: "Sort sessions by" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              id: "dshmc-fleet-sort",
              className: "dshmc-settings-select",
              value: normalizeFleetSort(settings.fleetSort),
              onChange: (e) => updateSettings({ fleetSort: normalizeFleetSort(e.target.value) }),
              children: FLEET_SORT_CHOICES.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: c.value, children: c.label }, c.value))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-settings-hint", children: "Sessions needing attention always stay on top; this orders the rest." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-settings-sep", children: "Pomodoro" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-settings-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dshmc-settings-check", htmlFor: "dshmc-pomo-enabled", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "dshmc-pomo-enabled",
              type: "checkbox",
              checked: settings.pomodoroEnabled,
              onChange: (e) => updateSettings({ pomodoroEnabled: e.target.checked })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-settings-label", children: "Show break timer" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dshmc-settings-label", htmlFor: "dshmc-pomo-work", children: "Focus minutes" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "dshmc-pomo-work",
              className: "dshmc-settings-num",
              type: "number",
              min: POMODORO_MIN_MINUTES,
              max: POMODORO_MAX_MINUTES,
              value: settings.workMinutes,
              onChange: (e) => updateSettings({ workMinutes: normalizeMinutes(e.target.value, DEFAULT_WORK_MINUTES) })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dshmc-settings-label", htmlFor: "dshmc-pomo-break", children: "Break minutes" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "dshmc-pomo-break",
              className: "dshmc-settings-num",
              type: "number",
              min: POMODORO_MIN_MINUTES,
              max: POMODORO_MAX_MINUTES,
              value: settings.breakMinutes,
              onChange: (e) => updateSettings({ breakMinutes: normalizeMinutes(e.target.value, DEFAULT_BREAK_MINUTES) })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dshmc-settings-label", htmlFor: "dshmc-pomo-long", children: "Long break minutes" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "dshmc-pomo-long",
              className: "dshmc-settings-num",
              type: "number",
              min: POMODORO_MIN_MINUTES,
              max: POMODORO_MAX_MINUTES,
              value: settings.longBreakMinutes,
              onChange: (e) => updateSettings({ longBreakMinutes: normalizeMinutes(e.target.value, DEFAULT_LONG_BREAK_MINUTES) })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-settings-hint", children: [
          "A long break replaces the short one every ",
          POMODORO_LONG_EVERY,
          " focus stretches."
        ] })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-modes", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: `dshmc-mode${mode === "fleet" ? " on" : ""}`, onClick: () => setMode("fleet"), children: "Fleet" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: `dshmc-mode${mode === "inbox" ? " on" : ""}`, onClick: () => setMode("inbox"), children: [
          "Inbox",
          pendingRows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-mode-badge", children: pendingRows.length }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: `dshmc-mode${mode === "feed" ? " on" : ""}`, onClick: () => setMode("feed"), children: [
          "Feed",
          mode !== "feed" && unreadFeed > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshmc-mode-badge", children: unreadFeed }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshmc-mode", onClick: () => setStageOpen(true), title: "Full-screen live grid", children: "Stage" })
      ] }),
      mode === "feed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeedView, { events: feed, onOpen: openSession, now: nowTick }) }) : mode === "inbox" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InboxView, { ctx, list, pendingRows, pendingWaits, counts, onOpen: openSession, now: nowTick }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-body", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SearchBox, { ctx, list, onOpen: openSession }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshmc-stats", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { value: counts.sessions, label: "sessions" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { value: counts.running, label: "running", tone: "live" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { value: counts.subagents, label: "subagents", tone: "swarm" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { value: pendingRows.length, label: "waiting", tone: "waiting" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-section", children: "Fleet" }),
        groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshmc-empty", children: "No sessions yet." }) : limitedGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          GroupView,
          {
            ctx,
            group,
            collapsed: !!collapsedGroups[group.key],
            onToggle: () => toggleGroup(group.key),
            expanded: expandedGroups.has(group.key),
            onToggleExpanded: () => toggleGroupExpanded(group.key),
            current: list.current,
            onSelect: selectSession,
            modelDirs,
            rate: pulse.rate,
            collapsedRows,
            onToggleRow: toggleRowCollapsed
          },
          group.key
        ))
      ] }),
      settings.pomodoroEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        PomodoroBar,
        {
          config: pomodoroConfig,
          settingsOpen,
          onConfigure: () => setSettingsOpen((v) => !v)
        }
      ) : null
    ] }),
    !open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        className: `dshmc-reopen${counts.active > 0 ? " is-live" : pendingRows.length > 0 ? " is-waiting" : ""}`,
        onClick: reopen,
        title: "Open Mission Control",
        children: [
          counts.running > 0 ? `${counts.running} running` : "",
          counts.subagents > 0 ? `${counts.subagents} subagents` : "",
          pendingRows.length > 0 ? `${pendingRows.length} waiting` : ""
        ].filter(Boolean).join(" \xB7 ") || "Mission Control"
      }
    ) : null
  ] });
}
function apply(ctx) {
  ctx.effect(
    () => ctx.slots.inject(
      "shell.overlay",
      () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-mission-control" },
        () => import_react.default.createElement(MissionControl, { ctx })
      )
    ),
    "dsh-mission-control: shell.overlay registration"
  );
}

		return module.exports;
	}
});