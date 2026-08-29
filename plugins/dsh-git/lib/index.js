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
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";

// src/types.ts
var MAX_DIFF_BYTES = 4e5;
var MAX_AI_DIFF_BYTES = 6e4;
var RECENT_COMMITS = 15;

// src/git.ts
import { execFile } from "node:child_process";
var MAX_BUFFER = 32 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 3e4;
var REPO_LOCATION_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_GRAFT_FILE",
  "GIT_PREFIX",
  "GIT_INDEX_VERSION"
];
function gitEnv() {
  const env = { ...process.env };
  for (const name of REPO_LOCATION_ENV) delete env[name];
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_EDITOR = "true";
  env.GIT_PAGER = "cat";
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}
__name(gitEnv, "gitEnv");
function runGit(cwd, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: gitEnv()
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const err = typeof stderr === "string" ? stderr : String(stderr ?? "");
        if (error && typeof error.code === "number") {
          resolve({ code: error.code, stdout: out, stderr: err });
          return;
        }
        if (error) {
          reject(error);
          return;
        }
        resolve({ code: 0, stdout: out, stderr: err });
      }
    );
  });
}
__name(runGit, "runGit");
function combined(run) {
  return [run.stdout.trim(), run.stderr.trim()].filter((s) => s.length > 0).join("\n").trim();
}
__name(combined, "combined");
async function repoRoot(dir) {
  try {
    const run = await runGit(dir, ["rev-parse", "--show-toplevel"]);
    if (run.code !== 0) return void 0;
    const root = run.stdout.trim();
    return root.length > 0 ? root : void 0;
  } catch {
    return void 0;
  }
}
__name(repoRoot, "repoRoot");
function code(ch) {
  switch (ch) {
    case "M":
    case "A":
    case "D":
    case "R":
    case "C":
    case "U":
    case "?":
    case "!":
      return ch;
    default:
      return " ";
  }
}
__name(code, "code");
function parseStatus(raw) {
  const out = [];
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (!entry || entry.length < 3) continue;
    const index = code(entry[0]);
    const worktree = code(entry[1]);
    const path = entry.slice(3);
    if (path.length === 0) continue;
    let origPath;
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      const next = fields[i + 1];
      if (typeof next === "string" && next.length > 0) {
        origPath = next;
        i += 1;
      }
    }
    const untracked = index === "?" && worktree === "?";
    const conflicted = index === "U" || worktree === "U" || index === "A" && worktree === "A" || index === "D" && worktree === "D";
    out.push({
      path,
      ...origPath !== void 0 ? { origPath } : {},
      index,
      worktree,
      // Untracked files have no index entry, and a conflict is not "staged
      // work" even though git writes stage markers for it.
      staged: !untracked && !conflicted && index !== " ",
      conflicted,
      untracked
    });
  }
  return out;
}
__name(parseStatus, "parseStatus");
function parseBranchHeader(line) {
  const unborn = /^No commits yet on (.+?)(?:\.\.\.|$)/.exec(line);
  if (unborn) return { branch: unborn[1].trim() };
  const track = /\[(.+)\]\s*$/.exec(line);
  const head = track ? line.slice(0, track.index) : line;
  const parts = head.split("...");
  const branch = parts[0]?.trim();
  const upstreamName = parts[1]?.trim();
  let upstream;
  if (upstreamName) {
    const ahead = /ahead (\d+)/.exec(track?.[1] ?? "");
    const behind = /behind (\d+)/.exec(track?.[1] ?? "");
    upstream = {
      name: upstreamName,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0
    };
  }
  return {
    ...branch && branch !== "HEAD (no branch)" ? { branch } : {},
    ...upstream ? { upstream } : {}
  };
}
__name(parseBranchHeader, "parseBranchHeader");
var LOG_SEP = "";
async function recentCommits(root) {
  const run = await runGit(root, [
    "log",
    `-${RECENT_COMMITS}`,
    `--pretty=format:%h${LOG_SEP}%s${LOG_SEP}%an${LOG_SEP}%at`
  ]);
  if (run.code !== 0) return [];
  const out = [];
  for (const line of run.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [sha, subject, author, at] = line.split(LOG_SEP);
    if (!sha) continue;
    out.push({
      sha,
      subject: subject ?? "",
      author: author ?? "",
      date: Number(at ?? 0) * 1e3
    });
  }
  return out;
}
__name(recentCommits, "recentCommits");
function assertSafeSha(sha) {
  if (typeof sha !== "string" || !/^[0-9a-fA-F]{4,40}$/.test(sha)) {
    throw new Error(`dsh-git: invalid commit sha ${String(sha)}`);
  }
  return sha;
}
__name(assertSafeSha, "assertSafeSha");
function parseCommitFiles(raw) {
  const out = [];
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const token = fields[i];
    if (!token) continue;
    const letter = token[0];
    if (!/^[A-Z]/.test(token)) continue;
    const status = code(letter);
    if (status === "R" || status === "C") {
      const from = fields[i + 1];
      const to = fields[i + 2];
      if (typeof from !== "string" || typeof to !== "string" || to.length === 0) break;
      out.push({ path: to, origPath: from, status });
      i += 2;
      continue;
    }
    const path = fields[i + 1];
    if (typeof path !== "string" || path.length === 0) break;
    out.push({ path, status });
    i += 1;
  }
  return out;
}
__name(parseCommitFiles, "parseCommitFiles");
async function readPorcelain(root) {
  const run = await runGit(root, [
    "status",
    "--porcelain=v1",
    "-b",
    "-z",
    "--untracked-files=all"
  ]);
  const raw = run.stdout;
  const firstNul = raw.indexOf("\0");
  const header = firstNul >= 0 ? raw.slice(0, firstNul) : raw;
  const rest = firstNul >= 0 ? raw.slice(firstNul + 1) : "";
  return {
    ...header.startsWith("## ") ? parseBranchHeader(header.slice(3)) : {},
    unborn: header.includes("No commits yet"),
    files: parseStatus(rest)
  };
}
__name(readPorcelain, "readPorcelain");
async function readStatus(dir) {
  const root = await repoRoot(dir);
  if (root === void 0) return { repo: false, root: dir };
  const [porcelain, remotesRun, headRun] = await Promise.all([
    readPorcelain(root),
    runGit(root, ["remote"]),
    runGit(root, ["rev-parse", "--short", "HEAD"])
  ]);
  const unborn = porcelain.unborn || headRun.code !== 0;
  const recent = unborn ? [] : await recentCommits(root);
  return {
    repo: true,
    root,
    ...porcelain.branch !== void 0 ? { branch: porcelain.branch } : {},
    ...!unborn && headRun.code === 0 ? { head: headRun.stdout.trim() } : {},
    unborn,
    ...porcelain.upstream !== void 0 ? { upstream: porcelain.upstream } : {},
    hasRemote: remotesRun.code === 0 && remotesRun.stdout.trim().length > 0,
    files: porcelain.files,
    recent
  };
}
__name(readStatus, "readStatus");
async function untrackedPatch(root, path) {
  const run = await runGit(root, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]);
  return run.stdout;
}
__name(untrackedPatch, "untrackedPatch");
async function collectChangeDiff(root, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_AI_DIFF_BYTES;
  const { files, unborn } = await readPorcelain(root);
  const staged = options.staged ?? files.some((f) => f.staged);
  const scope = staged ? "staged" : "all";
  const args = ["diff", "--no-color", "--no-ext-diff"];
  if (staged) {
    args.push("--cached");
  } else if (!unborn) {
    args.push("HEAD");
  }
  const run = await runGit(root, args);
  const parts = [];
  let used = 0;
  if (run.stdout.trim().length > 0) {
    parts.push(run.stdout);
    used += run.stdout.length;
  }
  const omitted = [];
  if (!staged) {
    for (const file of files) {
      if (!file.untracked) continue;
      if (used >= maxBytes) {
        omitted.push(file.path);
        continue;
      }
      const patch = await untrackedPatch(root, file.path);
      if (patch.trim().length === 0) {
        omitted.push(file.path);
        continue;
      }
      parts.push(patch);
      used += patch.length;
    }
  }
  if (omitted.length > 0) {
    parts.push(`New files, contents not shown:
${omitted.map((p) => `- ${p}`).join("\n")}`);
  }
  let text = parts.join("\n").trim();
  if (text.length === 0) {
    const named = staged ? files.filter((f) => f.staged) : files;
    if (named.length === 0) return { scope, text: "", truncated: false };
    text = `Files affected (no textual diff available):
${named.map((f) => `${f.untracked ? "new file" : "changed"}: ${f.path}`).join("\n")}`;
  }
  const truncated = text.length > maxBytes;
  return {
    scope,
    text: truncated ? `${text.slice(0, maxBytes)}
[diff truncated]` : text,
    truncated
  };
}
__name(collectChangeDiff, "collectChangeDiff");
function assertSafePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("dsh-git: path must be a non-empty string");
  }
  if (path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`dsh-git: absolute paths are not accepted: ${path}`);
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === "..")) {
    throw new Error(`dsh-git: path may not escape the repository: ${path}`);
  }
  return path;
}
__name(assertSafePath, "assertSafePath");

