var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// plugins/dsh-hooks/src/index.ts
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// plugins/dsh-hooks/src/config.ts
import { readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { join as join2 } from "node:path";
import z from "@deepseek-ai/schemastery";

// plugins/dsh-hooks/src/types.ts
var HOOK_EVENTS = [
  /** `tools/pre-execute` — allow / deny / ask before a tool dispatches. */
  "PreToolUse",
  /** `tools/post-execute` — accept / block a settled tool result, or add context. */
  "PostToolUse",
  /** `agent/pre-step`, gated to steps that claimed a user-sourced message. */
  "UserPromptSubmit",
  /** `agent/session-start` — fires for startup, resume, clear AND compact. */
  "SessionStart",
  /** `agent/disposed` — observe only; teardown is never delayed on a decision. */
  "SessionEnd",
  /** `agent/turn-stopping` — may steer the agent back into another step. */
  "Stop",
  /** `subagent/end` — observe only. */
  "SubagentStop",
  /** `approval/request` — observe only; the approval waterfall decides. */
  "Notification"
];
var HOOK_EVENT_SET = new Set(HOOK_EVENTS);
var DECIDING_EVENTS = /* @__PURE__ */ new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop"
]);
var DEFAULT_TIMEOUT_SECONDS = 60;
var MAX_TIMEOUT_SECONDS = 600;
var MAX_OUTPUT_BYTES = 256 * 1024;
var RECENT_LIMIT = 200;

