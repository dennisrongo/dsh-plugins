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
import { readFileSync, renameSync, existsSync } from "node:fs";
import { isAbsolute, join as join2, resolve as resolve2 } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

// src/db.ts
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";

// src/types.ts
var STATUSES = ["backlog", "todo", "in-progress", "blocked", "done"];
var DEFAULT_STATUS = "todo";
var PRIORITIES = ["p0", "p1", "p2", "p3"];
var DEFAULT_PRIORITY = "p2";
function toStatus(value) {
  return typeof value === "string" && STATUSES.includes(value) ? value : DEFAULT_STATUS;
}
__name(toStatus, "toStatus");
function toPriority(value) {
  return typeof value === "string" && PRIORITIES.includes(value) ? value : DEFAULT_PRIORITY;
}
__name(toPriority, "toPriority");
function normalizeLabel(raw) {
  if (typeof raw !== "string") return void 0;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return text.length > 0 ? text : void 0;
}
__name(normalizeLabel, "normalizeLabel");
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDueDate(raw) {
  if (typeof raw !== "string") return void 0;
  const text = raw.trim();
  if (!DATE_RE.test(text)) return void 0;
  const parsed = /* @__PURE__ */ new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return void 0;
  return parsed.toISOString().slice(0, 10) === text ? text : void 0;
}
__name(normalizeDueDate, "normalizeDueDate");
var MAX_TEXT = 500;
var MAX_DESC = 5e3;
var MAX_LABEL = 60;
var MAX_ITEMS = 1e3;

