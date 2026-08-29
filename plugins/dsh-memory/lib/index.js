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

// src/index.ts
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

// src/files.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  discoverBaselineInstructionFiles,
  loadBaselineInstructions
} from "@deepseek-ai/dsh-agent-instructions";

// src/types.ts
var MEMORY_SCOPES = ["project", "local", "user"];
var MEMORY_HEADING = "## Memories";
var MAX_FACT_CHARS = 2e3;
var USER_GLOBAL_FILE = "AGENTS.md";
function formatFact(fact) {
  return `- ${fact.trim().replace(/\s*\n\s*/g, " ")}`;
}
__name(formatFact, "formatFact");
function validateFact(fact) {
  if (typeof fact !== "string") return { ok: false, reason: "a memory must be text" };
  const trimmed = fact.trim();
  if (trimmed === "") return { ok: false, reason: "nothing to remember" };
  if (trimmed.length > MAX_FACT_CHARS) {
    return { ok: false, reason: `a memory must be under ${MAX_FACT_CHARS} characters (got ${trimmed.length})` };
  }
  return { ok: true, fact: trimmed };
}
__name(validateFact, "validateFact");
function parseScope(raw) {
  const match = /^\s*--(user|local|project)\b\s*/.exec(raw);
  if (match === null) return { scope: "project", rest: raw.trim() };
  return { scope: match[1], rest: raw.slice(match[0].length).trim() };
}
__name(parseScope, "parseScope");

// src/files.ts
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== void 0 && fromEnv !== "" ? resolve(fromEnv) : join(homedir(), ".dsh");
}
__name(dshHome, "dshHome");
function findProjectRoot(cwd) {
  let dir = resolve(cwd);
  for (; ; ) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}