// plugins/dsh-hooks/src/hints.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
var DEFAULT_MAX_HINTS = 3;
var MAX_MAX_HINTS = 6;
var MAX_REASON = 120;
var LONG_SESSION_PROMPTS = 25;
var FEATURE_EDITS = 3;
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", "bin", "obj", "dist", "build", "out", "target", "vendor", ".git"]);
var MAX_ENTRIES = 400;
var FINGERPRINT_TTL_MS = 3e4;
var fingerprintCache = /* @__PURE__ */ new Map();
function resetFingerprintCache() {
  fingerprintCache.clear();
}
__name(resetFingerprintCache, "resetFingerprintCache");
function dependencyNames(path) {
  const names = /* @__PURE__ */ new Set();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = parsed[field];
      if (block === null || typeof block !== "object") continue;
      for (const key of Object.keys(block)) names.add(key);
    }
  } catch {
  }
  return names;
}
__name(dependencyNames, "dependencyNames");
function fingerprint(cwd) {
  const now = Date.now();
  let topMtime = 0;
  try {
    topMtime = statSync(cwd).mtimeMs;
  } catch {
    return /* @__PURE__ */ new Set();
  }
  const cached = fingerprintCache.get(cwd);
  if (cached !== void 0 && cached.mtimeMs === topMtime && now - cached.at < FINGERPRINT_TTL_MS) {
    return cached.types;
  }
  const types = /* @__PURE__ */ new Set();
  let budget = MAX_ENTRIES;
  const seen = [];
  try {
    const top = readdirSync(cwd, { withFileTypes: true });
    const subdirs = [];
    for (const entry of top) {
      if (budget-- <= 0) break;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        subdirs.push(entry.name);
        continue;
      }
      seen.push({ dir: cwd, name: entry.name });
    }
    for (const sub of subdirs) {
      if (budget <= 0) break;
      const dir = join(cwd, sub);
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (budget-- <= 0) break;
          if (!entry.isDirectory()) seen.push({ dir, name: entry.name });
        }
      } catch {
      }
    }
  } catch {
    return /* @__PURE__ */ new Set();
  }
  for (const { dir, name } of seen) {
    if (/\.(csproj|sln|slnx)$/i.test(name) || name === "global.json") types.add("dotnet");
    if (name === "tauri.conf.json") types.add("tauri");
    if (name === "components.json") {
      try {
        const raw = readFileSync(join(dir, name), "utf8");
        if (/"\$schema"\s*:\s*"[^"]*shadcn/i.test(raw)) types.add("shadcn");
      } catch {
      }
    }
    if (name === "package.json") {
      const deps = dependencyNames(join(dir, name));
      if (deps.has("next")) types.add("nextjs");
      if (deps.has("remotion") || deps.has("@remotion/cli")) types.add("remotion");
      if (deps.has("@tauri-apps/api") || deps.has("@tauri-apps/cli")) types.add("tauri");
    }
  }
  fingerprintCache.set(cwd, { types, mtimeMs: topMtime, at: now });
  return types;
}
__name(fingerprint, "fingerprint");
var phraseCache = /* @__PURE__ */ new WeakMap();
var MIN_PHRASE = 6;
function phrasesOf(skill) {
  const hit = phraseCache.get(skill);
  if (hit !== void 0) return hit;
  const out = /* @__PURE__ */ new Set();
  const source = `${skill.description} ${skill.whenToUse ?? ""}`;
  for (const match of source.matchAll(/["“”']([^"“”']{6,80})["“”']/g)) {
    const phrase = match[1]?.trim().toLowerCase();
    if (phrase !== void 0 && phrase.length >= MIN_PHRASE) out.add(phrase);
  }
  const phrases = [...out];
  phraseCache.set(skill, phrases);
  return phrases;
}
__name(phrasesOf, "phrasesOf");
function matchesPrompt(prompt, skill) {
  if (prompt === "") return void 0;
  const haystack = prompt.toLowerCase();
  for (const phrase of phrasesOf(skill)) {
    if (haystack.includes(phrase)) return phrase;
  }
  return void 0;
}
__name(matchesPrompt, "matchesPrompt");
var SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|cs|fs|vb|py|rb|go|rs|java|kt|swift|php|c|h|cc|cpp|hpp|m|mm|sql|sh|ps1|vue|svelte|razor|cshtml)$/i;
var TEST_PATH = /(^|[\\/])(tests?|__tests__|spec)([\\/]|$)|\.(test|spec)\.[a-z]+$/i;
function hasSourceEdits(paths) {
  for (const path of paths) {
    if (SOURCE_EXT.test(path) && !TEST_PATH.test(path)) return true;
  }
  return false;
}
__name(hasSourceEdits, "hasSourceEdits");
var BUG_WORDS = /\b(bug|broken|failing|fails|crash(es|ed|ing)?|error|regression|flaky|stack ?trace)\b/i;
var PLAN_WORDS = /\b(plan|design|architect(ure)?|spec)\b/i;
var RULES = [
  {
    id: "project:dotnet",
    priority: 20,
    title: ".NET project",
    reason: "A .csproj/.sln is in this workspace.",
    patterns: [/dotnet/i],
    fires: /* @__PURE__ */ __name((s) => s.projectTypes.has("dotnet"), "fires")
  },
  {
    id: "project:nextjs",
    priority: 20,
    title: "Next.js project",
    reason: "package.json depends on next.",
    patterns: [/nextjs|next-js/i],
    fires: /* @__PURE__ */ __name((s) => s.projectTypes.has("nextjs"), "fires")
  },
  {
    id: "project:tauri",
    priority: 20,
    title: "Tauri project",
    reason: "A Tauri config is in this workspace.",
    patterns: [/tauri/i],
    fires: /* @__PURE__ */ __name((s) => s.projectTypes.has("tauri"), "fires")
  },
  {
    id: "project:remotion",
    priority: 20,
    title: "Remotion project",
    reason: "package.json depends on remotion.",
    patterns: [/remotion-best-practices|^remotion/i],
    fires: /* @__PURE__ */ __name((s) => s.projectTypes.has("remotion"), "fires")
  },
  {
    id: "project:shadcn",
    priority: 25,
    title: "shadcn/ui project",
    reason: "components.json names the shadcn schema.",
    patterns: [/shadcn/i],
    fires: /* @__PURE__ */ __name((s) => s.projectTypes.has("shadcn"), "fires")
  },
  {
    id: "prompt:bug",
    priority: 12,
    title: "Sounds like a bug",
    reason: "Your prompt describes something failing.",
    patterns: [/^diagnose$|systematic-debugging|:debug$|^debug$/i],
    // Only when the generic phrase rule found nothing: a skill that advertised
    // "debug this" already produced a sharper hint, and two chips for the same
    // intent is one chip too many.
    fires: /* @__PURE__ */ __name((s, phraseHit) => !phraseHit && BUG_WORDS.test(s.lastPrompt), "fires")
  },
  {
    id: "prompt:plan",
    priority: 12,
    title: "Worth planning first",
    reason: "Your prompt is about design rather than a change.",
    patterns: [/plan-and-build|writing-plans|brainstorming/i],
    fires: /* @__PURE__ */ __name((s, phraseHit) => !phraseHit && PLAN_WORDS.test(s.lastPrompt), "fires")
  },
  {
    id: "turn:feature-done",
    priority: 5,
    title: "Work landed cleanly",
    reason: "The turn made several edits with no tool errors.",
    patterns: [/^code-review$|:code-review$|verification-before-completion/i, /write-tests|test-driven-development/i],
    fires: /* @__PURE__ */ __name((s) => s.status === "idle" && s.lastTurn.edits >= FEATURE_EDITS && s.lastTurn.toolErrors === 0 && !s.lastTurn.usedSkill && hasSourceEdits(s.editedPaths), "fires")
  },
  {
    id: "turn:tests-missing",
    priority: 8,
    title: "No tests ran",
    reason: "Several files changed and nothing ran a test command.",
    patterns: [/write-tests|test-driven-development/i],
    fires: /* @__PURE__ */ __name((s) => s.status === "idle" && s.lastTurn.edits >= FEATURE_EDITS && !s.lastTurn.ranTests && hasSourceEdits(s.editedPaths), "fires")
  },
  {
    id: "turn:ready-to-ship",
    priority: 6,
    title: "Ready to ship",
    reason: "This turn touched git, or the work has already been reviewed.",
    patterns: [/conventional-commits/i, /create-pr|finishing-a-development-branch|ship-it/i],
    fires: /* @__PURE__ */ __name((s) => s.status === "idle" && (s.lastTurn.committed || s.lastTurn.edits >= FEATURE_EDITS && [...s.skillsUsed].some((name) => /code-review/i.test(name))), "fires")
  },
  {
    id: "session:long",
    priority: 30,
    title: "Long session",
    reason: "Capture the state before context runs short.",
    patterns: [/^handoff$|:handoff$/i],
    fires: /* @__PURE__ */ __name((s) => s.prompts >= LONG_SESSION_PROMPTS, "fires")
  }
];
var RULE_IDS = RULES.map((rule) => rule.id);
var PHRASE_RULE = { id: "prompt:phrase", priority: 10 };
function clampReason(text) {
  return text.length <= MAX_REASON ? text : `${text.slice(0, MAX_REASON - 1)}\u2026`;
}
__name(clampReason, "clampReason");
var _HintEngine = class _HintEngine {
  /**
   * @param options - initial configuration, normally from settings.
   */
  constructor(options = {}) {
    __publicField(this, "maxHints");
    __publicField(this, "disabled");
    this.maxHints = DEFAULT_MAX_HINTS;
    this.disabled = /* @__PURE__ */ new Set();
    this.configure(options);
  }
  /**
   * Re-read configuration in place.
   *
   * The engine is held by the service for the process lifetime and settings
   * reload live, so replacing the instance on every settings commit would
   * throw away nothing useful but would make the ownership harder to follow.
   * @param options - the new configuration.
   */
  configure(options) {
    const max = options.maxHints;
    this.maxHints = typeof max === "number" && Number.isFinite(max) ? Math.min(Math.max(1, Math.trunc(max)), MAX_MAX_HINTS) : DEFAULT_MAX_HINTS;
    this.disabled = new Set(options.disableRules ?? []);
  }
  /**
   * Compute the chips for one session.
   * @param situation - what is happening in the session.
   * @param catalog - the skills actually installed and visible to this agent.
   * @returns at most `maxHints` hints, sorted by priority then id.
   */
  compute(situation, catalog) {
    const usable = catalog.filter(
      (skill) => skill.invocation.userInvocable && !situation.skillsUsed.has(skill.name)
    );
    if (usable.length === 0) return [];
    const bySkill = /* @__PURE__ */ new Map();
    const offer = /* @__PURE__ */ __name((hint) => {
      if (situation.dismissed.has(hint.id)) return;
      const existing = bySkill.get(hint.skill);
      if (existing !== void 0) {
        const better = hint.priority < existing.priority || hint.priority === existing.priority && hint.id < existing.id;
        if (!better) return;
      }
      bySkill.set(hint.skill, hint);
    }, "offer");
    let phraseHit = false;
    if (this.enabled(PHRASE_RULE.id) && situation.lastPrompt !== "") {
      for (const skill of usable) {
        const phrase = matchesPrompt(situation.lastPrompt, skill);
        if (phrase === void 0) continue;
        phraseHit = true;
        offer({
          id: `${PHRASE_RULE.id}:${skill.name}`,
          skill: skill.name,
          title: "Matches your prompt",
          reason: clampReason(`This skill lists \u201C${phrase}\u201D as a trigger.`),
          priority: PHRASE_RULE.priority,
          rule: PHRASE_RULE.id
        });
      }
    }
    for (const rule of RULES) {
      if (!this.enabled(rule.id)) continue;
      let applies;
      try {
        applies = rule.fires(situation, phraseHit);
      } catch (err) {
        console.warn(`[dsh-hooks] hints: rule ${rule.id} threw:`, err);
        continue;
      }
      if (!applies) continue;
      for (const pattern of rule.patterns) {
        const skill = usable.find((candidate) => pattern.test(candidate.name));
        if (skill === void 0) continue;
        offer({
          id: `${rule.id}:${skill.name}`,
          skill: skill.name,
          title: rule.title,
          reason: clampReason(rule.reason),
          priority: rule.priority,
          rule: rule.id
        });
      }
    }
    return [...bySkill.values()].sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1).slice(0, this.maxHints);
  }
  /** Whether a rule id survived `disableRules`. */
  enabled(rule) {
    return !this.disabled.has(rule);
  }
};
__name(_HintEngine, "HintEngine");
var HintEngine = _HintEngine;
function emptyTurn() {
  return { edits: 0, ranTests: false, committed: false, toolErrors: 0, usedSkill: false };
}
__name(emptyTurn, "emptyTurn");
var EDIT_TOOLS = /* @__PURE__ */ new Set(["edit", "write", "str_replace_editor", "create_file", "multi_edit"]);
var SHELL_TOOLS = /* @__PURE__ */ new Set(["bash", "pwsh", "bash_persistent", "pwsh_persistent"]);
var TEST_COMMAND = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(vitest|jest|mocha|pytest|phpunit|rspec)\b|\bdotnet\s+test\b|\bcargo\s+test\b|\bgo\s+test\b|\bpytest\b|\bnode\s+--test\b/i;
var COMMIT_COMMAND = /\bgit\s+(add|commit)\b/i;
function observeToolCall(name, args, isError, turn) {
  if (isError) turn.toolErrors += 1;
  const record = args !== null && typeof args === "object" ? args : {};
  if (name === "skill") {
    turn.usedSkill = true;
    return void 0;
  }
  if (SHELL_TOOLS.has(name)) {
    const command = typeof record.command === "string" ? record.command : "";
    if (TEST_COMMAND.test(command)) turn.ranTests = true;
    if (COMMIT_COMMAND.test(command)) turn.committed = true;
    return void 0;
  }
  if (!EDIT_TOOLS.has(name)) return void 0;
  if (name === "str_replace_editor" && record.command === "view") return void 0;
  if (isError) return void 0;
  turn.edits += 1;
  for (const key of ["path", "file_path", "filePath"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return void 0;
}
__name(observeToolCall, "observeToolCall");
function invokedSkillNames(prompt) {
  const names = [];
  for (const match of prompt.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)) {
    const name = match[2];
    if (name !== void 0 && !names.includes(name)) names.push(name);
  }
  return names;
}
__name(invokedSkillNames, "invokedSkillNames");

// plugins/dsh-hooks/src/config.ts
var DOT_DSH = ".dsh";
var PROJECT_FILE = "hooks.json";
var commandSchema = z.object({
  type: z.union(["command"]).default("command").description("Only `command` exists today."),
  command: z.string().required().description("Shell command line, run through the configured shell."),
  timeout: z.number().min(1).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS).description("Wall-clock budget in seconds before the process tree is terminated."),
  failClosed: z.boolean().default(false).description(
    "Treat a crash, timeout or unparseable reply as a denial. Off by default so a broken hook cannot brick every tool call."
  )
});
var groupSchema = z.object({
  matcher: z.string().default("").description("Regular expression over the tool name. Empty or `*` matches every tool."),
  hooks: z.array(commandSchema).default([]).description("Commands run in parallel when the matcher hits.")
});
var hintsSchema = z.object({
  enabled: z.boolean().default(true).description("Master switch for the hint strip and the engine behind it."),
  max: z.number().min(1).max(MAX_MAX_HINTS).default(DEFAULT_MAX_HINTS).description("How many chips may show at once."),
  disableRules: z.array(z.string()).default([]).description('Rule ids to silence, e.g. ["session:long", "prompt:plan"].')
}).default({ enabled: true, max: DEFAULT_MAX_HINTS, disableRules: [] }).description("Contextual skill hints rendered above the composer.");
var HooksSettings = z.object({
  enabled: z.boolean().default(true).description("Master switch for every hook in both layers."),
  shell: z.array(z.string()).default([]).description(
    'argv prefix the command line is appended to, e.g. ["bash","-lc"]. Empty picks the platform default: pwsh/powershell on Windows, bash elsewhere.'
  ),
  projectHooks: z.boolean().default(true).description("Also read <workspace>/.dsh/hooks.json. Turn off to trust only your own settings."),
  hooks: z.object(Object.fromEntries(HOOK_EVENTS.map((event) => [event, z.array(groupSchema).default([])]))).default({}).description("Matcher groups per lifecycle point."),
  hints: hintsSchema
});
function defaultShell() {
  return process.platform === "win32" ? ["pwsh", "-NoProfile", "-NonInteractive", "-Command"] : ["bash", "-lc"];
}
__name(defaultShell, "defaultShell");
function coerceCommand(value) {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  if (typeof raw.command !== "string" || raw.command.trim() === "") return void 0;
  if (raw.type !== void 0 && raw.type !== "command") return void 0;
  const timeout = typeof raw.timeout === "number" && Number.isFinite(raw.timeout) && raw.timeout > 0 ? Math.min(raw.timeout, MAX_TIMEOUT_SECONDS) : DEFAULT_TIMEOUT_SECONDS;
  return {
    type: "command",
    command: raw.command,
    timeout,
    failClosed: raw.failClosed === true
  };
}
__name(coerceCommand, "coerceCommand");
function coerceDocument(value) {
  const config = {};
  let dropped = 0;
  if (!value || typeof value !== "object") return { config, dropped };
  for (const [key, raw] of Object.entries(value)) {
    if (!HOOK_EVENT_SET.has(key)) {
      dropped += 1;
      continue;
    }
    if (!Array.isArray(raw)) {
      dropped += 1;
      continue;
    }
    const groups = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        dropped += 1;
        continue;
      }
      const group = entry;
      const hooks = [];
      for (const command of Array.isArray(group.hooks) ? group.hooks : []) {
        const coerced = coerceCommand(command);
        if (coerced === void 0) dropped += 1;
        else hooks.push(coerced);
      }
      if (hooks.length === 0) continue;
      groups.push({
        matcher: typeof group.matcher === "string" ? group.matcher : void 0,
        hooks
      });
    }
    if (groups.length > 0) config[key] = groups;
  }
  return { config, dropped };
}
__name(coerceDocument, "coerceDocument");
var _ProjectHooks = class _ProjectHooks {
  constructor() {
    __publicField(this, "cache", /* @__PURE__ */ new Map());
  }
  /**
   * Read one workspace's project-layer document.
   * @param workspaceDir - absolute workspace directory.
   * @returns the parsed document, or an empty one when absent or unreadable.
   */
  read(workspaceDir) {
    const path = join2(workspaceDir, DOT_DSH, PROJECT_FILE);
    let stamp;
    try {
      const stat = statSync2(path);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      this.cache.delete(path);
      return { config: {}, dropped: 0, path };
    }
    const cached = this.cache.get(path);
    if (cached?.stamp === stamp) return { config: cached.config, dropped: cached.dropped, path };
    try {
      const { config, dropped } = coerceDocument(JSON.parse(readFileSync2(path, "utf8")));
      this.cache.set(path, { stamp, config, dropped });
      return { config, dropped, path };
    } catch (err) {
      console.warn(`[dsh-hooks] ignoring unparseable ${path}:`, err instanceof Error ? err.message : err);
      this.cache.set(path, { stamp, config: {}, dropped: 0 });
      return { config: {}, dropped: 0, path };
    }
  }
  /** Drop every cached parse; used when the plugin is reconfigured. */
  clear() {
    this.cache.clear();
  }
};
__name(_ProjectHooks, "ProjectHooks");
var ProjectHooks = _ProjectHooks;
function resolveHooks(event, user, project, userOrigin, projectOrigin) {
  const out = [];
  for (const [config, source, origin] of [
    [user, "user", userOrigin],
    [project, "project", projectOrigin]
  ]) {
    for (const group of config[event] ?? []) {
      for (const command of group.hooks) {
        out.push({ event, matcher: group.matcher, command, source, origin });
      }
    }
  }
  return out;
}
__name(resolveHooks, "resolveHooks");