// src/watch.ts
import { watch } from "node:fs";
import { join } from "node:path";
var DEBOUNCE_MS = 120;
var MAX_DEBOUNCE_MS = 1e3;
var tokenSeed = 0;
var GIT_SIGNIFICANT = /* @__PURE__ */ new Set([
  "index",
  "HEAD",
  "refs",
  "packed-refs",
  "MERGE_HEAD",
  "REBASE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "MERGE_MSG"
]);
function isSignificantGitEntry(entry) {
  if (entry.length === 0) return false;
  if (entry.endsWith(".lock")) return false;
  return GIT_SIGNIFICANT.has(entry);
}
__name(isSignificantGitEntry, "isSignificantGitEntry");
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode"
]);
var _RepoWatcher = class _RepoWatcher {
  constructor() {
    __publicField(this, "repos", /* @__PURE__ */ new Map());
  }
  /**
   * Current change token for a root, starting a watcher on first use.
   *
   * Reading the token is what registers interest, so a client that stops asking
   * lets the watch expire on its own; nothing has to remember to unsubscribe.
   * @param root - repository working-tree root.
   * @returns the monotonic token for this root.
   */
  token(root) {
    const existing = this.repos.get(root);
    if (existing !== void 0) return existing.token;
    const created = this.start(root);
    return created.token;
  }
  /**
   * Begin watching one root.
   *
   * Two watches are needed, not one. The worktree watch is `recursive` and sees
   * edits to files; the `.git` watch is what sees staging, commits, and branch
   * switches, because git's own metadata writes do not surface as worktree
   * events. Missing the second is why a watcher can look like it works while
   * never noticing a commit.
   * @param root - repository working-tree root.
   * @returns the newly registered watch record.
   */
  start(root) {
    tokenSeed += 1;
    const record = { watchers: [], token: tokenSeed, timer: void 0, burstStart: 0 };
    this.repos.set(root, record);
    const advance = /* @__PURE__ */ __name(() => {
      record.timer = void 0;
      record.burstStart = 0;
      record.token += 1;
    }, "advance");
    const bump = /* @__PURE__ */ __name(() => {
      const now = Date.now();
      if (record.burstStart === 0) record.burstStart = now;
      if (now - record.burstStart >= MAX_DEBOUNCE_MS) {
        if (record.timer !== void 0) clearTimeout(record.timer);
        advance();
        return;
      }
      if (record.timer !== void 0) clearTimeout(record.timer);
      record.timer = setTimeout(advance, DEBOUNCE_MS);
      record.timer.unref?.();
    }, "bump");
    try {
      const tree = watch(root, { recursive: true }, (_event, name) => {
        if (typeof name !== "string" || name.length === 0) return;
        const head = name.replace(/\\/g, "/").split("/")[0] ?? "";
        if (IGNORED_DIRS.has(head)) return;
        bump();
      });
      tree.on("error", () => {
      });
      record.watchers.push(tree);
    } catch {
    }
    try {
      const meta = watch(join(root, ".git"), (_event, name) => {
        if (typeof name !== "string" || name.length === 0) return;
        const head = name.replace(/\\/g, "/").split("/")[0] ?? "";
        if (!isSignificantGitEntry(head)) return;
        bump();
      });
      meta.on("error", () => {
      });
      record.watchers.push(meta);
    } catch {
    }
    return record;
  }
  /** Release every watcher; called when the service disposes. */
  close() {
    for (const record of this.repos.values()) {
      if (record.timer !== void 0) clearTimeout(record.timer);
      for (const w of record.watchers) {
        try {
          w.close();
        } catch {
        }
      }
    }
    this.repos.clear();
  }
};
__name(_RepoWatcher, "RepoWatcher");
var RepoWatcher = _RepoWatcher;

