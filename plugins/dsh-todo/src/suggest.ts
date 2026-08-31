/**
 * dsh-todo — the suggestion vocabulary.
 *
 * Deliberately dependency-free (it imports `./types.ts` and nothing else), so
 * `lib/suggest.js` can be imported by the test under plain Node with no React
 * and no harness packages on the import path. Same constraint as `launch.ts`,
 * for the same reason.
 */
import {
  DEFAULT_PRIORITY,
  MAX_SUGGESTIONS,
  PRIORITIES,
  SUGGESTIONS_FILE,
  type Suggestion,
  type TodoPriority,
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

/** Narrow an arbitrary value to a known priority band, defaulting rather than failing. */
function toPriority(value: unknown): TodoPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)
    ? (value as TodoPriority)
    : DEFAULT_PRIORITY
}

/**
 * Strip a markdown code fence, if the model wrapped its JSON in one.
 *
 * Told "write only JSON", models still fence it often enough that a retry
 * round-trip is the wrong price to pay for a five-line unwrap.
 */
function unfence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw)
  return fenced === null ? raw : fenced[1]
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
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim() : ''
    suggestions.push({
      title,
      rationale: typeof row.rationale === 'string' ? row.rationale.trim() : '',
      priority: toPriority(row.priority),
      // Absent optional fields are ABSENT KEYS, never '', matching TodoItem.
      ...(evidence.length > 0 ? { evidence } : {}),
    })
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  return { ok: true, suggestions }
}