// plugins/dsh-hooks/src/matcher.ts
var compiled = /* @__PURE__ */ new Map();
var warned = /* @__PURE__ */ new Set();
function isWildcard(matcher) {
  if (matcher === void 0) return true;
  const trimmed = matcher.trim();
  return trimmed === "" || trimmed === "*";
}
__name(isWildcard, "isWildcard");
function compile(matcher) {
  const cached = compiled.get(matcher);
  if (cached !== void 0) return cached;
  let value;
  try {
    value = new RegExp(matcher);
  } catch {
    value = null;
  }
  compiled.set(matcher, value);
  return value;
}
__name(compile, "compile");
function matchesTool(matcher, toolName) {
  if (isWildcard(matcher)) return true;
  if (toolName === void 0) return false;
  const expression = compile(matcher);
  if (expression === null) {
    if (!warned.has(matcher)) {
      warned.add(matcher);
      console.warn(
        `[dsh-hooks] matcher ${JSON.stringify(matcher)} is not a valid regular expression; it will never match`
      );
    }
    return false;
  }
  return expression.test(toolName);
}
__name(matchesTool, "matchesTool");
function resetMatcherCache() {
  compiled.clear();
  warned.clear();
}
__name(resetMatcherCache, "resetMatcherCache");

// plugins/dsh-hooks/src/runner.ts
var GRACE_MS = 2e3;
function parseHookOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "" || !trimmed.startsWith("{")) return void 0;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
__name(parseHookOutput, "parseHookOutput");
function hookEnv(payload, projectDir) {
  return {
    DSH_PROJECT_DIR: projectDir,
    DSH_SESSION_ID: payload.session_id,
    DSH_HOOK_EVENT: payload.hook_event_name,
    // Parity alias so a hook script written against Claude Code runs unchanged.
    CLAUDE_PROJECT_DIR: projectDir
  };
}
__name(hookEnv, "hookEnv");
async function runHook(deps, hook, payload, cwd, outerSignal) {
  const startedAt = Date.now();
  const base = {
    event: hook.event,
    command: hook.command.command,
    source: hook.source,
    sessionId: payload.session_id,
    ...payload.tool_name !== void 0 ? { toolName: payload.tool_name } : {},
    startedAt,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: ""
  };
  const timeoutMs = (hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1e3;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = /* @__PURE__ */ __name(() => controller.abort(), "onOuterAbort");
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const handle = deps.subprocess.spawn({
      argv: [...deps.shell, hook.command.command],
      cwd,
      stdio: {
        stdin: { data: JSON.stringify(payload) },
        stdout: { maxBytes: MAX_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_OUTPUT_BYTES }
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
      env: hookEnv(payload, cwd)
    });
    const outcome = await handle.done;
    const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
    const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
    const output = parseHookOutput(stdout);
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      stdout,
      stderr,
      ...output !== void 0 ? { output } : {}
    };
  } catch (err) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      timedOut,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}
