#!/usr/bin/env node

// src/cli.ts
import { resolve as resolve2 } from "node:path";

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
function toPriority(value) {
  return typeof value === "string" && PRIORITIES.includes(value) ? value : DEFAULT_PRIORITY;
}
function normalizeLabel(raw) {
  if (typeof raw !== "string") return void 0;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return text.length > 0 ? text : void 0;
}
var RELEASE_LABEL_RE = /^\d+(\.\d+){0,2}$/;
var SPRINT_LABEL_RE = /^\d+(\.\d+)?$/;
function normalizeVersionLabel(raw, field) {
  const label = normalizeLabel(raw);
  if (label === void 0) return void 0;
  const pattern = field === "release" ? RELEASE_LABEL_RE : SPRINT_LABEL_RE;
  return pattern.test(label) ? label : void 0;
}
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDueDate(raw) {
  if (typeof raw !== "string") return void 0;
  const text = raw.trim();
  if (!DATE_RE.test(text)) return void 0;
  const parsed = /* @__PURE__ */ new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return void 0;
  return parsed.toISOString().slice(0, 10) === text ? text : void 0;
}
var MAX_TEXT = 500;
var MAX_DESC = 5e3;
var MAX_LABEL = 60;
var SUGGESTIONS_DIR = ".dsh";
var SUGGESTIONS_FILE = `${SUGGESTIONS_DIR}/suggestions.json`;

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
function migrateSchema(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info(todo)").all().map((c) => String(c.name))
  );
  const add = (name, ddl) => {
    if (columns.has(name)) return false;
    db.exec(`ALTER TABLE todo ADD COLUMN ${ddl}`);
    columns.add(name);
    return true;
  };
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
function readList(db) {
  const revision = Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get()?.value ?? 0);
  const updatedAt = Number(db.prepare("SELECT value FROM meta WHERE key = 'updatedAt'").get()?.value ?? 0);
  const rows = db.prepare(
    `SELECT id, title, description, status, priority, release, sprint, due_date,
              session_id, created_at, completed_at, archived_at
       FROM todo ORDER BY position ASC`
  ).all();
  const text = (v) => v === null || v === void 0 ? void 0 : String(v);
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

