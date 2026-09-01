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
import { readFileSync as readFileSync2, readdirSync as readdirSync2, renameSync, existsSync, unlinkSync } from "node:fs";
import { isAbsolute, join as join3, resolve as resolve2 } from "node:path";
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
var SUGGESTIONS_DIR = ".dsh";
var SUGGESTIONS_FILE = `${SUGGESTIONS_DIR}/suggestions.json`;
var SUGGESTIONS_FILE_RE = /^suggestions(-[a-z0-9]+)?\.json$/;
function suggestionsFileFor(runId) {
  return `${SUGGESTIONS_DIR}/suggestions-${runId}.json`;
}
__name(suggestionsFileFor, "suggestionsFileFor");
var MAX_SUGGESTIONS = 12;

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

// src/scan.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join as join2, relative, sep } from "node:path";
var DIGEST_BYTE_CAP = 24e3;
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "lib",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".parcel-cache",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  "vendor",
  "vendored",
  "third_party",
  "thirdparty",
  "generated",
  "__generated__",
  "Pods",
  "Carthage",
  "DerivedData"
]);
var SOURCE_EXT = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".kt",
  ".scala",
  ".sh"
]);
var MAX_FILES_WALKED = 4e3;
var MAX_TREE_ENTRIES = 300;
var MAX_COMMENTS = 80;
var MAX_UNTESTED = 40;
var MAX_COMMENT_LINE = 160;
var README_BYTES = 4e3;
var MANIFEST_BYTES = 2e3;
var MAX_DEPTH = 8;
var SCAN_CEILING_FACTOR = 10;
var MAX_FILES_READ = 400;
var MAX_READ_BYTES = 2 * 1024 * 1024;
function posix(path) {
  return path.split(sep).join("/");
}
__name(posix, "posix");
function walk(root) {
  const files = [];
  let truncated = false;
  const visit = /* @__PURE__ */ __name((dir, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES_WALKED) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_WALKED) {
        truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        visit(join2(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        files.push(posix(relative(root, join2(dir, entry.name))));
      }
    }
  }, "visit");
  try {
    if (!statSync(root).isDirectory()) return { files: [], truncated: false };
  } catch {
    return { files: [], truncated: false };
  }
  visit(root, 0);
  return { files, truncated };
}
__name(walk, "walk");
function readText(path, limit = Number.MAX_SAFE_INTEGER) {
  let raw;
  try {
    if (statSync(path).size > MAX_READ_BYTES) return "";
    raw = readFileSync(path, "utf8");
  } catch {
    return "";
  }
  if (raw.includes("\0")) return "";
  return raw.length > limit ? raw.slice(0, limit) : raw;
}
__name(readText, "readText");
function skippedForSize(path) {
  try {
    return statSync(path).size > MAX_READ_BYTES;
  } catch {
    return false;
  }
}
__name(skippedForSize, "skippedForSize");
var COMMENT_RE = /(?:^|\s)(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK)\b[:\s]?(.*)$/;
function collectComments(root, files) {
  const ceiling = MAX_COMMENTS * SCAN_CEILING_FACTOR;
  const kept = [];
  let total = 0;
  let read = 0;
  let skipped = 0;
  let bounded = false;
  for (const rel of files) {
    const dot = rel.lastIndexOf(".");
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue;
    if (total >= ceiling || read >= MAX_FILES_READ) {
      bounded = true;
      break;
    }
    const full = join2(root, rel);
    if (skippedForSize(full)) {
      skipped += 1;
      continue;
    }
    read += 1;
    const text = readText(full);
    if (text === "") continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const match = COMMENT_RE.exec(lines[i]);
      if (match === null) continue;
      total += 1;
      if (kept.length >= MAX_COMMENTS) continue;
      const body = match[2].trim().slice(0, MAX_COMMENT_LINE);
      kept.push(`${rel}:${i + 1}  ${match[1]} ${body}`.trimEnd());
    }
  }
  return { kept, total, bounded, skippedForSize: skipped };
}
__name(collectComments, "collectComments");
function hasTest(base, testNames) {
  return testNames.has(`${base}.test`) || testNames.has(`${base}.spec`) || testNames.has(`test_${base}`) || testNames.has(`${base}_test`) || testNames.has(base);
}
__name(hasTest, "hasTest");
function collectUntested(files) {
  const testNames = /* @__PURE__ */ new Set();
  for (const rel of files) {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    const stem = name.replace(/\.[^.]+$/, "");
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) {
      testNames.add(stem);
      testNames.add(stem.replace(/\.(test|spec)$/i, ""));
    }
  }
  const ceiling = MAX_UNTESTED * SCAN_CEILING_FACTOR;
  const kept = [];
  let total = 0;
  let bounded = false;
  for (const rel of files) {
    const dot = rel.lastIndexOf(".");
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue;
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) continue;
    const stem = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    if (/^(index|main|types|constants)$/i.test(stem)) continue;
    if (hasTest(stem, testNames)) continue;
    if (total >= ceiling) {
      bounded = true;
      break;
    }
    total += 1;
    if (kept.length < MAX_UNTESTED) kept.push(rel);
  }
  return { kept, total, bounded, skippedForSize: 0 };
}
__name(collectUntested, "collectUntested");
function sectionHeader(title, total, kept, options = {}) {
  const bound = options.bounded === true ? "+" : "";
  const skipped = options.skippedForSize ?? 0;
  const note = skipped > 0 ? ` (${skipped} file(s) too large to read)` : "";
  const counts = kept < total || options.bounded === true ? `(${total}${bound} found, showing ${kept})` : `(${total})`;
  return `### ${title} ${counts}${note}`;
}
__name(sectionHeader, "sectionHeader");
function fileHeader(name, text, limit) {
  if (text.length < limit) return `### ${name}`;
  return `### ${name} (clipped to first ${Math.round(limit / 1e3)} KB)`;
}
__name(fileHeader, "fileHeader");
function assemble(sections, walkTruncated) {
  const parts = walkTruncated ? sections.concat(
    "[walk truncated \u2014 this workspace is deeper or larger than one scan walks; files below the depth or count limit were never examined]"
  ) : sections;
  const joined = parts.join("\n\n");
  if (joined.length <= DIGEST_BYTE_CAP) {
    return { digest: joined, truncated: walkTruncated };
  }
  const marker = "\n\n[digest truncated \u2014 the workspace is larger than one scan can carry]";
  return { digest: joined.slice(0, DIGEST_BYTE_CAP - marker.length) + marker, truncated: true };
}
__name(assemble, "assemble");
function buildDigest(root) {
  const { files, truncated } = walk(root);
  const sections = [];
  let sectionTruncated = false;
  const tree = files.slice(0, MAX_TREE_ENTRIES);
  if (tree.length > 0) {
    if (tree.length < files.length) sectionTruncated = true;
    sections.push(`${sectionHeader("Files", files.length, tree.length)}
${tree.join("\n")}`);
  }
  const readmeName = files.find((f) => /^readme(\.md|\.txt)?$/i.test(f));
  if (readmeName !== void 0) {
    const raw = readText(join2(root, readmeName), README_BYTES);
    const text = raw.trim();
    if (text !== "") {
      if (raw.length >= README_BYTES) sectionTruncated = true;
      sections.push(`${fileHeader(readmeName, raw, README_BYTES)}
${text}`);
    }
  }
  const manifest = files.find((f) => f === "package.json");
  if (manifest !== void 0) {
    const raw = readText(join2(root, manifest), MANIFEST_BYTES);
    const text = raw.trim();
    if (text !== "") {
      if (raw.length >= MANIFEST_BYTES) sectionTruncated = true;
      sections.push(`${fileHeader("package.json", raw, MANIFEST_BYTES)}
${text}`);
    }
  }
  const comments = collectComments(root, files);
  if (comments.kept.length > 0 || comments.skippedForSize > 0) {
    if (comments.kept.length < comments.total || comments.bounded || comments.skippedForSize > 0) sectionTruncated = true;
    sections.push(
      sectionHeader(
        "Unresolved comments (TODO/FIXME/HACK)",
        comments.total,
        comments.kept.length,
        { bounded: comments.bounded, skippedForSize: comments.skippedForSize }
      ) + (comments.kept.length > 0 ? "\n" + comments.kept.join("\n") : "")
    );
  }
  const untested = collectUntested(files);
  if (untested.kept.length > 0) {
    if (untested.kept.length < untested.total || untested.bounded) sectionTruncated = true;
    sections.push(
      sectionHeader(
        "Untested modules (name-based hint, not a coverage run)",
        untested.total,
        untested.kept.length,
        { bounded: untested.bounded }
      ) + "\n" + untested.kept.join("\n")
    );
  }
  return assemble(sections, truncated || sectionTruncated);
}
__name(buildDigest, "buildDigest");