__name(runHook, "runHook");
function refusalReason(run, hook) {
  if (run.exitCode === 2) {
    return run.stderr.trim() || `hook exited 2: ${hook.command.command}`;
  }
  const failed = run.error !== void 0 || run.timedOut || run.exitCode !== null && run.exitCode !== 0;
  if (!failed) return void 0;
  if (!hook.command.failClosed) return void 0;
  if (run.timedOut) return `hook timed out after ${hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS}s: ${hook.command.command}`;
  if (run.error !== void 0) return `hook could not run: ${run.error}`;
  return run.stderr.trim() || `hook exited ${run.exitCode}: ${hook.command.command}`;
}
__name(refusalReason, "refusalReason");
function decisionOf(output) {
  const permission = output.hookSpecificOutput?.permissionDecision;
  const permissionReason = output.hookSpecificOutput?.permissionDecisionReason ?? output.reason ?? "";
  if (permission === "deny" || output.decision === "block") {
    return { kind: "deny", reason: (permission === "deny" ? permissionReason : output.reason) || "blocked by hook" };
  }
  if (permission === "ask") return { kind: "ask", reason: permissionReason || "a hook asked for confirmation" };
  if (permission === "allow" || output.decision === "approve") {
    return { kind: "approve", reason: permissionReason || output.reason || "" };
  }
  return void 0;
}
__name(decisionOf, "decisionOf");
async function runHooks(deps, hooks, payload, cwd, signal) {
  const selected = hooks.filter((hook) => matchesTool(hook.matcher, payload.tool_name));
  const verdict = { additionalContext: [], runs: [] };
  if (selected.length === 0) return verdict;
  const settled = await Promise.all(
    selected.map(async (hook) => ({ hook, run: await runHook(deps, hook, payload, cwd, signal) }))
  );
  for (const { hook, run } of settled) {
    verdict.runs.push(run);
    const context = run.output?.hookSpecificOutput?.additionalContext;
    if (typeof context === "string" && context.trim() !== "") verdict.additionalContext.push(context);
    if (run.output?.hookSpecificOutput?.updatedInput !== void 0) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned updatedInput, which dsh cannot honour: PreToolDecision is allow/deny/ask only and tool arguments are already logged. Deny the call instead if the arguments are unacceptable.`
      );
    }
    const decision = run.output ? decisionOf(run.output) : void 0;
    if (decision !== void 0 && !DECIDING_EVENTS.has(hook.event)) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned a "${decision.kind}" decision on ${hook.event}, which cannot act on one; it was recorded but had no effect.`
      );
    }
    const refusal = refusalReason(run, hook);
    const failed = run.error !== void 0 || run.timedOut || run.exitCode !== null && run.exitCode !== 0;
    if (failed && run.exitCode !== 2) {
      const detail = run.error ?? (run.timedOut ? "timed out" : `exit ${run.exitCode}`);
      const effect = refusal !== void 0 ? "blocking, failClosed" : "non-blocking";
      console.warn(`[dsh-hooks] ${hook.event} hook failed (${effect}): ${hook.command.command} \u2014 ${detail}`);
      if (run.stderr.trim() !== "") console.warn(`[dsh-hooks]   stderr: ${run.stderr.trim()}`);
    }
    if (refusal !== void 0) {
      verdict.denied ??= { reason: refusal };
      continue;
    }
    if (decision === void 0 || !DECIDING_EVENTS.has(hook.event)) continue;
    if (decision.kind === "deny") verdict.denied ??= { reason: decision.reason };
    else if (decision.kind === "ask") verdict.asked ??= { reason: decision.reason };
  }
  return verdict;
}
__name(runHooks, "runHooks");

