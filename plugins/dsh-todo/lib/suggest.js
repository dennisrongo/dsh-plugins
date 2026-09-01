// src/types.ts
var PRIORITIES = ["p0", "p1", "p2", "p3"];
var DEFAULT_PRIORITY = "p2";
function toPriority(value) {
  return typeof value === "string" && PRIORITIES.includes(value) ? value : DEFAULT_PRIORITY;
}
var MAX_TEXT = 500;
var MAX_DESC = 5e3;
var MAX_LABEL = 60;
var SUGGESTIONS_DIR = ".dsh";
var SUGGESTIONS_FILE = `${SUGGESTIONS_DIR}/suggestions.json`;
function makeRunId(now = Date.now(), rand = Math.random) {
  return `${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}
function suggestionsFileFor(runId) {
  return `${SUGGESTIONS_DIR}/suggestions-${runId}.json`;
}
var MAX_SUGGESTIONS = 12;

// src/suggest.ts
function composeScanPrompt(digest, excludeTitles, runId) {
  const parts = [
    "# Propose work for this codebase",
    "You are reviewing a workspace to propose concrete next tasks. Base every suggestion on the evidence below \u2014 do not speculate about code you cannot see.",
    "Look for: unresolved TODO/FIXME/HACK comments, features the docs promise but the code does not implement, and modules with no tests.",
    "## Evidence",
    digest
  ];
  const exclusions = excludeTitles.map((t) => t.trim()).filter((t) => t.length > 0);
  if (exclusions.length > 0) {
    parts.push(
      "## Already planned \u2014 do NOT suggest these or close variants of them",
      exclusions.map((t) => `- ${t}`).join("\n")
    );
  }
  parts.push(
    "## Output",
    `Write ONLY a JSON array to \`${suggestionsFileFor(runId)}\` (create the directory if needed).`,
    'Each element: {"title": string, "rationale": string, "priority": "p0"|"p1"|"p2"|"p3", "evidence": string}',
    "`evidence` is a `file:line` pointer where one exists; omit it otherwise.",
    `Produce at most ${MAX_SUGGESTIONS} suggestions. Write the file and stop \u2014 do not implement anything.`
  );
  return parts.join("\n\n");
}
function unfence(raw) {
  const open = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n?/.exec(raw);
  if (open === null) return raw;
  const lead = raw.slice(0, open.index);
  if (lead.includes("[") || lead.includes("{")) return raw;
  const body = raw.slice(open.index + open[0].length);
  const close = body.lastIndexOf("```");
  return close === -1 ? raw : body.slice(0, close);
}
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
export {
  composeScanPrompt,
  makeRunId,
  parseSuggestions,
  suggestionsFileFor
};
