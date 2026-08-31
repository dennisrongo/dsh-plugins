/**
 * dsh-todo — the suggestion vocabulary.
 *
 * Deliberately dependency-free (it imports `./types.ts` and nothing else), so
 * `lib/suggest.js` can be imported by the test under plain Node with no React
 * and no harness packages on the import path. Same constraint as `launch.ts`,
 * for the same reason.
 */
import {
  MAX_DESC,
  MAX_LABEL,
  MAX_SUGGESTIONS,
  MAX_TEXT,
  SUGGESTIONS_FILE,
  type Suggestion,
  toPriority,
} from './types.ts'

/**
 * Compose the brief a scan session works from.
 *
 * The exclusion list is titles ONLY. Descriptions would multiply the token
 * cost of every scan to restate work the model is being asked to avoid, and a
 * title is enough to recognise a duplicate.
 *
 * @param digest - the bounded workspace evidence from `buildDigest`.
 * @param excludeTitles - titles already in the backlog, plus anything already
 *   shown this session so Refresh returns genuinely new ideas.
 * @returns the prompt text for the scan session.
 */
export function composeScanPrompt(digest: string, excludeTitles: readonly string[]): string {
  const parts: string[] = [
    '# Propose work for this codebase',
    'You are reviewing a workspace to propose concrete next tasks. Base every ' +
      'suggestion on the evidence below — do not speculate about code you cannot see.',
    'Look for: unresolved TODO/FIXME/HACK comments, features the docs promise ' +
      'but the code does not implement, and modules with no tests.',
    '## Evidence',
    digest,
  ]

  // Only when there IS something to exclude. An empty "Already planned:"
  // heading teaches the model the field is meaningless — the same reasoning
  // that keeps composePrompt() from emitting "Priority: —".
  const exclusions = excludeTitles.map((t) => t.trim()).filter((t) => t.length > 0)
  if (exclusions.length > 0) {
    parts.push(
      '## Already planned — do NOT suggest these or close variants of them',
      exclusions.map((t) => `- ${t}`).join('\n'),
    )
  }

  parts.push(
    '## Output',
    `Write ONLY a JSON array to \`${SUGGESTIONS_FILE}\` (create the directory if needed).`,
    'Each element: {"title": string, "rationale": string, "priority": "p0"|"p1"|"p2"|"p3", "evidence": string}',
    '`evidence` is a `file:line` pointer where one exists; omit it otherwise.',
    `Produce at most ${MAX_SUGGESTIONS} suggestions. Write the file and stop — do not implement anything.`,
  )

  return parts.join('\n\n')
}

/**
 * Strip a markdown code fence, if the model wrapped its JSON in one.
 *
 * Told "write only JSON", models still fence it often enough that a retry
 * round-trip is the wrong price to pay for a five-line unwrap.
 *
 * Takes everything between the FIRST opening fence and the LAST closing one,
 * rather than requiring the fence to span the whole string. An anchored match
 * failed four shapes models actually emit — trailing prose after the close,
 * a lead-in sentence before the open, no newline before the close, and an
 * uppercase `JSON` tag — each of which cost a Refresh round-trip.
 *
 * A run only OPENS a fence when nothing resembling JSON precedes it. Widening
 * the anchored match to find a fence anywhere made an UNFENCED payload whose
 * own content quotes backticks — `{"rationale": "use ```code``` here"}` — get
 * mined as if it were fenced, slicing the array down to a fragment that fails
 * to parse. That is not a contrived input: `composeScanPrompt` asks the model
 * to hunt TODO/FIXME/HACK comments and cite evidence, so a code snippet inside
 * a `rationale` is the behaviour the feature invites. One backtick run was
 * harmless; two or more truncated the payload.
 *
 * `[` or `{` before the first run is what separates the two cases — a lead-in
 * sentence carries neither, while a bare payload starts with one. An
 * "opening fence must sit at index 0" rule would be simpler and WRONG: it
 * re-breaks the prose-before-the-fence shape this function exists to handle.
 *
 * Deliberately mechanical: when no fence opens, the input is returned
 * UNTOUCHED, so prose containing no JSON still fails at `JSON.parse` instead
 * of being mined for something that looks parseable.
 */
function unfence(raw: string): string {
  const open = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n?/.exec(raw)
  if (open === null) return raw
  // Anything JSON-ish ahead of the run means the run is CONTENT, not a fence.
  const lead = raw.slice(0, open.index)
  if (lead.includes('[') || lead.includes('{')) return raw
  const body = raw.slice(open.index + open[0].length)
  const close = body.lastIndexOf('```')
  return close === -1 ? raw : body.slice(0, close)
}

/**
 * Parse and validate what a scan session wrote.
 *
 * A model writing bad JSON is an EXPECTED case, not an exception: this returns
 * a result rather than throwing, so the modal can offer Refresh instead of
 * crashing the tab.
 *
 * @param raw - the file contents as written by the scan session.
 * @returns the validated suggestions, or a human-readable reason it failed.
 */
export function parseSuggestions(
  raw: string,
): { ok: true; suggestions: Suggestion[] } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(unfence(raw))
  } catch (cause) {
    return { ok: false, error: `the scan wrote invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }

  // Accept both the bare array asked for and the {suggestions: [...]} wrapper
  // models commonly produce anyway.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { suggestions?: unknown } | null)?.suggestions)
      ? ((parsed as { suggestions: unknown[] }).suggestions)
      : undefined
  if (list === undefined) {
    return { ok: false, error: 'the scan did not write a list of suggestions' }
  }

  const suggestions: Suggestion[] = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    // A titleless suggestion has nothing to show in a row, and inventing a
    // title would put a blank task in the backlog. Drop it.
    if (title.length === 0) continue
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim().slice(0, MAX_LABEL) : ''
    suggestions.push({
      // Clamped for the same reason every sibling boundary clamps (index.ts,
      // client.tsx, cli.ts): a suggestion is accepted into the backlog, where
      // the stored caps are MAX_TEXT/MAX_DESC. This is the only boundary whose
      // input is MODEL-generated, so it is the one most likely to run long.
      title: title.slice(0, MAX_TEXT),
      rationale: typeof row.rationale === 'string' ? row.rationale.trim().slice(0, MAX_DESC) : '',
      priority: toPriority(row.priority),
      // Absent optional fields are ABSENT KEYS, never '', matching TodoItem.
      ...(evidence.length > 0 ? { evidence } : {}),
    })
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  return { ok: true, suggestions }
}
