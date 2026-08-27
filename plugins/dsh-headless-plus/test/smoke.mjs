// Offline smoke test: flag parsing + session resolution, no dsh boot needed.
// Run: node test/smoke.mjs
import { parseModelOverride } from "../lib/startup.js";
import { workspaceSlug, resolveLatestSession } from "../lib/index.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

// --- parseModelOverride ---
assert.equal(parseModelOverride(undefined), null);
assert.deepEqual(parseModelOverride("zai-glm/glm-5.3"), { provider: "zai-glm", model: "glm-5.3" });
assert.deepEqual(parseModelOverride("anthropic/claude-sonnet-4-6"), {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
});
// model ids may contain slashes themselves; provider is up to FIRST slash
assert.deepEqual(parseModelOverride("openai/gpt-5.2/codex"), { provider: "openai", model: "gpt-5.2/codex" });
for (const bad of ["noglash", "/leading", "trailing/", ""]) {
  assert.throws(() => parseModelOverride(bad), Error, `expected throw for ${bad}`);
}
console.log("parseModelOverride: OK");

// --- workspaceSlug ---
// mirrors dsh-session-persistence-jsonl: separators -> '-', '--' + capped + '--'
assert.equal(workspaceSlug("C:\\Users\\example"), "--C-Users-example--");
assert.equal(workspaceSlug("/home/x"), "--home-x--");
console.log("workspaceSlug: OK");

// --- resolveLatestSession ---
const root = mkdtempSync(join(tmpdir(), "dshp-test-"));
const slug = workspaceSlug(process.cwd());
const ws = join(root, slug);
mkdirSync(join(ws, "session-older"), { recursive: true });
writeFileSync(join(ws, "session-older", "session.jsonl.zstd"), "x");
await sleep(20);
mkdirSync(join(ws, "session-newer"), { recursive: true });
writeFileSync(join(ws, "session-newer", "session.jsonl.zstd"), "x");
mkdirSync(join(ws, "not-a-session"), { recursive: true }); // ignored
assert.equal(resolveLatestSession(root, process.cwd()), "session-newer");
assert.equal(resolveLatestSession(root, "C:\\definitely\\not\\here"), undefined);
rmSync(root, { recursive: true, force: true });
console.log("resolveLatestSession: OK");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log("ALL SMOKE TESTS PASSED");