// src/db.ts
var DOT_DSH = ".dsh";
var DB_FILE = "todo.db";
var BUSY_TIMEOUT_MS = 5e3;
function openDb(dir) {
  const resolved = resolve(dir);
  mkdirSync(join(resolved, DOT_DSH), { recursive: true });
  const db = new DatabaseSync(join(resolved, DOT_DSH, DB_FILE));
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS todo (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL,
      done         INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at  INTEGER,
      position     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  migrateSchema(db);
  return db;
}
__name(openDb, "openDb");
function migrateSchema(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info(todo)").all().map((c) => String(c.name))
  );
  const add = /* @__PURE__ */ __name((name, ddl) => {
    if (columns.has(name)) return false;
    db.exec(`ALTER TABLE todo ADD COLUMN ${ddl}`);
    columns.add(name);
    return true;
  }, "add");
  const addedTitle = add("title", "title TEXT");
  const addedStatus = add("status", "status TEXT");
  add("description", "description TEXT");
  add("priority", "priority TEXT");
  add("release", "release TEXT");
  add("sprint", "sprint TEXT");
  add("due_date", "due_date TEXT");
  add("session_id", "session_id TEXT");
  if (addedTitle && columns.has("text")) {
    db.exec("UPDATE todo SET title = text WHERE title IS NULL");
  }
  if (addedStatus && columns.has("done")) {
    db.exec("UPDATE todo SET status = CASE WHEN done = 1 THEN 'done' ELSE 'todo' END WHERE status IS NULL");
  }
  db.exec("UPDATE todo SET status = 'todo' WHERE status IS NULL OR status = ''");
  db.exec("UPDATE todo SET priority = 'p2' WHERE priority IS NULL OR priority = ''");
  db.exec("UPDATE todo SET title = '' WHERE title IS NULL");
}
__name(migrateSchema, "migrateSchema");
function readList(db) {
  const revision = Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get()?.value ?? 0);
  const updatedAt = Number(db.prepare("SELECT value FROM meta WHERE key = 'updatedAt'").get()?.value ?? 0);
  const rows = db.prepare(
    `SELECT id, title, description, status, priority, release, sprint, due_date,
              session_id, created_at, completed_at, archived_at
       FROM todo ORDER BY position ASC`
  ).all();
  const text = /* @__PURE__ */ __name((v) => v === null || v === void 0 ? void 0 : String(v), "text");
  const items = [];
  for (const row of rows) {
    items.push({
      id: String(row.id),
      title: String(row.title ?? ""),
      status: toStatus(row.status),
      priority: toPriority(row.priority),
      ...text(row.description) !== void 0 ? { description: text(row.description) } : {},
      ...normalizeLabel(row.release) !== void 0 ? { release: normalizeLabel(row.release) } : {},
      ...normalizeLabel(row.sprint) !== void 0 ? { sprint: normalizeLabel(row.sprint) } : {},
      ...normalizeDueDate(row.due_date) !== void 0 ? { dueDate: normalizeDueDate(row.due_date) } : {},
      ...text(row.session_id) !== void 0 ? { sessionId: text(row.session_id) } : {},
      createdAt: Number(row.created_at),
      ...row.completed_at !== null && row.completed_at !== void 0 ? { completedAt: Number(row.completed_at) } : {},
      ...row.archived_at !== null && row.archived_at !== void 0 ? { archivedAt: Number(row.archived_at) } : {}
    });
  }
  return { items, revision, updatedAt };
}
__name(readList, "readList");
function writeList(db, items, revision, updatedAt = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM todo").run();
    const insert = db.prepare(
      `INSERT INTO todo (id, title, description, status, priority, release, sprint, due_date,
                         session_id, text, done, created_at, completed_at, archived_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((item, index) => {
      insert.run(
        item.id,
        item.title,
        item.description ?? null,
        item.status,
        item.priority,
        item.release ?? null,
        item.sprint ?? null,
        item.dueDate ?? null,
        item.sessionId ?? null,
        item.title,
        item.status === "done" ? 1 : 0,
        item.createdAt,
        item.completedAt ?? null,
        item.archivedAt ?? null,
        index
      );
    });
    db.prepare(`INSERT INTO meta (key, value) VALUES ('revision', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(revision));
    db.prepare(`INSERT INTO meta (key, value) VALUES ('updatedAt', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(updatedAt));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
__name(writeList, "writeList");

// src/index.ts
var todoItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(MAX_TEXT),
  description: z.string().max(MAX_DESC).optional(),
  status: z.enum(["backlog", "todo", "in-progress", "blocked", "done"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  release: z.string().max(MAX_LABEL).optional(),
  sprint: z.string().max(MAX_LABEL).optional(),
  dueDate: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  archivedAt: z.number().optional()
});
var todoListSchema = z.object({
  items: z.array(todoItemSchema).max(MAX_ITEMS),
  revision: z.number(),
  updatedAt: z.number()
});
var todoDomainSpec = {
  name: "dsh_todo",
  version: 2
};
var _replace_dec, _list_dec, _a, _init, _b;
var _TodoService = class _TodoService extends (_b = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the workspace registry.
   */
  constructor(ctx) {
    super(ctx, "dshTodo");
    __runInitializers(_init, 5, this);
    /** Open database handle per workspace id, kept for the service lifetime. */
    __publicField(this, "dbs", /* @__PURE__ */ new Map());
    /** Resolved workspace directory per workspace id. */
    __publicField(this, "dirs", /* @__PURE__ */ new Map());
    /** Per-workspace write chain, keyed by workspace id. */
    __publicField(this, "tails", /* @__PURE__ */ new Map());
  }
  /**
   * Migrate the legacy central JSON store into the per-workspace databases.
   *
   * The legacy layout kept one `<home>/storages/dsh_todo.json` keyed by opaque
   * workspace uuid. That uuid maps to a directory through the same home's
   * `storages/workspace.json`, so the lists CAN be carried over: each one is
   * imported into `<workspace>/.dsh/todo.db` with its revision and timestamps
   * preserved, and only then is the legacy file renamed `.migrated`.
   *
   * Runs once per harness home; a workspace whose db already has content is
   * left untouched, so a half-finished migration never clobbers newer data.
   */
  async [(_a = Service.init, _list_dec = [Remote], _replace_dec = [Remote], _a)]() {
    this.ctx.effect(() => () => this.close(), "dsh-todo: close workspace databases");
    const home = process.env.DSH_HOME;
    if (!home) return;
    const legacyPath = join2(home, "storages", "dsh_todo.json");
    const registryPath = join2(home, "storages", "workspace.json");
    try {
      if (!existsSync(legacyPath)) return;
      const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
      const records = legacy?.tables?.workspaces ?? {};
      let mapping = {};
      if (existsSync(registryPath)) {
        mapping = JSON.parse(readFileSync(registryPath, "utf8"))?.tables?.workspaces ?? {};
      }
      let importedItems = 0;
      let importedWorkspaces = 0;
      let unmapped = 0;
      for (const [uuid, record] of Object.entries(records)) {
        const dir = mapping[uuid]?.path;
        if (!dir || !isAbsolute(dir)) {
          unmapped += Object.keys(record?.items ?? {}).length ? 1 : 0;
          continue;
        }
        const db = this.openDb(dir);
        const current = this.readList(db);
        if (current.revision > 0) continue;
        const items = sanitizeItems(record?.items);
        this.writeList(db, items, (record?.revision ?? 0) + 1, record?.updatedAt ?? Date.now());
        importedItems += items.length;
        importedWorkspaces += 1;
      }
      const stamp = legacyPath.replace(/\.json$/, ".migrated");
      if (!existsSync(stamp)) renameSync(legacyPath, stamp);
      console.log(
        `[dsh-todo] legacy store migrated: ${importedItems} item(s) into ${importedWorkspaces} workspace db(s)` + (unmapped > 0 ? `; ${unmapped} workspace(s) had no directory mapping and were skipped` : "") + ` -> ${stamp}`
      );
    } catch (err) {
      console.warn(`[dsh-todo] legacy store migration deferred:`, err);
    }
  }
  /**
   * Resolve a workspace id to its canonical directory via the registry.
   * @param workspaceId - the workspace to resolve.
   * @returns the canonical workspace directory.
   */
  workspaceDir(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("dsh-todo: workspaceId must be a non-empty string");
    }
    const cached = this.dirs.get(workspaceId);
    if (cached) return cached;
    const registry = this.ctx.workspaceRegistry;
    const workspace = registry.list().find((w) => String(w.id) === workspaceId);
    if (workspace === void 0) throw new Error(`dsh-todo: unknown workspace ${workspaceId}`);
    const dir = resolve2(workspace.path);
    this.dirs.set(workspaceId, dir);
    return dir;
  }
  /**
   * Open (creating if needed) the workspace's database by directory. Handles
   * are cached per resolved path; `mkdir -p` runs on every open because the
   * `.dsh` directory is cheap to create and the workspace may have been
   * cloned since.
   */
  openDb(dir) {
    const resolved = resolve2(dir);
    const cached = this.dbs.get(resolved);
    if (cached) return cached;
    const db = openDb(resolved);
    this.dbs.set(resolved, db);
    return db;
  }
  /** Resolve the workspace id, then open (or find) its database. */
  db(workspaceId) {
    return this.openDb(this.workspaceDir(workspaceId));
  }
  /** Guard: registry lookups happen on every call, so unknown ids fail loudly. */
  requireDb(workspaceId) {
    return this.db(workspaceId);
  }
  async list(request) {
    const db = this.requireDb(request?.workspaceId);
    return { list: this.readList(db) };
  }
  async replace(request) {
    const workspaceId = request?.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("dsh-todo: workspaceId must be a non-empty string");
    }
    const items = sanitizeItems(request?.items);
    const ifRevision = request?.ifRevision ?? null;
    return this.enqueue(workspaceId, async () => {
      const db = this.requireDb(workspaceId);
      const current = this.readList(db);
      const matches = ifRevision === null ? current.revision === 0 : ifRevision === current.revision;
      if (!matches) return { ok: false, code: "revision-conflict", list: current };
      this.writeList(db, items, current.revision + 1);
      return { ok: true, list: this.readList(db) };
    });
  }
  /** Queue one whole read/compare/write behind this workspace's prior write. */
  async enqueue(workspaceId, run) {
    const prior = this.tails.get(workspaceId) ?? Promise.resolve();
    const next = prior.then(run, run);
    const tail = next.then(
      () => void 0,
      () => void 0
    );
    this.tails.set(workspaceId, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(workspaceId) === tail) this.tails.delete(workspaceId);
    }
  }
  /**
   * Close every open database handle. Called on fiber teardown via the init
   * effect; public because embedders (and tests) driving the service without
   * a full cordis lifecycle need the same guarantee — on Windows an open
   * handle keeps the file locked against deletion/backup.
   */
  close() {
    for (const db of this.dbs.values()) {
      try {
        db.close();
      } catch {
      }
    }
    this.dbs.clear();
  }
  /**
   * Read the whole list, then re-validate it at this service's own boundary.
   *
   * `db.readList` already coerces rows, but the host keeps the zod check: it is
   * the durable read boundary for the WIRE, and a shape the schema rejects must
   * not reach the browser even if the storage layer was willing to build it.
   */
  readList(db) {
    const list = readList(db);
    const items = list.items.filter((item) => todoItemSchema.safeParse(item).success);
    const checked = { items, revision: list.revision, updatedAt: list.updatedAt };
    return todoListSchema.safeParse(checked).success ? checked : { items: [], revision: list.revision, updatedAt: list.updatedAt };
  }
  /** Replace every row inside one transaction and stamp the meta tokens. */
  writeList(db, items, revision, updatedAt = Date.now()) {
    writeList(db, items, revision, updatedAt);
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "list", _list_dec, _TodoService);
__decorateElement(_init, 1, "replace", _replace_dec, _TodoService);
__decoratorMetadata(_init, _TodoService);
__name(_TodoService, "TodoService");
// Per-fiber service grants: the workspace registry property is only readable
// when declared here (same contract dsh-git follows).
__publicField(_TodoService, "inject", ["workspaceRegistry"]);
var TodoService = _TodoService;
function sanitizeItems(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of value) {
    if (out.length >= MAX_ITEMS) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    const rawTitle = typeof e.title === "string" ? e.title : e.text;
    if (typeof rawTitle !== "string") continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const status = e.status === void 0 && e.done === true ? "done" : toStatus(e.status);
    const done = status === "done";
    const description = typeof e.description === "string" && e.description.length > 0 ? e.description.slice(0, MAX_DESC) : void 0;
    const release = normalizeLabel(e.release);
    const sprint = normalizeLabel(e.sprint);
    const dueDate = normalizeDueDate(e.dueDate);
    const sessionId = typeof e.sessionId === "string" && e.sessionId.length > 0 ? e.sessionId.slice(0, MAX_LABEL) : void 0;
    const completedAt = typeof e.completedAt === "number" ? e.completedAt : void 0;
    const archivedAt = typeof e.archivedAt === "number" ? e.archivedAt : void 0;
    out.push({
      id: e.id,
      title: rawTitle.slice(0, MAX_TEXT),
      status,
      priority: toPriority(e.priority),
      ...description !== void 0 ? { description } : {},
      ...release !== void 0 ? { release } : {},
      ...sprint !== void 0 ? { sprint } : {},
      ...dueDate !== void 0 ? { dueDate } : {},
      ...sessionId !== void 0 ? { sessionId } : {},
      createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
      // completedAt is meaningless on an unfinished item; drop it rather than store a lie.
      ...done && completedAt !== void 0 ? { completedAt } : {},
      // archivedAt is the archived flag itself, so a non-numeric value must not
      // survive as a truthy marker.
      ...archivedAt !== void 0 ? { archivedAt } : {}
    });
  }
  return out;
}
__name(sanitizeItems, "sanitizeItems");
var index_default = TodoService;
export {
  TodoService,
  index_default as default,
  todoDomainSpec
};