// src/index.ts
var NETWORK_TIMEOUT_MS = 12e4;
var _suggestMessage_dec, _sync_dec, _init_dec, _commit_dec, _stage_dec, _commitDiff_dec, _commitFiles_dec, _diff_dec, _changeToken_dec, _status_dec, _init, _a;
var _GitService = class _GitService extends (_a = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the workspace registry and LLM runtime.
   */
  constructor(ctx) {
    super(ctx, "dshGit");
    __runInitializers(_init, 5, this);
    /** Per-repository write chain, keyed by working-tree root. */
    __publicField(this, "tails", /* @__PURE__ */ new Map());
    /**
     * Filesystem watchers backing {@link changeToken}.
     *
     * Owned by the service rather than created per request so that N tabs on one
     * repository share a single OS handle.
     */
    __publicField(this, "watcher", new RepoWatcher());
  }
  /**
   * Resolve a workspace id to its canonical directory.
   *
   * The registry is the only accepted source: taking a path from the browser
   * would let any caller point this service at an arbitrary directory on the
   * machine.
   * @param workspaceId - the workspace to resolve.
   * @returns the canonical workspace directory.
   */
  workspaceDir(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("dsh-git: workspaceId must be a non-empty string");
    }
    const registry = this.ctx.workspaceRegistry;
    const workspace = registry.list().find((w) => String(w.id) === workspaceId);
    if (workspace === void 0) throw new Error(`dsh-git: unknown workspace ${workspaceId}`);
    return workspace.path;
  }
  async status(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    return { status: await readStatus(dir) };
  }
  async changeToken(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const root = await repoRoot(dir);
    if (root === void 0) return { token: 0 };
    return { token: this.watcher.token(root) };
  }
  async diff(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const root = await repoRoot(dir);
    if (root === void 0) return { patch: "", binary: false };
    const path = typeof request?.path === "string" && request.path.length > 0 ? assertSafePath(request.path) : void 0;
    const staged = request?.staged === true;
    if (path !== void 0) {
      const tracked = await runGit(root, ["ls-files", "--error-unmatch", "--", path]);
      if (tracked.code !== 0) {
        const text2 = await untrackedPatch(root, path);
        if (text2.includes("Binary files")) {
          return { patch: "Binary file \u2014 no textual diff.", binary: true };
        }
        return { patch: clamp(text2), binary: false };
      }
    }
    const args = ["diff", "--no-color", "--no-ext-diff"];
    if (staged) args.push("--cached");
    args.push("--");
    if (path !== void 0) args.push(path);
    const run = await runGit(root, args);
    const text = run.stdout;
    if (text.includes("Binary files")) {
      return { patch: "Binary file \u2014 no textual diff.", binary: true };
    }
    return { patch: clamp(text), binary: false };
  }
  async commitFiles(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const sha = assertSafeSha(request?.sha);
    const root = await repoRoot(dir);
    if (root === void 0) return { files: [] };
    const run = await runGit(root, [
      "show",
      "--name-status",
      "-z",
      "--no-color",
      // Without this a MERGE commit prints no file list at all, so its row would
      // expand into a convincing but false "no files changed".
      "--first-parent",
      "--format=",
      sha
    ]);
    if (run.code !== 0) return { files: [] };
    return { files: parseCommitFiles(run.stdout) };
  }
  async commitDiff(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const sha = assertSafeSha(request?.sha);
    const root = await repoRoot(dir);
    if (root === void 0) return { patch: "", binary: false };
    const path = typeof request?.path === "string" && request.path.length > 0 ? assertSafePath(request.path) : void 0;
    const args = ["show", "--no-color", "--no-ext-diff", "--first-parent", "--format=", sha];
    if (path !== void 0) args.push("--", path);
    const run = await runGit(root, args);
    if (run.code !== 0) {
      return { patch: combined(run) || "Could not read this commit.", binary: false };
    }
    const text = run.stdout;
    if (text.includes("Binary files")) {
      return { patch: "Binary file \u2014 no textual diff.", binary: true };
    }
    return { patch: clamp(text), binary: false };
  }
  async stage(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const action = request?.action;
    const paths = Array.isArray(request?.paths) ? request.paths.map(assertSafePath) : [];
    return this.withRepo(dir, async (root) => {
      if (action === "stage") {
        const args = paths.length > 0 ? ["add", "--", ...paths] : ["add", "-A"];
        return combined(await runGit(root, args));
      }
      if (action === "unstage") {
        const status = await readStatus(root);
        const unborn = status.repo && status.unborn;
        const args = unborn ? ["rm", "--cached", "-r", "--", ...paths.length > 0 ? paths : ["."]] : ["restore", "--staged", "--", ...paths.length > 0 ? paths : ["."]];
        return combined(await runGit(root, args));
      }
      if (action === "discard") {
        const out = [];
        const targets = paths.length > 0 ? paths : ["."];
        out.push(combined(await runGit(root, ["checkout", "--", ...targets])));
        out.push(combined(await runGit(root, ["clean", "-fd", "--", ...targets])));
        return out.filter((s) => s.length > 0).join("\n");
      }
      throw new Error(`dsh-git: unknown stage action ${String(action)}`);
    });
  }
  async commit(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const message = typeof request?.message === "string" ? request.message.trim() : "";
    if (message.length === 0) throw new Error("dsh-git: a commit message is required");
    const all = request?.all === true;
    return this.withRepo(dir, async (root) => {
      const args = ["commit"];
      if (all) args.push("-a");
      args.push("-m", message);
      return combined(await runGit(root, args));
    });
  }
  async init(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const branch = normalizeBranch(request?.branch);
    const existing = await repoRoot(dir);
    if (existing !== void 0) {
      return {
        ok: false,
        output: `Already a git repository at ${existing}`,
        status: await readStatus(dir)
      };
    }
    return this.enqueue(dir, async () => {
      const run = await runGit(dir, ["init", "-b", branch]);
      const output = combined(run);
      return { ok: run.code === 0, output, status: await readStatus(dir) };
    });
  }
  async sync(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const action = request?.action;
    return this.withRepo(dir, async (root) => {
      const status = await readStatus(root);
      const branch = status.repo ? status.branch : void 0;
      switch (action) {
        case "fetch":
          return combined(await runGit(root, ["fetch", "--all", "--prune"], NETWORK_TIMEOUT_MS));
        case "pull":
          return combined(await runGit(root, ["pull", "--ff-only"], NETWORK_TIMEOUT_MS));
        case "push":
          return combined(await runGit(root, ["push"], NETWORK_TIMEOUT_MS));
        case "publish": {
          if (branch === void 0) throw new Error("dsh-git: cannot publish a detached HEAD");
          const remote = await firstRemote(root);
          if (remote === void 0) throw new Error("dsh-git: no remote is configured");
          return combined(await runGit(root, ["push", "-u", remote, branch], NETWORK_TIMEOUT_MS));
        }
        case "sync": {
          const pull = await runGit(root, ["pull", "--ff-only"], NETWORK_TIMEOUT_MS);
          const pullText = combined(pull);
          if (pull.code !== 0) return pullText;
          const push = await runGit(root, ["push"], NETWORK_TIMEOUT_MS);
          return [pullText, combined(push)].filter((s) => s.length > 0).join("\n");
        }
        default:
          throw new Error(`dsh-git: unknown sync action ${String(action)}`);
      }
    });
  }
  async suggestMessage(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const root = await repoRoot(dir);
    if (root === void 0) throw new Error("dsh-git: not a git repository");
    const collected = await collectChangeDiff(root, {
      staged: typeof request?.staged === "boolean" ? request.staged : void 0,
      maxBytes: MAX_AI_DIFF_BYTES
    });
    if (collected.text.length === 0) {
      throw new Error(
        collected.scope === "staged" ? "dsh-git: nothing is staged to describe" : "dsh-git: there are no changes to describe"
      );
    }
    const body = collected.text;
    const system = [
      "You write git commit messages for a software project.",
      "Follow Conventional Commits: a `type(scope): subject` line, where type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore.",
      "The subject line must be imperative mood, lower case after the colon, no trailing period, and at most 72 characters.",
      'If the change is not trivial, add a blank line and 1-3 short bullet points starting with "- " explaining what changed and why.',
      "Return ONLY the commit message. No quotes, no code fences, no preamble, no explanation."
    ].join("\n");
    const preamble = [
      collected.scope === "staged" ? "Write a commit message for the STAGED changes below. They are exactly what the commit will record; describe nothing else." : "Write a commit message for all uncommitted changes below.",
      ...collected.truncated ? ["The diff is TRUNCATED \u2014 summarize the overall change, do not claim to have seen every file."] : []
    ].join("\n");
    const messages = [
      createUserMessage({
        content: [{ type: "text", text: `${preamble}

${body}` }],
        source: { kind: "plugin", plugin: "dsh-git" }
      })
    ];
    const selection = this.ctx.agentDefaultModel.currentSelection();
    const assembler = new BlockAssembler();
    for await (const chunk of this.ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort !== void 0 ? { reasoningEffort: selection.reasoningEffort } : {},
      messages,
      system,
      maxTokens: 512
      // NOTE: `purpose` is a closed union ('compaction' | 'session-title') with
      // no commit-message member, so it is deliberately left unset.
    })) {
      assembler.push(chunk);
    }
    const finish = assembler.finish;
    if (finish.kind === "error" || finish.kind === "aborted") {
      throw new Error(`dsh-git: ${finish.failure?.message ?? finish.kind}`);
    }
    const text = assembler.blocks().filter((b) => b.type === "text").map((b) => b.text).join("");
    const message = cleanMessage(text);
    if (message.length === 0) throw new Error("dsh-git: the model produced no commit message");
    return { message, scope: collected.scope };
  }
  /**
   * Run one repository mutation on the repo's write chain and report the result.
   * @param dir - workspace directory.
   * @param run - the operation, receiving the resolved repository root.
   * @returns the uniform command result with a refreshed status.
   */
  async withRepo(dir, run) {
    const root = await repoRoot(dir);
    if (root === void 0) {
      return {
        ok: false,
        output: "Not a git repository. Initialize one first.",
        status: { repo: false, root: dir }
      };
    }
    return this.enqueue(root, async () => {
      try {
        const output = await run(root);
        return { ok: true, output, status: await readStatus(root) };
      } catch (error) {
        return { ok: false, output: describe(error), status: await readStatus(root) };
      }
    });
  }
  /**
   * Queue one whole operation behind this repository's prior write.
   * @param key - serialization key, the repository root.
   * @param run - the operation to run once the chain reaches it.
   * @returns whatever the operation resolved to.
   */
  async enqueue(key, run) {
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
  /**
   * Nothing to open; the repository on disk is the state.
   *
   * The watchers are released through `ctx.effect()`, whose teardown runs when
   * the owning fiber unloads. Neither of the obvious alternatives works here:
   * cordis's Service declares no stop symbol (only {@link Service.init}), and
   * `dispose` is not a member of its Events map. Getting this wrong leaks an OS
   * watch handle per repository on every plugin reload.
   */
  async [(_status_dec = [Remote], _changeToken_dec = [Remote], _diff_dec = [Remote], _commitFiles_dec = [Remote], _commitDiff_dec = [Remote], _stage_dec = [Remote], _commit_dec = [Remote], _init_dec = [Remote], _sync_dec = [Remote], _suggestMessage_dec = [Remote], Service.init)]() {
    this.ctx.effect(() => () => {
      this.watcher.close();
    });
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "status", _status_dec, _GitService);
__decorateElement(_init, 1, "changeToken", _changeToken_dec, _GitService);
__decorateElement(_init, 1, "diff", _diff_dec, _GitService);
__decorateElement(_init, 1, "commitFiles", _commitFiles_dec, _GitService);
__decorateElement(_init, 1, "commitDiff", _commitDiff_dec, _GitService);
__decorateElement(_init, 1, "stage", _stage_dec, _GitService);
__decorateElement(_init, 1, "commit", _commit_dec, _GitService);
__decorateElement(_init, 1, "init", _init_dec, _GitService);
__decorateElement(_init, 1, "sync", _sync_dec, _GitService);
__decorateElement(_init, 1, "suggestMessage", _suggestMessage_dec, _GitService);
__decoratorMetadata(_init, _GitService);
__name(_GitService, "GitService");
__publicField(_GitService, "inject", ["workspaceRegistry", "llm", "agentDefaultModel"]);
var GitService = _GitService;
async function firstRemote(root) {
  const run = await runGit(root, ["remote"]);
  if (run.code !== 0) return void 0;
  return run.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0)[0];
}
__name(firstRemote, "firstRemote");
function normalizeBranch(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "main";
  const name = value.trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new Error(`dsh-git: invalid branch name ${name}`);
  }
  return name;
}
__name(normalizeBranch, "normalizeBranch");
function cleanMessage(raw) {
  let text = raw.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text);
  if (fence) text = fence[1].trim();
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, "").trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  return text;
}
__name(cleanMessage, "cleanMessage");
function clamp(text) {
  if (text.length <= MAX_DIFF_BYTES) return text;
  return `${text.slice(0, MAX_DIFF_BYTES)}

[diff truncated at ${MAX_DIFF_BYTES} bytes]`;
}
__name(clamp, "clamp");
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
__name(describe, "describe");
var index_default = GitService;
export {
  GitService,
  index_default as default
};