// src/suggest.ts
function unfence(raw) {
  const open = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n?/.exec(raw);
  if (open === null) return raw;
  const lead = raw.slice(0, open.index);
  if (lead.includes("[") || lead.includes("{")) return raw;
  const body = raw.slice(open.index + open[0].length);
  const close = body.lastIndexOf("```");
  return close === -1 ? raw : body.slice(0, close);
}
__name(unfence, "unfence");
function parseSuggestions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch (cause) {
    return { ok: false, error: `the scan wrote invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.suggestions) ? parsed.suggestions : void 0;
  if (list === void 0) {
    return { ok: false, error: "the scan did not write a list of suggestions" };
  }
  const suggestions = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (title.length === 0) continue;
    const stored = title.slice(0, MAX_TEXT);
    const key = stored.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = typeof row.evidence === "string" ? row.evidence.trim().slice(0, MAX_LABEL) : "";
    suggestions.push({
      title: stored,
      rationale: typeof row.rationale === "string" ? row.rationale.trim().slice(0, MAX_DESC) : "",
      priority: toPriority(row.priority),
      // Absent optional fields are ABSENT KEYS, never '', matching TodoItem.
      ...evidence.length > 0 ? { evidence } : {}
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return { ok: true, suggestions };
}
__name(parseSuggestions, "parseSuggestions");

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
var _readSuggestions_dec, _scanDigest_dec, _replace_dec, _list_dec, _a, _init, _b;
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
  async [(_a = Service.init, _list_dec = [Remote], _replace_dec = [Remote], _scanDigest_dec = [Remote], _readSuggestions_dec = [Remote], _a)]() {
    this.ctx.effect(() => () => this.close(), "dsh-todo: close workspace databases");
    const home = process.env.DSH_HOME;
    if (!home) return;
    const legacyPath = join3(home, "storages", "dsh_todo.json");
    const registryPath = join3(home, "storages", "workspace.json");
    try {
      if (!existsSync(legacyPath)) return;
      const legacy = JSON.parse(readFileSync2(legacyPath, "utf8"));
      const records = legacy?.tables?.workspaces ?? {};
      let mapping = {};
      if (existsSync(registryPath)) {
        mapping = JSON.parse(readFileSync2(registryPath, "utf8"))?.tables?.workspaces ?? {};
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
  async scanDigest(request) {
    return buildDigest(this.workspaceDir(request?.workspaceId));
  }
  async readSuggestions(request) {
    const dir = this.workspaceDir(request?.workspaceId);
    const runId = request?.runId;
    if (typeof runId !== "string" || !/^[a-z0-9]+$/.test(runId)) {
      throw new Error("dsh-todo: runId must be a non-empty lowercase alphanumeric string");
    }
    const path = join3(dir, ...suggestionsFileFor(runId).split("/"));
    this.sweepOrphanResults(dir, runId);
    let raw;
    try {
      raw = readFileSync2(path, "utf8");
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") return { status: "pending" };
      return { status: "error", error: `dsh-todo: the scan result could not be read: ${code ?? String(err)}` };
    }
    const parsed = parseSuggestions(raw);
    try {
      unlinkSync(path);
    } catch {
    }
    if (!parsed.ok) return { status: "error", error: parsed.error };
    return { status: "ready", suggestions: parsed.suggestions };
  }
  /**
   * Delete every result file that is not the run currently reading.
   *
   * Per-run paths fix the cross-run bleed but introduce their own litter: a
   * scan whose modal was closed still finishes and writes, and nobody ever
   * reads that file. One orphan per abandoned scan accumulates in `.dsh`
   * indefinitely, and abandoning a scan is the ordinary case, not the rare one.
   *
   * Sweeping on every poll — rather than at scan start — is deliberate and
   * cheaper than it looks: a scan already polls this endpoint every 1.5s, one
   * `readdir` of `.dsh` is trivially small beside the digest walk that preceded
   * it, and it means a run started from a build with no sweep at all is still
   * cleaned up by the next one. It also collects the legacy fixed-path file, so
   * an upgrade needs no migration step.
   *
   * The regex is anchored on both ends: `.dsh` holds `todo.db` and whatever
   * else the harness keeps there, and a sweep that guessed wider would delete a
   * neighbour's data. Failure is swallowed throughout — this is housekeeping,
   * and a scan that produced an answer must not fail over tidying.
   *
   * @param dir - the resolved workspace directory.
   * @param runId - the run whose file must SURVIVE.
   */
  sweepOrphanResults(dir, runId) {
    const keep = suggestionsFileFor(runId).split("/").pop();
    try {
      for (const name of readdirSync2(join3(dir, SUGGESTIONS_DIR))) {
        if (name === keep || !SUGGESTIONS_FILE_RE.test(name)) continue;
        try {
          unlinkSync(join3(dir, SUGGESTIONS_DIR, name));
        } catch {
        }
      }
    } catch {
    }
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
__decorateElement(_init, 1, "scanDigest", _scanDigest_dec, _TodoService);
__decorateElement(_init, 1, "readSuggestions", _readSuggestions_dec, _TodoService);
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
