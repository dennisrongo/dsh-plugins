/**
 * Matcher semantics: which configured hooks fire for a given tool name.
 *
 * The matcher is a **regular expression**, matching Claude Code, which makes
 * `bash|str_replace_editor` work the way people expect without inventing a
 * second glob dialect. Two departures from a bare `new RegExp(m).test(name)`
 * are deliberate and are what the tests pin:
 *
 *   * `*` is accepted as "everything". It is not valid regex on its own
 *     (`Nothing to repeat`), and it is what someone writes first.
 *   * An invalid pattern matches NOTHING and warns once. Matching everything
 *     would turn one typo into a hook that fires on every tool call in the
 *     session — the loudest possible failure for the quietest possible mistake.
 *
 * @module @dennisrongo/dsh-hooks/matcher
 */

/** Compiled patterns, so a hot tool path never recompiles a regex. */
const compiled = new Map<string, RegExp | null>()

/** Patterns already reported as invalid, so the warning does not repeat per call. */
const warned = new Set<string>()

/**
 * Whether a matcher selects everything.
 *
 * Absent, empty, whitespace and `*` all mean "every tool" — the four things a
 * user writes when they mean "no filter".
 * @param matcher - the configured pattern, if any.
 * @returns true when no filtering should happen.
 */
export function isWildcard(matcher: string | undefined): boolean {
  if (matcher === undefined) return true
  const trimmed = matcher.trim()
  return trimmed === '' || trimmed === '*'
}

/**
 * Compile a matcher once, caching both success and failure.
 * @param matcher - the configured pattern.
 * @returns the compiled expression, or null when it is invalid.
 */
function compile(matcher: string): RegExp | null {
  const cached = compiled.get(matcher)
  if (cached !== undefined) return cached
  let value: RegExp | null
  try {
    value = new RegExp(matcher)
  } catch {
    value = null
  }
  compiled.set(matcher, value)
  return value
}

/**
 * Whether one configured matcher fires for one tool name.
 * @param matcher - the configured pattern, if any.
 * @param toolName - the tool being dispatched; absent on events with no tool.
 * @returns true when the hook should run.
 */
export function matchesTool(matcher: string | undefined, toolName: string | undefined): boolean {
  if (isWildcard(matcher)) return true
  // An event with no tool name cannot be filtered by one. Firing anyway would
  // make `matcher: "bash"` on SessionStart run on every session start, which
  // reads as a bug in the hook rather than in the config.
  if (toolName === undefined) return false
  const expression = compile(matcher as string)
  if (expression === null) {
    if (!warned.has(matcher as string)) {
      warned.add(matcher as string)
      console.warn(
        `[dsh-hooks] matcher ${JSON.stringify(matcher)} is not a valid regular expression; it will never match`,
      )
    }
    return false
  }
  return expression.test(toolName)
}

/** Drop the compile and warn caches. Exists for tests and reconfiguration. */
export function resetMatcherCache(): void {
  compiled.clear()
  warned.clear()
}