// plugins/dsh-hooks/src/index.ts
var MAX_STOP_CONTINUATIONS = 5;
var NAMESPACE = "dsh-hooks";
var RECOMPUTE_DEBOUNCE_MS = 250;
var CATALOG_TTL_MS = 6e4;
var MAX_TRACKED_SESSIONS = 200;
var MAX_TRACKED_PATHS = 500;
function joinIds(hints) {
  return hints.map((hint) => hint.id).join("\n");
}
__name(joinIds, "joinIds");
function settingsNamespace(value) {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match /^[a-z][a-z0-9-]*$/`);
  }
  return value;
}
__name(settingsNamespace, "settingsNamespace");
var EMPTY_SETTINGS = {
  enabled: true,
  shell: [],
  projectHooks: true,
  hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, []])),
  hints: { enabled: true, max: 3, disableRules: [] }
};
var _dismissHint_dec, _hintsToken_dec, _hints_dec, _recent_dec, _describe_dec, _a, _init, _b;
var _HooksService = class _HooksService extends (_b = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the tool registry and subprocess seam.
   */
  constructor(ctx) {
    super(ctx, "dshHooks");
    __runInitializers(_init, 5, this);
    /** Latest resolved settings-namespace value. */
    __publicField(this, "settings", EMPTY_SETTINGS);
    /**
     * The user layer, coerced once per settings value.
     *
     * `tools/pre-execute` is awaited before EVERY tool dispatch, so anything
     * `hooksFor` does runs on the hot path. Re-coercing the whole settings
     * document there allocated a fresh config object per tool call, for a value
     * that only changes when the user edits settings.yaml.
     */
    __publicField(this, "userConfigCache");
    /** Absolute path of the settings document, when the provider exposes one. */
    __publicField(this, "userOrigin");
    /** Project-layer document reader, cached per workspace against mtime+size. */
    __publicField(this, "project", new ProjectHooks());
    /** Newest-last ring of settled runs, served by `recent`. */
    __publicField(this, "runs", []);
    /** Consecutive hook-driven continuations per agent, bounded by {@link MAX_STOP_CONTINUATIONS}. */
    __publicField(this, "stopDepth", /* @__PURE__ */ new WeakMap());
    /** Working directory captured at `subagent/start`, keyed by run id. */
    __publicField(this, "subagentCwd", /* @__PURE__ */ new Map());
    /** Hint engine, reconfigured in place on every settings commit. */
    __publicField(this, "engine", new HintEngine());
    /**
     * Per-session hint state, keyed by `String(agent.id)` — the same value
     * `basePayload` puts on the wire as `session_id`, so the client can address
     * a session with the id it already has.
     *
     * Insertion-ordered, which is what makes the {@link MAX_TRACKED_SESSIONS}
     * bound an LRU-by-first-seen rather than an arbitrary eviction.
     */
    __publicField(this, "hintStates", /* @__PURE__ */ new Map());
  }
  /** Register the settings namespace, then wire every lifecycle listener. */
  async [(_a = Service.init, _describe_dec = [Remote], _recent_dec = [Remote], _hints_dec = [Remote], _hintsToken_dec = [Remote], _dismissHint_dec = [Remote], _a)]() {
    this.ctx.inject(["settings"], (scoped) => {
      const scope = scoped.settings.register(settingsNamespace(NAMESPACE), HooksSettings, { applies: "live" });
      this.settings = scope.get();
      this.applyHintSettings();
      this.userOrigin = scoped.settings.documentPath;
      scoped.effect(
        () => scope.watch((next) => {
          this.settings = next;
          resetMatcherCache();
          this.project.clear();
          this.userConfigCache = void 0;
          this.applyHintSettings();
          for (const sessionId of this.hintStates.keys()) this.scheduleHints(sessionId);
        }),
        "dsh-hooks: settings watcher"
      );
    });
    this.wireToolEvents();
    this.wireAgentEvents();
    this.wireObserverEvents();
    this.wireHintEvents();
  }
  /** Push the resolved `hints` block into the engine. */
  applyHintSettings() {
    const hints = this.settings.hints;
    this.engine.configure({ maxHints: hints.max, disableRules: hints.disableRules });
  }
  // ── configuration ────────────────────────────────────────────────────────
  /**
   * The user layer, coerced from the resolved settings section.
   *
   * Cached against the settings object's identity: the settings service hands
   * out a new resolved value on every commit, so identity is an exact change
   * signal and no revision counter is needed.
   * @returns the coerced user-layer document.
   */
  userConfig() {
    const source = this.settings.hooks;
    if (this.userConfigCache?.source === source) return this.userConfigCache.config;
    const { config } = coerceDocument(source);
    this.userConfigCache = { source, config };
    return config;
  }
  /**
   * Resolve one workspace directory from a session's cwd.
   *
   * The workspace registry is consulted only for the id that rides the payload;
   * the directory itself comes from the session header, so hooks still work in
   * a directory that was never registered as a workspace.
   * @param cwd - the session's working directory.
   * @returns the workspace id, when the cwd matches a registered workspace.
   */
  workspaceIdFor(cwd) {
    if (cwd === void 0) return void 0;
    const registry = this.ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    try {
      const hit = registry.list().find((w) => w.path === cwd);
      return hit === void 0 ? void 0 : String(hit.id);
    } catch {
      return void 0;
    }
  }
  /** The shell argv prefix in force: configured, else the platform default. */
  shell() {
    return this.settings.shell.length > 0 ? this.settings.shell : defaultShell();
  }
  /**
   * Every hook configured for one event, across both layers.
   * @param event - the lifecycle point.
   * @param cwd - the session working directory whose project layer to read.
   * @returns the resolved hooks, or an empty array when hooks are disabled.
   */
  hooksFor(event, cwd) {
    if (!this.settings.enabled) return [];
    const user = this.userConfig();
    let project = {};
    let projectOrigin = "";
    if (this.settings.projectHooks && cwd !== void 0) {
      const read = this.project.read(cwd);
      project = read.config;
      projectOrigin = read.path;
    }
    return resolveHooks(event, user, project, this.userOrigin ?? "(settings)", projectOrigin);
  }
  // ── dispatch ─────────────────────────────────────────────────────────────
  /** The session cwd an agent's hooks run in, falling back to the process cwd. */
  cwdOf(agent) {
    return agent?.session.header.cwd ?? process.cwd();
  }
  /**
   * Build the payload common to every event.
   * @param event - the lifecycle point.
   * @param agent - the agent the event belongs to, when there is one.
   * @returns the base payload, ready for per-event fields.
   */
  basePayload(event, agent) {
    const cwd = this.cwdOf(agent);
    const workspaceId = this.workspaceIdFor(agent?.session.header.cwd);
    return {
      hook_event_name: event,
      session_id: agent === void 0 ? "" : String(agent.id),
      cwd,
      ...workspaceId !== void 0 ? { workspace_id: workspaceId } : {}
    };
  }
  /**
   * Run one event's hooks and record the results.
   *
   * Never throws: a listener that threw would take a tool call or a turn
   * boundary down with it, and a hook runner must not be able to break the
   * harness it observes.
   * @param event - the lifecycle point.
   * @param payload - the JSON handed to each hook.
   * @param cwd - working directory for the children.
   * @param signal - caller cancellation.
   * @returns the folded verdict; an empty one when nothing matched or it failed.
   */
  async dispatch(event, payload, cwd, signal) {
    const hooks = this.hooksFor(event, payload.cwd);
    if (hooks.length === 0) return { additionalContext: [], runs: [] };
    try {
      const verdict = await runHooks(
        { subprocess: this.ctx.subprocess, shell: this.shell() },
        hooks,
        payload,
        cwd,
        signal
      );
      this.record(verdict.runs);
      return verdict;
    } catch (err) {
      console.warn(`[dsh-hooks] ${event} dispatch failed:`, err);
      return { additionalContext: [], runs: [] };
    }
  }
  /** Append settled runs to the ring, trimming from the front. */
  record(runs) {
    this.runs.push(...runs);
    if (this.runs.length > RECENT_LIMIT) this.runs.splice(0, this.runs.length - RECENT_LIMIT);
  }
  /**
   * Turn hook-supplied context into a plugin-sourced user message.
   *
   * `form: 'notice'` is the accurate declaration — a one-off account of
   * something that just happened, superseding nothing — and it is what makes
   * the harness render it as a collapsed row rather than as instructions.
   * @param event - the lifecycle point, used in the collapsed summary.
   * @param text - the hook's `additionalContext`.
   * @returns a frozen user message ready for `inject` / `additionalContexts`.
   */
  contextMessage(event, text) {
    return createUserMessage({
      content: [{ type: "text", text }],
      source: {
        kind: "plugin",
        plugin: NAMESPACE,
        form: "notice",
        summary: `${event} hook context`.slice(0, 120)
      }
    });
  }
  // ── tool lifecycle ───────────────────────────────────────────────────────
  /** `PreToolUse` and `PostToolUse`. */
  wireToolEvents() {
    this.ctx.on(
      "tools/pre-execute",
      async (exec, next) => {
        const payload = {
          ...this.basePayload("PreToolUse", exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments
        };
        const verdict = await this.dispatch("PreToolUse", payload, payload.cwd, exec.signal);
        if (verdict.denied !== void 0) return { kind: "deny", reason: verdict.denied.reason };
        if (verdict.asked !== void 0) return { kind: "ask", reason: verdict.asked.reason };
        return next();
      }
    );
    this.ctx.on(
      "tools/post-execute",
      async (exec, result, next) => {
        const payload = {
          ...this.basePayload("PostToolUse", exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments,
          tool_response: result.isError ? { isError: true, error: result.error } : result.value
        };
        this.captureToolCall(exec, result);
        const verdict = await this.dispatch("PostToolUse", payload, payload.cwd, exec.signal);
        const contexts = verdict.additionalContext.map((text) => this.contextMessage("PostToolUse", text));
        if (verdict.denied !== void 0) {
          return {
            kind: "block",
            feedback: [{ type: "text", text: verdict.denied.reason }],
            ...contexts.length > 0 ? { additionalContexts: contexts } : {}
          };
        }
        const base = await next();
        if (contexts.length === 0) return base;
        return { ...base, additionalContexts: [...base.additionalContexts ?? [], ...contexts] };
      }
    );
  }
  /**
   * Fold one settled tool call into the session's turn facts.
   *
   * Wrapped whole: this is an addition to a listener the harness awaits, and
   * a hint-engine bug must not be able to break a tool result.
   * @param exec - the tool execution.
   * @param result - the settled result.
   */
  captureToolCall(exec, result) {
    if (!this.settings.hints.enabled) return;
    try {
      const state = this.hintStateFor(exec.agent);
      if (state === void 0) return;
      const path = observeToolCall(exec.name, exec.arguments, result.isError, state.currentTurn);
      if (path !== void 0 && state.editedPaths.size < MAX_TRACKED_PATHS) state.editedPaths.add(path);
      if (exec.name === "skill" && !result.isError) {
        const args = exec.arguments;
        this.noteSkillUsed(state, args?.name);
      }
      this.scheduleHints(String(exec.agent?.id));
    } catch (err) {
      console.warn("[dsh-hooks] hints: tool capture failed:", err);
    }
  }
  // ── agent lifecycle ──────────────────────────────────────────────────────
  /** `UserPromptSubmit`, `SessionStart` and `Stop`. */
  wireAgentEvents() {
    this.ctx.on(
      "agent/pre-step",
      async (payload, next) => {
        const prompts = payload.messages.filter((message) => message.source.kind === "user");
        if (prompts.length === 0) return next();
        const text = prompts.flatMap((message) => message.content).filter((block) => block.type === "text").map((block) => block.text).join("\n");
        this.capturePrompt(payload.agent, text);
        const hookPayload = { ...this.basePayload("UserPromptSubmit", payload.agent), prompt: text };
        const verdict = await this.dispatch("UserPromptSubmit", hookPayload, hookPayload.cwd, payload.signal);
        if (verdict.denied !== void 0) {
          console.warn(`[dsh-hooks] UserPromptSubmit blocked the step: ${verdict.denied.reason}`);
          return { kind: "reject" };
        }
        if (verdict.additionalContext.length === 0) return next();
        const base = await next();
        if (base.kind === "reject") return base;
        return {
          kind: "enter",
          messages: [
            ...base.messages,
            ...verdict.additionalContext.map((entry) => this.contextMessage("UserPromptSubmit", entry))
          ]
        };
      }
    );
    this.ctx.on("agent/session-start", (payload) => {
      const hookPayload = {
        ...this.basePayload("SessionStart", payload.agent),
        source: payload.source
      };
      this.captureSessionStart(payload.agent);
      void this.dispatch("SessionStart", hookPayload, hookPayload.cwd).then((verdict) => {
        for (const text of verdict.additionalContext) {
          payload.agent.inject(this.contextMessage("SessionStart", text));
        }
      });
    });
    this.ctx.on(
      "agent/turn-stopping",
      async (payload) => {
        this.captureTurnEnd(payload.agent);
        const depth = this.stopDepth.get(payload.agent) ?? 0;
        const hookPayload = {
          ...this.basePayload("Stop", payload.agent),
          stop_hook_active: depth > 0
        };
        const verdict = await this.dispatch("Stop", hookPayload, hookPayload.cwd, payload.signal);
        if (verdict.denied === void 0) {
          this.stopDepth.delete(payload.agent);
          return;
        }
        if (depth >= MAX_STOP_CONTINUATIONS) {
          console.warn(
            `[dsh-hooks] Stop hook asked to continue ${depth} times in a row; ignoring to break the loop. A Stop hook must check \`stop_hook_active\` in its payload and stop asking.`
          );
          this.stopDepth.delete(payload.agent);
          return;
        }
        this.stopDepth.set(payload.agent, depth + 1);
        payload.agent.steer(this.contextMessage("Stop", verdict.denied.reason));
      }
    );
  }
  /**
   * Note a session's workspace shape at start or resume.
   * @param agent - the agent whose session started.
   */
  captureSessionStart(agent) {
    if (!this.settings.hints.enabled) return;
    try {
      const state = this.hintStateFor(agent);
      if (state === void 0) return;
      state.cwd = this.cwdOf(agent);
      state.projectTypes = fingerprint(state.cwd);
      this.scheduleHints(String(agent?.id));
    } catch (err) {
      console.warn("[dsh-hooks] hints: session-start capture failed:", err);
    }
  }
  /**
   * Note a claimed user prompt: it opens a turn and it is the prompt rules' input.
   * @param agent - the agent entering the step.
   * @param text - the joined text of the user-sourced messages.
   */
  capturePrompt(agent, text) {
    if (!this.settings.hints.enabled) return;
    try {
      const state = this.hintStateFor(agent);
      if (state === void 0) return;
      state.lastPrompt = text;
      state.prompts += 1;
      state.status = "running";
      state.currentTurn = emptyTurn();
      for (const name of invokedSkillNames(text)) state.skillsUsed.add(name);
      if (state.projectTypes.size === 0) state.projectTypes = fingerprint(state.cwd);
      this.scheduleHints(String(agent.id));
    } catch (err) {
      console.warn("[dsh-hooks] hints: prompt capture failed:", err);
    }
  }
  /**
   * Close the turn in flight and hand its facts to the turn rules.
   * @param agent - the agent whose turn is stopping.
   */
  captureTurnEnd(agent) {
    if (!this.settings.hints.enabled) return;
    try {
      const state = this.hintStateFor(agent);
      if (state === void 0) return;
      state.lastTurn = state.currentTurn;
      state.currentTurn = emptyTurn();
      state.status = "idle";
      this.scheduleHints(String(agent.id));
    } catch (err) {
      console.warn("[dsh-hooks] hints: turn capture failed:", err);
    }
  }
  // ── observers ────────────────────────────────────────────────────────────
  /** `SessionEnd`, `SubagentStop` and `Notification` — effect only, no verdict. */
  wireObserverEvents() {
    this.ctx.on("agent/disposed", (payload) => {
      this.dropHintState(String(payload.agent.id));
      const hookPayload = this.basePayload("SessionEnd", payload.agent);
      void this.dispatch("SessionEnd", hookPayload, hookPayload.cwd);
    });
    this.ctx.on("subagent/start", (info) => {
      const agent = this.ctx.get("agents")?.get(info.id);
      this.subagentCwd.set(String(info.runId), this.cwdOf(agent));
    });
    this.ctx.on("subagent/end", (info) => {
      const runId = String(info.runId);
      const cwd = this.subagentCwd.get(runId) ?? process.cwd();
      this.subagentCwd.delete(runId);
      const workspaceId = this.workspaceIdFor(cwd);
      const payload = {
        hook_event_name: "SubagentStop",
        session_id: String(info.id),
        cwd,
        ...workspaceId !== void 0 ? { workspace_id: workspaceId } : {},
        message: `subagent ${info.provider} stopped: ${info.stopReason}`
      };
      void this.dispatch("SubagentStop", payload, cwd);
    });
    this.ctx.on(
      "approval/request",
      async (req, next) => {
        const payload = {
          ...this.basePayload("Notification", req.agent),
          tool_name: req.toolName,
          message: req.reason ?? `${req.toolName} is waiting for approval`
        };
        void this.dispatch("Notification", payload, payload.cwd, req.signal);
        return next();
      }
    );
  }
  // ── skill hints ──────────────────────────────────────────────────────────
  /**
   * The hint state for one agent, created on first sight.
   *
   * @param agent - the agent the signal belongs to.
   * @returns the state, or undefined when there is no agent to key on.
   */
  hintStateFor(agent) {
    if (agent === void 0) return void 0;
    const sessionId = String(agent.id);
    const existing = this.hintStates.get(sessionId);
    if (existing !== void 0) {
      existing.scope = agent;
      return existing;
    }
    const cwd = this.cwdOf(agent);
    const state = {
      cwd,
      scope: agent,
      projectTypes: /* @__PURE__ */ new Set(),
      skillsUsed: /* @__PURE__ */ new Set(),
      editedPaths: /* @__PURE__ */ new Set(),
      lastTurn: emptyTurn(),
      currentTurn: emptyTurn(),
      lastPrompt: "",
      prompts: 0,
      status: "idle",
      dismissed: /* @__PURE__ */ new Set(),
      hints: [],
      token: 0,
      catalog: void 0,
      timer: void 0
    };
    this.hintStates.set(sessionId, state);
    while (this.hintStates.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.hintStates.keys().next();
      if (oldest.done === true) break;
      this.dropHintState(oldest.value);
    }
    return state;
  }
  /** Forget one session's hint state, clearing any pending recompute. */
  dropHintState(sessionId) {
    const state = this.hintStates.get(sessionId);
    if (state?.timer !== void 0) clearTimeout(state.timer);
    this.hintStates.delete(sessionId);
  }
  /**
   * Queue a coalesced recompute for one session.
   *
   * A pending timer is left alone rather than reset, so a long burst of tool
   * calls still recomputes on a fixed cadence instead of being starved by its
   * own signals.
   * @param sessionId - the session to recompute.
   */
  scheduleHints(sessionId) {
    if (!this.settings.hints.enabled) return;
    const state = this.hintStates.get(sessionId);
    if (state === void 0 || state.timer !== void 0) return;
    const timer = setTimeout(() => {
      state.timer = void 0;
      void this.recomputeHints(sessionId);
    }, RECOMPUTE_DEBOUNCE_MS);
    timer.unref?.();
    state.timer = timer;
  }
  /**
   * The skills visible to one session's agent, cached per session.
   *
   * @param state - the session's hint state.
   * @returns the user-visible catalog, or an empty list when no registry is composed.
   */
  async catalogFor(state) {
    const now = Date.now();
    if (state.catalog !== void 0 && now - state.catalog.at < CATALOG_TTL_MS) return state.catalog.skills;
    const skills = this.ctx.get("skills");
    if (skills === void 0) return [];
    const summaries = await skills.list({
      cwd: state.cwd,
      ...state.scope !== void 0 ? { scope: state.scope } : {}
    });
    const list = summaries.map((skill) => skill);
    state.catalog = { skills: list, at: now };
    return list;
  }
  /**
   * Recompute one session's chips, bumping the token only if they changed.
   *
   * Never throws and never rejects: this is driven from listeners that must
   * not be able to fail because a hint could not be computed.
   * @param sessionId - the session to recompute.
   */
  async recomputeHints(sessionId) {
    const state = this.hintStates.get(sessionId);
    if (state === void 0) return;
    try {
      const next = this.settings.hints.enabled ? this.engine.compute(this.situationOf(state), await this.catalogFor(state)) : [];
      if (this.hintStates.get(sessionId) !== state) return;
      const before = joinIds(state.hints);
      const after = joinIds(next);
      if (before === after) return;
      state.hints = next;
      state.token += 1;
    } catch (err) {
      console.warn("[dsh-hooks] hints: recompute failed:", err);
    }
  }
  /** Snapshot one session's state as the engine's input. */
  situationOf(state) {
    return {
      cwd: state.cwd,
      projectTypes: state.projectTypes,
      skillsUsed: state.skillsUsed,
      editedPaths: state.editedPaths,
      lastTurn: state.lastTurn,
      lastPrompt: state.lastPrompt,
      prompts: state.prompts,
      status: state.status,
      dismissed: state.dismissed
    };
  }
  /** Note a skill as used, so it is never suggested again this session. */
  noteSkillUsed(state, name) {
    if (typeof name !== "string" || name === "") return;
    state.skillsUsed.add(name);
  }
  /** Invalidate every cached catalog when the skill registry says it may have changed. */
  wireHintEvents() {
    this.ctx.on("skills/change", () => {
      for (const [sessionId, state] of this.hintStates) {
        state.catalog = void 0;
        this.scheduleHints(sessionId);
      }
    });
  }
  async describe(request) {
    const cwd = this.workspaceDirFor(request?.workspaceId);
    const rows = [];
    let projectOrigin;
    for (const event of HOOK_EVENTS) {
      for (const hook of this.hooksFor(event, cwd)) {
        if (hook.source === "project") projectOrigin = hook.origin;
        rows.push({
          event,
          ...hook.matcher !== void 0 ? { matcher: hook.matcher } : {},
          command: hook.command.command,
          timeout: hook.command.timeout ?? 60,
          failClosed: hook.command.failClosed === true,
          source: hook.source
        });
      }
    }
    return {
      enabled: this.settings.enabled,
      shell: this.shell(),
      ...this.userOrigin !== void 0 ? { userOrigin: this.userOrigin } : {},
      ...projectOrigin !== void 0 ? { projectOrigin } : {},
      hooks: rows
    };
  }
  async recent(request) {
    const limit = Math.min(Math.max(1, request?.limit ?? 50), RECENT_LIMIT);
    return { runs: this.runs.slice(-limit).reverse() };
  }
  async hints(request) {
    const state = this.hintStates.get(String(request?.sessionId ?? ""));
    if (state === void 0 || !this.settings.hints.enabled) return { hints: [], token: 0 };
    return { hints: state.hints, token: state.token };
  }
  async hintsToken(request) {
    if (!this.settings.hints.enabled) return { token: 0 };
    return { token: this.hintStates.get(String(request?.sessionId ?? ""))?.token ?? 0 };
  }
  async dismissHint(request) {
    const sessionId = String(request?.sessionId ?? "");
    const id = String(request?.id ?? "");
    const state = this.hintStates.get(sessionId);
    if (state === void 0 || id === "") return { ok: false, token: 0 };
    state.dismissed.add(id);
    const remaining = state.hints.filter((hint) => hint.id !== id);
    if (remaining.length !== state.hints.length) {
      state.hints = remaining;
      state.token += 1;
    }
    this.scheduleHints(sessionId);
    return { ok: true, token: state.token };
  }
  /** Resolve a workspace id to its directory, for the endpoints. */
  workspaceDirFor(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId === "") return void 0;
    const registry = this.ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    const hit = registry.list().find((w) => String(w.id) === workspaceId);
    return hit?.path;
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "describe", _describe_dec, _HooksService);
__decorateElement(_init, 1, "recent", _recent_dec, _HooksService);
__decorateElement(_init, 1, "hints", _hints_dec, _HooksService);
__decorateElement(_init, 1, "hintsToken", _hintsToken_dec, _HooksService);
__decorateElement(_init, 1, "dismissHint", _dismissHint_dec, _HooksService);
__decoratorMetadata(_init, _HooksService);
__name(_HooksService, "HooksService");
__publicField(_HooksService, "inject", ["tools", "subprocess"]);
var HooksService = _HooksService;
var index_default = HooksService;
export {
  DEFAULT_MAX_HINTS,
  HOOK_EVENTS,
  HintEngine,
  HooksService,
  HooksSettings,
  MAX_MAX_HINTS,
  MAX_REASON,
  ProjectHooks,
  RULE_IDS,
  coerceDocument,
  index_default as default,
  defaultShell,
  emptyTurn,
  fingerprint,
  hookEnv,
  invokedSkillNames,
  isWildcard,
  matchesPrompt,
  matchesTool,
  observeToolCall,
  parseHookOutput,
  phrasesOf,
  resetFingerprintCache,
  resetMatcherCache,
  resolveHooks,
  runHook,
  runHooks
};