__name(findProjectRoot, "findProjectRoot");
function targetFor(scope, cwd) {
  if (scope === "user") return join(dshHome(), USER_GLOBAL_FILE);
  const root = findProjectRoot(cwd);
  return join(root, scope === "local" ? "AGENTS.local.md" : "AGENTS.md");
}
__name(targetFor, "targetFor");
function appendFact(path, fact) {
  const line = formatFact(fact);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, `${MEMORY_HEADING}

${line}
`, "utf8");
    return line;
  }
  const original = readFileSync(path, "utf8");
  const normalized = original.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const headingAt = lines.findIndex((entry) => entry.trim() === MEMORY_HEADING);
  if (headingAt === -1) {
    const gap = normalized.endsWith("\n\n") ? "" : normalized.endsWith("\n") ? "\n" : "\n\n";
    appendFileSync(path, `${gap}${MEMORY_HEADING}

${line}
`, "utf8");
    return line;
  }
  let end = lines.length;
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let at = end;
  while (at > headingAt + 1 && lines[at - 1].trim() === "") at -= 1;
  lines.splice(at, 0, line);
  writeFileSync(path, lines.join("\n"), "utf8");
  return line;
}
__name(appendFact, "appendFact");
async function inspect(cwd, maxBytes) {
  const home = dshHome();
  const discovered = await discoverBaselineInstructionFiles({ cwd, dshHome: home });
  const rendered = await loadBaselineInstructions({ cwd, dshHome: home, maxBytes });
  const omitted = new Set((rendered?.omitted ?? []).map((file) => file.absolutePath));
  const truncated = new Map((rendered?.truncated ?? []).map((entry) => [entry.displayPath, entry.includedBytes]));
  const files = discovered.map((file) => {
    let bytes = 0;
    try {
      bytes = statSync(file.absolutePath).size;
    } catch {
    }
    const cut = truncated.get(file.displayPath);
    return {
      displayPath: file.displayPath,
      absolutePath: file.absolutePath,
      bytes,
      included: !omitted.has(file.absolutePath),
      ...cut !== void 0 ? { truncatedTo: cut } : {}
    };
  });
  return {
    cwd: resolve(cwd),
    dshHome: home,
    maxBytes,
    discoveredBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
}
__name(inspect, "inspect");
async function readInstruction(cwd, absolutePath) {
  if (typeof absolutePath !== "string" || absolutePath === "") return void 0;
  const discovered = await discoverBaselineInstructionFiles({ cwd, dshHome: dshHome() });
  const wanted = resolve(absolutePath);
  if (!discovered.some((file) => resolve(file.absolutePath) === wanted)) return void 0;
  try {
    return readFileSync(wanted, "utf8");
  } catch {
    return void 0;
  }
}
__name(readInstruction, "readInstruction");

// src/index.ts
var DEFAULT_MAX_BYTES = 65536;
var _read_dec, _remember_dec, _inspect_dec, _a, _init, _b;
var _MemoryService = class _MemoryService extends (_b = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the workspace registry.
   * @param config - plugin config; `maxBytes` must match the loader's.
   */
  constructor(ctx, config = {}) {
    super(ctx, "dshMemory");
    __runInitializers(_init, 5, this);
    /** Byte budget the inspector reports against. */
    __publicField(this, "maxBytes");
    /** Resolved workspace directory per workspace id. */
    __publicField(this, "dirs", /* @__PURE__ */ new Map());
    const configured = config.maxBytes;
    this.maxBytes = typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
  }
  /** Register `/remember` if a command registry is composed. */
  async [(_a = Service.init, _inspect_dec = [Remote], _remember_dec = [Remote], _read_dec = [Remote], _a)]() {
    this.ctx.inject(["commands"], (scoped) => {
      scoped.effect(
        () => scoped.commands.register({
          name: "remember",
          description: "Append a fact to AGENTS.md so future sessions read it",
          input: { hint: "[--project|--local|--user] the thing to remember" },
          handler: /* @__PURE__ */ __name((invocation) => this.handleRemember(invocation), "handler")
        }),
        "dsh-memory: /remember registration"
      );
    });
  }
  /**
   * Run one `/remember` invocation.
   *
   * The reply names the exact file written, always. A capture command whose
   * output is "saved" leaves the user guessing which of four candidate files in
   * the hierarchy it landed in.
   * @param invocation - the command invocation.
   * @returns the rendered result.
   */
  handleRemember(invocation) {
    const { scope, rest } = parseScope(invocation.rawInput);
    const checked = validateFact(rest);
    if (!checked.ok) {
      return { kind: "error", text: `/remember: ${checked.reason}` };
    }
    const cwd = invocation.agent.session.header.cwd;
    if (cwd === void 0) {
      return { kind: "error", text: "/remember: this session has no working directory to write into" };
    }
    try {
      const path = targetFor(scope, cwd);
      const line = appendFact(path, checked.fact);
      return { kind: "success", text: `Remembered in ${path}
${line}` };
    } catch (err) {
      return {
        kind: "error",
        text: `/remember: could not write the memory \u2014 ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  /**
   * Resolve a workspace id to its canonical directory.
   * @param workspaceId - id from the wire.
   * @returns the absolute workspace directory.
   */
  dirOf(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("dsh-memory: workspaceId must be a non-empty string");
    }
    const cached = this.dirs.get(workspaceId);
    if (cached !== void 0) return cached;
    const hit = this.ctx.workspaceRegistry.list().find((w) => String(w.id) === workspaceId);
    if (hit === void 0) throw new Error(`dsh-memory: unknown workspace ${workspaceId}`);
    this.dirs.set(workspaceId, hit.path);
    return hit.path;
  }
  async inspect(request) {
    const dir = this.dirOf(request?.workspaceId);
    return { report: await inspect(dir, this.maxBytes) };
  }
  async remember(request) {
    const dir = this.dirOf(request?.workspaceId);
    const checked = validateFact(request?.fact);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const scope = request?.scope;
    if (!MEMORY_SCOPES.includes(scope)) {
      return { ok: false, reason: `scope must be one of ${MEMORY_SCOPES.join(", ")}` };
    }
    try {
      const path = targetFor(scope, dir);
      const line = appendFact(path, checked.fact);
      return { ok: true, path, line };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
  async read(request) {
    const dir = this.dirOf(request?.workspaceId);
    const text = await readInstruction(dir, request?.absolutePath);
    return text === void 0 ? {} : { text };
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "inspect", _inspect_dec, _MemoryService);
__decorateElement(_init, 1, "remember", _remember_dec, _MemoryService);
__decorateElement(_init, 1, "read", _read_dec, _MemoryService);
__decoratorMetadata(_init, _MemoryService);
__name(_MemoryService, "MemoryService");
__publicField(_MemoryService, "inject", ["workspaceRegistry"]);
var MemoryService = _MemoryService;
var index_default = MemoryService;
export {
  DEFAULT_MAX_BYTES,
  MAX_FACT_CHARS,
  MEMORY_HEADING,
  MEMORY_SCOPES,
  MemoryService,
  appendFact,
  index_default as default,
  dshHome,
  findProjectRoot,
  formatFact,
  dshHome as harnessHome,
  inspect,
  parseScope,
  readInstruction,
  targetFor,
  validateFact
};
