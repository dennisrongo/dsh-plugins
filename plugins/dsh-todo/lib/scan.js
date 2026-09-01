// src/scan.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
function walk(root) {
  const files = [];
  let truncated = false;
  const visit = (dir, depth) => {
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
        visit(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        files.push(posix(relative(root, join(dir, entry.name))));
      }
    }
  };
  try {
    if (!statSync(root).isDirectory()) return { files: [], truncated: false };
  } catch {
    return { files: [], truncated: false };
  }
  visit(root, 0);
  return { files, truncated };
}
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
function skippedForSize(path) {
  try {
    return statSync(path).size > MAX_READ_BYTES;
  } catch {
    return false;
  }
}
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
    const full = join(root, rel);
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
function hasTest(base, testNames) {
  return testNames.has(`${base}.test`) || testNames.has(`${base}.spec`) || testNames.has(`test_${base}`) || testNames.has(`${base}_test`) || testNames.has(base);
}
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
function sectionHeader(title, total, kept, options = {}) {
  const bound = options.bounded === true ? "+" : "";
  const skipped = options.skippedForSize ?? 0;
  const note = skipped > 0 ? ` (${skipped} file(s) too large to read)` : "";
  const counts = kept < total || options.bounded === true ? `(${total}${bound} found, showing ${kept})` : `(${total})`;
  return `### ${title} ${counts}${note}`;
}
function fileHeader(name, text, limit) {
  if (text.length < limit) return `### ${name}`;
  return `### ${name} (clipped to first ${Math.round(limit / 1e3)} KB)`;
}
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
    const raw = readText(join(root, readmeName), README_BYTES);
    const text = raw.trim();
    if (text !== "") {
      if (raw.length >= README_BYTES) sectionTruncated = true;
      sections.push(`${fileHeader(readmeName, raw, README_BYTES)}
${text}`);
    }
  }
  const manifest = files.find((f) => f === "package.json");
  if (manifest !== void 0) {
    const raw = readText(join(root, manifest), MANIFEST_BYTES);
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
export {
  DIGEST_BYTE_CAP,
  buildDigest
};
