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

// src/store.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

// src/types.ts
var DOT_DSH = ".dsh";
var PLANS_DIR = "plans";
var EXIT_PLAN_MODE = "exit_plan_mode";
var MAX_PLAN_BYTES = 512 * 1024;
var MAX_PLANS = 200;
function firstHeading(plan) {
  for (const line of plan.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1];
  }
  return void 0;
}
__name(firstHeading, "firstHeading");
function slugify(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug === "" ? "plan" : slug;
}
__name(slugify, "slugify");
function stamp(at) {
  return new Date(at).toISOString().replace(/[-:.]/g, "").replace(/Z$/, "");
}
__name(stamp, "stamp");

// src/store.ts
var FENCE = "---";
var KEYS = ["id", "title", "sessionId", "createdAt", "status", "decidedAt", "feedback"];
function serialize(record) {
  const lines = [FENCE];
  for (const key of KEYS) {
    const value = record[key];
    if (value === void 0) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push(FENCE, "", record.body);
  return lines.join("\n");
}
__name(serialize, "serialize");
function parse(id, text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const meta = {};
  let body = normalized;
  if (normalized.startsWith(`${FENCE}
`)) {
    const end = normalized.indexOf(`
${FENCE}`, FENCE.length);
    if (end !== -1) {
      for (const line of normalized.slice(FENCE.length + 1, end).split("\n")) {
        const at = line.indexOf(":");
        if (at <= 0) continue;
        const key = line.slice(0, at).trim();
        try {
          meta[key] = JSON.parse(line.slice(at + 1).trim());
        } catch {
        }
      }
      body = normalized.slice(end + FENCE.length + 1).replace(/^\n+/, "");
    }
  }
  const status = meta.status;
  return {
    id: typeof meta.id === "string" ? meta.id : id,
    title: typeof meta.title === "string" ? meta.title : firstHeading(body) ?? "Untitled plan",
    sessionId: typeof meta.sessionId === "string" ? meta.sessionId : "",
    createdAt: typeof meta.createdAt === "number" ? meta.createdAt : 0,
    status: status === "approved" || status === "rejected" ? status : "pending",
    ...typeof meta.decidedAt === "number" ? { decidedAt: meta.decidedAt } : {},
    ...typeof meta.feedback === "string" ? { feedback: meta.feedback } : {},
    bytes: Buffer.byteLength(body, "utf8"),
    body
  };
}
__name(parse, "parse");
var _PlanStore = class _PlanStore {
  constructor() {
    /** Change token per canonical workspace directory. */
    __publicField(this, "tokens", /* @__PURE__ */ new Map());
    /** Serialized write chain per workspace directory. */
    __publicField(this, "tails", /* @__PURE__ */ new Map());
  }
  /**
   * The plans directory for one workspace, created on demand.
   * @param workspaceDir - absolute workspace directory.
   * @returns the absolute plans directory.
   */
  dirFor(workspaceDir) {
    return join(resolve(workspaceDir), DOT_DSH, PLANS_DIR);
  }
  /**
   * The current change token for a workspace.
   * @param workspaceDir - absolute workspace directory.
   * @returns a counter that only increases.
   */
  token(workspaceDir) {
    return this.tokens.get(resolve(workspaceDir)) ?? 0;
  }
  /** Bump one workspace's token. */
  bump(workspaceDir) {
    const key = resolve(workspaceDir);
    this.tokens.set(key, (this.tokens.get(key) ?? 0) + 1);
  }
  /**
   * Every plan's metadata, newest first.
   *
   * Reads every file, because the metadata lives in the file — but the bodies
   * are dropped before returning, so a workspace with 200 plans does not send
   * a megabyte of markdown to render a list.
   * @param workspaceDir - absolute workspace directory.
   * @returns plan metadata, newest first.
   */
  list(workspaceDir) {
    const dir = this.dirFor(workspaceDir);
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const record = this.readFile(dir, name.slice(0, -3));
      if (record === void 0) continue;
      const { body: _body, ...meta } = record;
      out.push(meta);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  /**
   * One plan, with its markdown.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @returns the record, or undefined when it is not there.
   */
  get(workspaceDir, id) {
    if (!isSafeId(id)) return void 0;
    return this.readFile(this.dirFor(workspaceDir), id);
  }
  /** Read and parse one file, tolerating a concurrent delete. */
  readFile(dir, id) {
    const path = join(dir, `${id}.md`);
    try {
      if (!statSync(path).isFile()) return void 0;
      return parse(id, readFileSync(path, "utf8"));
    } catch {
      return void 0;
    }
  }
  /**
   * Write a newly presented plan as `pending`.
   * @param workspaceDir - absolute workspace directory.
   * @param plan - the markdown body.
   * @param sessionId - the presenting session.
   * @param at - epoch millis, injected so tests are deterministic.
   * @returns the stored record, or undefined when the body was refused.
   */
  create(workspaceDir, plan, sessionId, at = Date.now()) {
    if (typeof plan !== "string" || plan.trim() === "") return void 0;
    if (Buffer.byteLength(plan, "utf8") > MAX_PLAN_BYTES) return void 0;
    const title = firstHeading(plan) ?? "Untitled plan";
    const id = `${stamp(at)}-${slugify(title)}`;
    const record = {
      id,
      title,
      sessionId,
      createdAt: at,
      status: "pending",
      bytes: Buffer.byteLength(plan, "utf8"),
      body: plan
    };
    const dir = this.dirFor(workspaceDir);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, `${id}.md`), serialize(record));
    this.bump(workspaceDir);
    this.prune(workspaceDir);
    return record;
  }
  /**
   * Record how a pending plan's review settled.
   *
   * A plan whose file vanished between presentation and decision is not
   * recreated: the user deleted it, and resurrecting it on approval would be a
   * surprise.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @param status - the settled status.
   * @param feedback - the reviewer's words, when they kept planning.
   * @param at - epoch millis, injected so tests are deterministic.
   * @returns the updated record, or undefined when it is gone.
   */
  settle(workspaceDir, id, status, feedback, at = Date.now()) {
    const existing = this.get(workspaceDir, id);
    if (existing === void 0) return void 0;
    const next = {
      ...existing,
      status,
      decidedAt: at,
      ...feedback !== void 0 && feedback !== "" ? { feedback } : {}
    };
    writeAtomic(join(this.dirFor(workspaceDir), `${id}.md`), serialize(next));
    this.bump(workspaceDir);
    return next;
  }
  /**
   * Delete one plan file.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @returns whether a file was removed.
   */
  remove(workspaceDir, id) {
    if (!isSafeId(id)) return false;
    const path = join(this.dirFor(workspaceDir), `${id}.md`);
    if (!existsSync(path)) return false;
    rmSync(path);
    this.bump(workspaceDir);
    return true;
  }
  /**
   * Keep the newest {@link MAX_PLANS} plans, plus every pending one.
   *
   * The retention window is measured over ALL plans, not over the settled ones
   * alone. Counting only settled plans makes the cap drift: pruning runs inside
   * `create`, when the plan being written is still pending and therefore
   * invisible to a settled-only count, so each round of create-then-settle
   * leaves one extra plan behind forever.
   *
   * A pending plan that falls outside the window is skipped rather than
   * deleted, whatever its age. A pending plan is one nobody has answered yet,
   * and deleting it is deleting live work — so the total can exceed the cap,
   * bounded by however many reviews are genuinely outstanding.
   * @param workspaceDir - absolute workspace directory.
   */
  prune(workspaceDir) {
    const all = this.list(workspaceDir);
    if (all.length <= MAX_PLANS) return;
    for (const plan of all.slice(MAX_PLANS)) {
      if (plan.status === "pending") continue;
      try {
        rmSync(join(this.dirFor(workspaceDir), `${plan.id}.md`));
      } catch {
      }
    }
  }
  /**
   * Queue one whole read/modify/write behind this workspace's prior write.
   * @param workspaceDir - absolute workspace directory.
   * @param run - the work to serialize.
   * @returns whatever `run` returns.
   */
  async enqueue(workspaceDir, run) {
    const key = resolve(workspaceDir);
    const prior = this.tails.get(key) ?? Promise.resolve();
    const next = prior.then(run, run);
    const tail = next.then(
      () => void 0,
      () => void 0
    );
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
};
__name(_PlanStore, "PlanStore");
var PlanStore = _PlanStore;
function isSafeId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}
__name(isSafeId, "isSafeId");
function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
__name(writeAtomic, "writeAtomic");

