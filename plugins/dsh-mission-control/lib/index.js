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
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
var MAX_STATE_BYTES = 64 * 1024;
function terminalLaunchFor(platform, dir, hasWindowsTerminal) {
  if (platform === "darwin") return { command: "open", args: ["-a", "Terminal", dir] };
  if (platform === "win32") {
    return hasWindowsTerminal ? { command: "wt.exe", args: ["-d", dir] } : { command: "cmd.exe", args: ["/c", "start", '""', "/D", dir, "cmd.exe"], cwd: dir };
  }
  return { command: "x-terminal-emulator", args: [], cwd: dir };
}
__name(terminalLaunchFor, "terminalLaunchFor");
function onPath(bin) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) {
      if (existsSync(join(entry, bin + ext))) return true;
    }
  }
  return false;
}
__name(onPath, "onPath");
var _openTerminal_dec, _save_dec, _load_dec, _a, _init;
var _MissionControlService = class _MissionControlService extends (_a = TypertRemoteService, _load_dec = [Remote], _save_dec = [Remote], _openTerminal_dec = [Remote], _a) {
  constructor(ctx) {
    super(ctx, "dshMissionControl");
    __runInitializers(_init, 5, this);
  }
  /** Absolute path of the state cell, or null when DSH_HOME is unset. */
  file() {
    const home = process.env.DSH_HOME;
    return home ? join(home, "storages", "dsh-mission-control.json") : null;
  }
  async load(request) {
    const file = this.file();
    if (!file || !existsSync(file)) return { state: null };
    try {
      return { state: readFileSync(file, "utf8") };
    } catch {
      return { state: null };
    }
  }
  async save(request) {
    const state = request?.state;
    if (typeof state !== "string") {
      throw new Error("dsh-mission-control: state must be a string");
    }
    if (state.length > MAX_STATE_BYTES) {
      throw new Error("dsh-mission-control: state exceeds the 64KB cap");
    }
    const file = this.file();
    if (!file) throw new Error("dsh-mission-control: DSH_HOME is not set");
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, state, "utf8");
    renameSync(tmp, file);
    return { ok: true };
  }
  async openTerminal(request) {
    const dir = request?.path;
    if (typeof dir !== "string" || dir.length === 0) {
      throw new Error("dsh-mission-control: path must be a non-empty string");
    }
    try {
      if (!statSync(dir).isDirectory()) {
        throw new Error(`dsh-mission-control: not a directory: ${dir}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("dsh-mission-control:")) throw error;
      throw new Error(`dsh-mission-control: directory does not exist: ${dir}`);
    }
    const launch = terminalLaunchFor(
      process.platform,
      dir,
      process.platform === "win32" ? onPath("wt") : false
    );
    await new Promise((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        detached: true,
        stdio: "ignore"
      });
      child.once("error", (error) => {
        reject(new Error(`dsh-mission-control: could not open a terminal: ${error.message}`));
      });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return { ok: true };
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "load", _load_dec, _MissionControlService);
__decorateElement(_init, 1, "save", _save_dec, _MissionControlService);
__decorateElement(_init, 1, "openTerminal", _openTerminal_dec, _MissionControlService);
__decoratorMetadata(_init, _MissionControlService);
__name(_MissionControlService, "MissionControlService");
var MissionControlService = _MissionControlService;
var index_default = MissionControlService;
export {
  MAX_STATE_BYTES,
  MissionControlService,
  index_default as default,
  terminalLaunchFor
};