// src/cli.ts
var EXIT = {
  ok: 0,
  /** Bad flags, unknown command, malformed value. */
  usage: 2,
  /** A well-formed request that matched nothing (e.g. unknown task id). */
  notFound: 3
};
function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      options[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next === void 0 || next.startsWith("--")) {
      options[body] = true;
    } else {
      options[body] = next;
      i += 1;
    }
  }
  return { command, positional, options };
}
var CliError = class extends Error {
  /**
   * @param message - human-readable reason.
   * @param code - process exit code, from {@link EXIT}.
   * @param details - extra machine-readable fields merged into the `--json`
   * error payload, so an agent can correct itself without parsing the sentence.
   */
  constructor(message, code = EXIT.usage, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "CliError";
  }
};
function str(options, key) {
  const value = options[key];
  if (value === void 0) return void 0;
  if (value === true) throw new CliError(`--${key} needs a value`);
  return value;
}
function oneOf(options, key, allowed) {
  const raw = str(options, key);
  if (raw === void 0) return void 0;
  if (!allowed.includes(raw)) {
    throw new CliError(`--${key} must be one of: ${allowed.join(", ")} (got "${raw}")`);
  }
  return raw;
}
function assertLabel(field, raw) {
  if (raw === void 0 || raw === "") return;
  if (normalizeVersionLabel(raw, field) !== void 0) return;
  const shape = field === "release" ? "a version number like 1.5 or 0.5.1 (up to three numbers)" : "a decimal number like 1.5 (one dot at most)";
  throw new CliError(
    `--${field} must be ${shape} (got "${raw}") \u2014 nothing was saved`,
    EXIT.usage,
    { field, expected: shape, got: raw }
  );
}
function resolveWorkspace(options, cwd) {
  return resolve2(str(options, "workspace") ?? cwd);
}
function makeId(now, rand) {
  return `t${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}
function isDone(item) {
  return item.status === "done";
}
function isArchived(item) {
  return typeof item.archivedAt === "number";
}
function findItem(items, ref) {
  const exact = items.find((i) => i.id === ref);
  if (exact) return exact;
  const matches = items.filter((i) => i.id.startsWith(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new CliError(`no task matching "${ref}"`, EXIT.notFound);
  throw new CliError(
    `"${ref}" matches ${matches.length} tasks: ${matches.map((i) => i.id).join(", ")}`
  );
}
function mutate(dir, fn) {
  const db = openDb(dir);
  try {
    const current = readList(db);
    const next = fn(current.items);
    const revision = current.revision + 1;
    writeList(db, next, revision);
    return { items: next, revision };
  } finally {
    db.close();
  }
}
function read(dir) {
  const db = openDb(dir);
  try {
    const list = readList(db);
    return { items: list.items, revision: list.revision };
  } finally {
    db.close();
  }
}
function filterList(items, filter) {
  return items.filter((item) => {
    if (!filter.archived && isArchived(item)) return false;
    if (filter.archived && !isArchived(item)) return false;
    if (filter.open && isDone(item)) return false;
    if (filter.status && item.status !== filter.status) return false;
    if (filter.priority && item.priority !== filter.priority) return false;
    if (filter.release && item.release !== filter.release) return false;
    if (filter.sprint && item.sprint !== filter.sprint) return false;
    return true;
  });
}
function formatItem(item) {
  const box = isDone(item) ? "[x]" : "[ ]";
  const bits = [box, item.id.padEnd(12), item.status.padEnd(11), item.priority, item.title];
  const meta = [];
  if (item.release) meta.push(`release=${item.release}`);
  if (item.sprint) meta.push(`sprint=${item.sprint}`);
  if (item.dueDate) meta.push(`due=${item.dueDate}`);
  if (item.sessionId) meta.push(`session=${item.sessionId}`);
  if (isArchived(item)) meta.push("archived");
  return bits.join(" ") + (meta.length ? `  (${meta.join(" ")})` : "");
}
var HELP = `dsh-todo \u2014 manage a workspace's task list

Usage
  dsh-todo <command> [options]

Commands
  list                       Show tasks (active only by default)
  add <title>                Create a task
  update <id>                Change fields on a task
  done <id>                  Mark a task done
  reopen <id>                Return a finished task to todo
  rm <id>                    Delete a task outright
  archive [<id>]             Archive one task, or every completed task
  show <id>                  Print one task in full
  help                       This text

Options
  --workspace <dir>          Workspace directory (default: cwd)
  --json                     Machine-readable output (use this from a script)

  --status <s>               ${STATUSES.join("|")}
  --priority <p>             ${PRIORITIES.join("|")}
  --release <n[.n[.n]]>      e.g. 1.5 or 0.5.1   (empty string clears)
  --sprint <n[.n]>           e.g. 24             (empty string clears)
  --due <YYYY-MM-DD>         Calendar day       (empty string clears)
  --session <id>             Harness session working the task (update only;
                             empty string clears)
  --description <text>       Body text          (empty string clears)
  --title <text>             Rename (update only)

  list filters: --status --priority --release --sprint --open --archived

Ids may be given as any unambiguous prefix.

Examples
  dsh-todo list --open --json
  dsh-todo add "Fix token refresh" --priority p0 --release 1.5 --due 2026-03-14
  dsh-todo update t1a2 --status in-progress --sprint 24
  dsh-todo done t1a2
`;
function run(parsed, cwd, now = Date.now, rand = Math.random) {
  const { command, positional, options } = parsed;
  const dir = resolveWorkspace(options, cwd);
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return { text: HELP, json: { help: HELP } };
    case "list": {
      const { items } = read(dir);
      const filtered = filterList(items, {
        status: oneOf(options, "status", STATUSES),
        priority: oneOf(options, "priority", PRIORITIES),
        release: str(options, "release"),
        sprint: str(options, "sprint"),
        open: options.open === true,
        archived: options.archived === true
      });
      const text = filtered.length === 0 ? "No matching tasks." : filtered.map(formatItem).join("\n");
      return { text, json: { count: filtered.length, items: filtered } };
    }
    case "show": {
      const ref = positional[0];
      if (!ref) throw new CliError("show needs a task id");
      const { items } = read(dir);
      const item = findItem(items, ref);
      const lines = [
        `id          ${item.id}`,
        `title       ${item.title}`,
        `status      ${item.status}`,
        `priority    ${item.priority}`,
        `release     ${item.release ?? "-"}`,
        `sprint      ${item.sprint ?? "-"}`,
        `due         ${item.dueDate ?? "-"}`,
        `session     ${item.sessionId ?? "-"}`,
        `created     ${new Date(item.createdAt).toISOString()}`,
        ...item.completedAt ? [`completed   ${new Date(item.completedAt).toISOString()}`] : [],
        ...item.archivedAt ? [`archived    ${new Date(item.archivedAt).toISOString()}`] : [],
        ...item.description ? ["", item.description] : []
      ];
      return { text: lines.join("\n"), json: item };
    }
    case "add": {
      const title = positional.join(" ").trim();
      if (!title) throw new CliError("add needs a title");
      const description = str(options, "description");
      const releaseRaw = str(options, "release");
      const sprintRaw = str(options, "sprint");
      assertLabel("release", releaseRaw);
      assertLabel("sprint", sprintRaw);
      const release = normalizeVersionLabel(releaseRaw, "release");
      const sprint = normalizeVersionLabel(sprintRaw, "sprint");
      const dueRaw = str(options, "due");
      if (dueRaw !== void 0 && dueRaw !== "" && normalizeDueDate(dueRaw) === void 0) {
        throw new CliError(`--due must be a real calendar date as YYYY-MM-DD (got "${dueRaw}")`);
      }
      const item = {
        id: makeId(now(), rand),
        title: title.slice(0, MAX_TEXT),
        status: oneOf(options, "status", STATUSES) ?? "todo",
        priority: oneOf(options, "priority", PRIORITIES) ?? "p2",
        ...description ? { description: description.slice(0, MAX_DESC) } : {},
        ...release !== void 0 ? { release } : {},
        ...sprint !== void 0 ? { sprint } : {},
        ...dueRaw ? { dueDate: normalizeDueDate(dueRaw) } : {},
        createdAt: now()
      };
      const { revision } = mutate(dir, (items) => [...items, item]);
      return { text: `added ${item.id}  ${item.title}`, json: { item, revision } };
    }
    case "update": {
      const ref = positional[0];
      if (!ref) throw new CliError("update needs a task id");
      const status = oneOf(options, "status", STATUSES);
      const priority = oneOf(options, "priority", PRIORITIES);
      const title = str(options, "title");
      const description = str(options, "description");
      const release = str(options, "release");
      const sprint = str(options, "sprint");
      const due = str(options, "due");
      const session = str(options, "session");
      if (due !== void 0 && due !== "" && normalizeDueDate(due) === void 0) {
        throw new CliError(`--due must be a real calendar date as YYYY-MM-DD (got "${due}")`);
      }
      assertLabel("release", release);
      assertLabel("sprint", sprint);
      if (status === void 0 && priority === void 0 && title === void 0 && description === void 0 && release === void 0 && sprint === void 0 && due === void 0 && session === void 0) {
        throw new CliError("update needs at least one field to change");
      }
      let updated;
      const { revision } = mutate(dir, (items) => {
        const target = findItem(items, ref);
        return items.map((item) => {
          if (item.id !== target.id) return item;
          const next = { ...item };
          if (title !== void 0) next.title = title.slice(0, MAX_TEXT);
          if (priority !== void 0) next.priority = toPriority(priority);
          if (status !== void 0) {
            next.status = toStatus(status);
            if (next.status === "done") next.completedAt = now();
            else delete next.completedAt;
          }
          if (description !== void 0) {
            if (description) next.description = description.slice(0, MAX_DESC);
            else delete next.description;
          }
          for (const [key, raw] of [["release", release], ["sprint", sprint]]) {
            if (raw === void 0) continue;
            const label = normalizeVersionLabel(raw, key);
            if (label !== void 0) next[key] = label;
            else delete next[key];
          }
          if (due !== void 0) {
            const value = normalizeDueDate(due);
            if (value !== void 0) next.dueDate = value;
            else delete next.dueDate;
          }
          if (session !== void 0) {
            if (session) next.sessionId = session.slice(0, MAX_LABEL);
            else delete next.sessionId;
          }
          updated = next;
          return next;
        });
      });
      return { text: `updated ${updated?.id}`, json: { item: updated, revision } };
    }
    case "done":
    case "reopen": {
      const ref = positional[0];
      if (!ref) throw new CliError(`${command} needs a task id`);
      const target = command === "done" ? "done" : "todo";
      let updated;
      const { revision } = mutate(dir, (items) => {
        const found = findItem(items, ref);
        return items.map((item) => {
          if (item.id !== found.id) return item;
          const next = { ...item, status: target };
          if (target === "done") next.completedAt = now();
          else delete next.completedAt;
          updated = next;
          return next;
        });
      });
      return { text: `${command} ${updated?.id}  ${updated?.title}`, json: { item: updated, revision } };
    }
    case "rm": {
      const ref = positional[0];
      if (!ref) throw new CliError("rm needs a task id");
      let removed;
      const { revision } = mutate(dir, (items) => {
        removed = findItem(items, ref);
        return items.filter((item) => item.id !== removed?.id);
      });
      return { text: `removed ${removed?.id}  ${removed?.title}`, json: { item: removed, revision } };
    }
    case "archive": {
      const ref = positional[0];
      const stamp = now();
      let count = 0;
      const { revision } = mutate(dir, (items) => {
        if (ref) {
          const found = findItem(items, ref);
          return items.map((item) => {
            if (item.id !== found.id || isArchived(item)) return item;
            count += 1;
            return { ...item, archivedAt: stamp };
          });
        }
        return items.map((item) => {
          if (!isDone(item) || isArchived(item)) return item;
          count += 1;
          return { ...item, archivedAt: stamp };
        });
      });
      return { text: `archived ${count} task(s)`, json: { archived: count, revision } };
    }
    default:
      throw new CliError(`unknown command "${command}" \u2014 try: dsh-todo help`);
  }
}
function main(argv, cwd = process.cwd()) {
  const parsed = parseArgs(argv);
  const wantsJson = parsed.options.json === true;
  try {
    const outcome = run(parsed, cwd);
    const json = outcome.json !== null && typeof outcome.json === "object" && !Array.isArray(outcome.json) ? { ok: true, ...outcome.json } : { ok: true, result: outcome.json };
    console.log(wantsJson ? JSON.stringify(json, null, 2) : outcome.text);
    return EXIT.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CliError ? error.code : 1;
    const details = error instanceof CliError ? error.details : {};
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: message, code, ...details }, null, 2));
    else console.error(`dsh-todo: ${message}`);
    return code;
  }
}

// src/bin.ts
process.exitCode = main(process.argv.slice(2));