// src/index.ts
var _remove_dec, _changeToken_dec, _get_dec, _list_dec, _a, _init, _b;
var _PlanService = class _PlanService extends (_b = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the tool registry and workspace registry.
   */
  constructor(ctx) {
    super(ctx, "dshPlans");
    __runInitializers(_init, 5, this);
    __publicField(this, "store", new PlanStore());
    /** Resolved workspace directory per workspace id. */
    __publicField(this, "dirs", /* @__PURE__ */ new Map());
  }
  /** Wrap `exit_plan_mode`'s dispatch so the plan and its outcome are kept. */
  async [(_a = Service.init, _list_dec = [Remote], _get_dec = [Remote], _changeToken_dec = [Remote], _remove_dec = [Remote], _a)]() {
    this.ctx.on(
      "tools/execute",
      async (exec, next) => {
        if (exec.name !== EXIT_PLAN_MODE) return next();
        const plan = exec.arguments?.plan;
        const dir = exec.agent?.session.header.cwd;
        if (typeof plan !== "string" || dir === void 0) return next();
        let record;
        try {
          record = await this.store.enqueue(
            dir,
            () => this.store.create(dir, plan, String(exec.agent?.id ?? ""))
          );
        } catch (err) {
          console.warn("[dsh-plan-board] could not store the presented plan:", err);
        }
        try {
          const result = await next();
          if (record !== void 0) {
            await this.settle(
              dir,
              record.id,
              result.isError ? "rejected" : "approved",
              result.isError ? messageOf(result) : void 0
            );
          }
          return result;
        } catch (err) {
          if (record !== void 0) {
            await this.settle(dir, record.id, "rejected", err instanceof Error ? err.message : String(err));
          }
          throw err;
        }
      }
    );
  }
  /** Settle a stored plan without letting a storage failure reach the caller. */
  async settle(dir, id, status, feedback) {
    try {
      await this.store.enqueue(dir, () => this.store.settle(dir, id, status, feedback));
    } catch (err) {
      console.warn("[dsh-plan-board] could not record the plan decision:", err);
    }
  }
  /**
   * Resolve a workspace id to its canonical directory.
   * @param workspaceId - id from the wire.
   * @returns the absolute workspace directory.
   */
  dirOf(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("dsh-plan-board: workspaceId must be a non-empty string");
    }
    const cached = this.dirs.get(workspaceId);
    if (cached !== void 0) return cached;
    const hit = this.ctx.workspaceRegistry.list().find((w) => String(w.id) === workspaceId);
    if (hit === void 0) throw new Error(`dsh-plan-board: unknown workspace ${workspaceId}`);
    this.dirs.set(workspaceId, hit.path);
    return hit.path;
  }
  async list(request) {
    const dir = this.dirOf(request?.workspaceId);
    return { plans: this.store.list(dir), token: this.store.token(dir) };
  }
  async get(request) {
    const dir = this.dirOf(request?.workspaceId);
    if (!isSafeId(request?.id)) return {};
    const plan = this.store.get(dir, request.id);
    return plan === void 0 ? {} : { plan };
  }
  async changeToken(request) {
    const dir = this.dirOf(request?.workspaceId);
    const pending = this.store.list(dir).find((plan) => plan.status === "pending");
    return {
      token: this.store.token(dir),
      ...pending !== void 0 ? { pendingId: pending.id } : {}
    };
  }
  async remove(request) {
    const dir = this.dirOf(request?.workspaceId);
    const ok = await this.store.enqueue(dir, () => this.store.remove(dir, request?.id));
    return { ok, token: this.store.token(dir) };
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "list", _list_dec, _PlanService);
__decorateElement(_init, 1, "get", _get_dec, _PlanService);
__decorateElement(_init, 1, "changeToken", _changeToken_dec, _PlanService);
__decorateElement(_init, 1, "remove", _remove_dec, _PlanService);
__decoratorMetadata(_init, _PlanService);
__name(_PlanService, "PlanService");
__publicField(_PlanService, "inject", ["tools", "workspaceRegistry"]);
var PlanService = _PlanService;
function messageOf(result) {
  if (!result.isError) return "";
  const error = result.error;
  if (typeof error?.message === "string") return error.message;
  for (const block of result.content) {
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}
__name(messageOf, "messageOf");
var index_default = PlanService;
export {
  MAX_PLANS,
  MAX_PLAN_BYTES,
  PlanService,
  PlanStore,
  index_default as default,
  firstHeading,
  isSafeId,
  parse,
  serialize,
  slugify,
  stamp
};
