/**
 * Smoke test for dsh-hooks, run against the BUILT `lib/`.
 *
 * The interesting half is not the unit assertions — it is `runHooks` driven
 * against real child processes through a stand-in subprocess seam. The exit-code
 * contract (0 allow / 2 block / other non-blocking), the stdin payload, the
 * timeout escalation and the fail-open-vs-fail-closed split are the parts a
 * reader has to trust, and none of them are observable from types.
 *
 * The stand-in spawns with `node -e`, so every "shell command" in here is
 * JavaScript source and the test needs no bash, no pwsh, and no temp files.
 */
import { spawn } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import('../lib/index.js')
const {
  HOOK_EVENTS,
  matchesTool,
  isWildcard,
  parseHookOutput,
  hookEnv,
  coerceDocument,
  resolveHooks,
  defaultShell,
  runHooks,
  ProjectHooks,
  HooksService,
  HooksSettings,
  HintEngine,
  DEFAULT_MAX_HINTS,
  MAX_MAX_HINTS,
  MAX_REASON,
  RULE_IDS,
  emptyTurn,
  fingerprint,
  invokedSkillNames,
  observeToolCall,
  resetFingerprintCache,
} = lib
// The SHIPPED manifest — what the loader registers and the browser mounts.
const { TYPERT } = await import('../lib/typert.host.js')

let passed = 0
/**
 * Assert and count, so the tail of the run states how much actually ran.
 * @param {string} what - the behaviour being pinned.
 * @param {() => void | Promise<void>} body - the assertions.
 */
async function test(what, body) {
  await body()
  passed += 1
  console.log(`  ok  ${what}`)
}

// ── stand-in subprocess seam ───────────────────────────────────────────────

/**
 * Minimal `SubprocessRuntime.spawn` over node:child_process.
 *
 * Implements exactly the surface `runner.ts` uses: `{ data }` stdin, collected
 * stdout/stderr with offset reads, a `done` promise carrying exit facts, and
 * abort-driven termination.
 * @returns an object with a `spawn` method.
 */
function fakeSubprocess() {
  return {
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (c) => (out += c))
      child.stderr.on('data', (c) => (err += c))
      if (spec.stdio.stdin && typeof spec.stdio.stdin === 'object') {
        child.stdin.end(spec.stdio.stdin.data)
      } else {
        child.stdin.end()
      }
      const onAbort = () => child.kill('SIGKILL')
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      const done = new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (exitCode, signal) => {
          spec.signal?.removeEventListener('abort', onAbort)
          resolve({ exitCode, signal })
        })
      })
      return {
        pid: child.pid ?? -1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: out, nextOffset: out.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: err, nextOffset: err.length, lossy: false }) },
        },
        done,
        terminate: () => child.kill('SIGKILL'),
        waitForExit: async () => true,
      }
    },
  }
}

/** Runner deps that execute a hook's `command` string as JavaScript. */
const deps = { subprocess: fakeSubprocess(), shell: [process.execPath, '-e'] }

/**
 * Build one resolved hook around a JS source string.
 * @param {string} source - JavaScript run as the hook body.
 * @param {object} [extra] - overrides for the command entry.
 * @returns {object} a ResolvedHook.
 */
function hook(source, extra = {}) {
  return {
    event: 'PreToolUse',
    matcher: undefined,
    command: { type: 'command', command: source, timeout: 10, failClosed: false, ...extra },
    source: 'user',
    origin: '(test)',
  }
}

/** A PreToolUse payload for the `bash` tool. */
const payload = {
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: process.cwd(),
  tool_name: 'bash',
  tool_input: { command: 'ls' },
}

// ── shape ──────────────────────────────────────────────────────────────────

await test('exports the documented surface', () => {
  assert.equal(typeof HooksService, 'function')
  assert.equal(HooksService.name, 'HooksService')
  // `inject` is what makes the fiber wait for the tool registry and the
  // subprocess seam; losing it turns every listener into a silent no-op.
  assert.deepEqual(HooksService.inject, ['tools', 'subprocess'])
  assert.equal(HOOK_EVENTS.length, 8)
  assert.ok(HOOK_EVENTS.includes('PreToolUse') && HOOK_EVENTS.includes('SubagentStop'))
})

await test('platform default shell is a real argv prefix', () => {
  const shell = defaultShell()
  assert.ok(Array.isArray(shell) && shell.length >= 2)
  assert.equal(shell[0], process.platform === 'win32' ? 'pwsh' : 'bash')
})

// ── matcher ────────────────────────────────────────────────────────────────

await test('matcher treats absent, empty and * as everything', () => {
  for (const m of [undefined, '', '   ', '*']) {
    assert.equal(isWildcard(m), true, `${JSON.stringify(m)} should be a wildcard`)
    assert.equal(matchesTool(m, 'anything'), true)
  }
})

await test('matcher is a regex, with alternation', () => {
  assert.equal(matchesTool('bash|str_replace_editor', 'bash'), true)
  assert.equal(matchesTool('bash|str_replace_editor', 'str_replace_editor'), true)
  assert.equal(matchesTool('bash|str_replace_editor', 'read_file'), false)
})

await test('an invalid matcher matches nothing rather than everything', () => {
  // The failure that matters: one typo must not fire a hook on every call.
  assert.equal(matchesTool('*bash', 'bash'), false)
})

await test('a tool matcher does not fire on an event with no tool', () => {
  assert.equal(matchesTool('bash', undefined), false)
  assert.equal(matchesTool(undefined, undefined), true)
})

// ── config ─────────────────────────────────────────────────────────────────

await test('coerceDocument drops unknown events and unusable entries', () => {
  const { config, dropped } = coerceDocument({
    PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
    PreToolUSe: [{ hooks: [{ type: 'command', command: 'typo' }] }],
    PostToolUse: [{ hooks: [{ type: 'command' }, { command: '' }, { type: 'other', command: 'x' }] }],
  })
  assert.equal(config.PreToolUse?.length, 1)
  assert.equal(config.PreToolUse[0].hooks[0].timeout, 60, 'default timeout applies')
  assert.equal(config.PostToolUse, undefined, 'a group with no usable command is not kept')
  assert.equal(dropped, 4)
})

await test('resolveHooks concatenates both layers rather than overriding', () => {
  const user = { PreToolUse: [{ hooks: [{ type: 'command', command: 'u' }] }] }
  const project = { PreToolUse: [{ hooks: [{ type: 'command', command: 'p' }] }] }
  const resolved = resolveHooks('PreToolUse', user, project, '/settings.yaml', '/w/.dsh/hooks.json')
  assert.equal(resolved.length, 2)
  assert.deepEqual(
    resolved.map((r) => [r.source, r.command.command]),
    [
      ['user', 'u'],
      ['project', 'p'],
    ],
  )
})

await test('a project document cannot disable a user hook by declaring nothing', () => {
  const user = { PreToolUse: [{ hooks: [{ type: 'command', command: 'guard' }] }] }
  const resolved = resolveHooks('PreToolUse', user, { PreToolUse: [] }, '/s', '/p')
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].source, 'user')
})

// ── output parsing ─────────────────────────────────────────────────────────

await test('parseHookOutput accepts objects and ignores everything else', () => {
  assert.deepEqual(parseHookOutput('{"decision":"block"}'), { decision: 'block' })
  assert.equal(parseHookOutput(''), undefined)
  assert.equal(parseHookOutput('just some log output'), undefined)
  assert.equal(parseHookOutput('[1,2]'), undefined, 'an array says nothing in this grammar')
  assert.equal(parseHookOutput('{ broken'), undefined)
})

await test('hookEnv supplies the DSH_* names the seam would otherwise scrub', () => {
  const env = hookEnv({ hook_event_name: 'PreToolUse', session_id: 'sid', cwd: '/w' }, '/w')
  assert.equal(env.DSH_PROJECT_DIR, '/w')
  assert.equal(env.DSH_SESSION_ID, 'sid')
  assert.equal(env.DSH_HOOK_EVENT, 'PreToolUse')
  assert.equal(env.CLAUDE_PROJECT_DIR, '/w', 'parity alias for ported hook scripts')
})

// ── the exit-code contract, against real processes ─────────────────────────

await test('exit 0 with no output allows the call', async () => {
  const verdict = await runHooks(deps, [hook('process.exit(0)')], payload, process.cwd())
  assert.equal(verdict.denied, undefined)
  assert.equal(verdict.asked, undefined)
  assert.equal(verdict.runs.length, 1)
  assert.equal(verdict.runs[0].exitCode, 0)
})

await test('exit 2 blocks, and stderr becomes the reason', async () => {
  const verdict = await runHooks(
    deps,
    [hook('process.stderr.write("no writes to /etc"); process.exit(2)')],
    payload,
    process.cwd(),
  )
  assert.equal(verdict.denied?.reason, 'no writes to /etc')
})

await test('permissionDecision deny blocks with its own reason', async () => {
  const source =
    'console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:"policy 4.2"}}))'
  const verdict = await runHooks(deps, [hook(source)], payload, process.cwd())
  assert.equal(verdict.denied?.reason, 'policy 4.2')
})

await test('permissionDecision ask escalates without denying', async () => {
  const source = 'console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:"ask",permissionDecisionReason:"confirm?"}}))'
  const verdict = await runHooks(deps, [hook(source)], payload, process.cwd())
  assert.equal(verdict.denied, undefined)
  assert.equal(verdict.asked?.reason, 'confirm?')
})

await test('a denial from any hook wins over an allow from another', async () => {
  const allow = hook('process.exit(0)')
  const deny = hook('process.stderr.write("nope"); process.exit(2)')
  // Both orders, because concurrent completion order must not decide this.
  for (const hooks of [[allow, deny], [deny, allow]]) {
    const verdict = await runHooks(deps, hooks, payload, process.cwd())
    assert.equal(verdict.denied?.reason, 'nope')
  }
})

await test('the payload really arrives on stdin', async () => {
  const source =
    'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d);' +
    'console.log(JSON.stringify({hookSpecificOutput:{additionalContext:"saw:"+p.tool_name+":"+p.hook_event_name}}))})'
  const verdict = await runHooks(deps, [hook(source)], payload, process.cwd())
  assert.deepEqual(verdict.additionalContext, ['saw:bash:PreToolUse'])
})

await test('a crashing hook is fail-open by default', async () => {
  const verdict = await runHooks(
    deps,
    [hook('process.stderr.write("boom"); process.exit(1)')],
    payload,
    process.cwd(),
  )
  assert.equal(verdict.denied, undefined, 'a broken hook must not brick every tool call')
  assert.equal(verdict.runs[0].exitCode, 1)
})

await test('failClosed turns the same crash into a denial', async () => {
  const verdict = await runHooks(
    deps,
    [hook('process.stderr.write("boom"); process.exit(1)', { failClosed: true })],
    payload,
    process.cwd(),
  )
  assert.equal(verdict.denied?.reason, 'boom')
})

await test('a hook that overruns its budget is terminated and marked timedOut', async () => {
  const started = Date.now()
  const verdict = await runHooks(
    deps,
    [hook('setTimeout(()=>{}, 60000)', { timeout: 0.4 })],
    payload,
    process.cwd(),
  )
  assert.equal(verdict.runs[0].timedOut, true)
  assert.ok(Date.now() - started < 10_000, 'the deadline is owned by the runner, not the hook')
  assert.equal(verdict.denied, undefined, 'a timeout is fail-open like any other failure')
})

await test('a timed-out failClosed hook denies', async () => {
  const verdict = await runHooks(
    deps,
    [hook('setTimeout(()=>{}, 60000)', { timeout: 0.4, failClosed: true })],
    payload,
    process.cwd(),
  )
  assert.match(verdict.denied?.reason ?? '', /timed out/)
})

await test('the matcher gates which hooks run at all', async () => {
  const verdict = await runHooks(
    deps,
    [
      { ...hook('process.stderr.write("only for bash"); process.exit(2)'), matcher: 'bash' },
      { ...hook('process.exit(0)'), matcher: 'read_file' },
    ],
    payload,
    process.cwd(),
  )
  assert.equal(verdict.runs.length, 1, 'the non-matching hook never spawned')
  assert.equal(verdict.denied?.reason, 'only for bash')
})

await test('no matching hooks means no processes and an empty verdict', async () => {
  const verdict = await runHooks(
    deps,
    [{ ...hook('process.exit(2)'), matcher: 'nothing_named_this' }],
    payload,
    process.cwd(),
  )
  assert.deepEqual(verdict.runs, [])
  assert.equal(verdict.denied, undefined)
})

// ── project layer on disk ──────────────────────────────────────────────────

await test('an absent project document is not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-'))
  try {
    const read = new ProjectHooks().read(dir)
    assert.deepEqual(read.config, {})
    assert.equal(read.path, join(dir, '.dsh', 'hooks.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('a project document is read, then re-read after it changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-'))
  const path = join(dir, '.dsh', 'hooks.json')
  try {
    mkdirSync(join(dir, '.dsh'), { recursive: true })
    const write = (command) =>
      writeFileSync(path, JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command', command }] }] }))

    const project = new ProjectHooks()
    write('first')
    assert.equal(project.read(dir).config.PreToolUse[0].hooks[0].command, 'first')
    // A second read of an unchanged file must come back identical — this is the
    // mtime+size cache, which is what makes a per-dispatch read affordable.
    assert.equal(project.read(dir).config.PreToolUse[0].hooks[0].command, 'first')

    // The cache is keyed on mtimeMs:size, so an edit of the SAME length inside
    // the same millisecond is the one thing that could stick. Change the length.
    write('second-and-longer')
    assert.equal(
      project.read(dir).config.PreToolUse[0].hooks[0].command,
      'second-and-longer',
      'an edited document takes effect without a restart',
    )

    // Deleting the file must drop the cached parse, or a removed hook keeps firing.
    rmSync(path)
    assert.deepEqual(project.read(dir).config, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('an unparseable project document is ignored, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-'))
  try {
    mkdirSync(join(dir, '.dsh'), { recursive: true })
    writeFileSync(join(dir, '.dsh', 'hooks.json'), '{ not json')
    assert.deepEqual(new ProjectHooks().read(dir).config, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── the wire contract ──────────────────────────────────────────────────────

/**
 * Method names the client's `RemoteNamespaceService` already owns.
 *
 * `assertMethodAvailable` refuses any descriptor whose method collides with a
 * field or a prototype member of that class, and the refusal happens inside
 * `$mount` — which is a THROW, not a warning. It takes down the whole mount, so
 * the namespace never appears, the `inject(['remote.dshHooks', ...])` fiber
 * never runs, and the hint strip silently fails to exist. `remove` shipped once
 * in dsh-plan-board and cost exactly that.
 */
const RESERVED_METHODS = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'constructor', 'has', 'install', 'installDirect', 'installScoped', 'remove',
])

await test('no descriptor collides with the client namespace service', () => {
  for (const d of TYPERT.invocations) {
    assert.equal(
      RESERVED_METHODS.has(d.method),
      false,
      `method "${d.method}" is reserved by RemoteNamespaceService — $mount would throw and the strip would vanish`,
    )
  }
})

await test('the manifest and the wire agree on every method', () => {
  const wire = TYPERT.invocations.map((d) => d.method).sort()
  const manifest = TYPERT.model.services[0].members.map((m) => m.name).sort()
  assert.deepEqual(manifest, wire, 'the ./typert manifest drifted from the mounted descriptors')
  assert.deepEqual(wire, ['describe', 'dismissHint', 'hints', 'hintsToken', 'recent'])
})

await test('every descriptor takes the single `request` parameter the host declares', () => {
  for (const d of TYPERT.invocations) {
    assert.deepEqual(
      d.parameters.map((p) => [p.name, p.wire]),
      [['request', 'request']],
      `${d.method} must take one parameter named request — the gateway reads the name off the source`,
    )
  }
})

// ── the hint engine ────────────────────────────────────────────────────────

/**
 * Build a catalog entry.
 * @param {string} name - skill name.
 * @param {string} [description] - routing description.
 * @param {boolean} [userInvocable] - whether a human may invoke it.
 * @returns {object} a SkillSummary-shaped entry.
 */
function skill(name, description = '', userInvocable = true) {
  return { name, description, invocation: { modelInvocable: true, userInvocable } }
}

/**
 * Build a situation, defaulting every field.
 * @param {object} [over] - fields to override.
 * @returns {object} a SessionSituation.
 */
function situation(over = {}) {
  return {
    cwd: process.cwd(),
    projectTypes: new Set(),
    skillsUsed: new Set(),
    editedPaths: new Set(),
    lastTurn: emptyTurn(),
    lastPrompt: '',
    prompts: 0,
    status: 'idle',
    dismissed: new Set(),
    ...over,
  }
}

/** A catalog broad enough to resolve every rule in the table. */
const CATALOG = [
  skill('dotnet-onion-api', 'Scaffold a .NET onion-architecture API.'),
  skill('nextjs-app-router', 'Next.js App Router conventions.'),
  skill('tauri-2-app', 'Scaffold a Tauri 2 desktop app.'),
  skill('remotion-best-practices', 'Router for all Remotion skills.'),
  skill('shadcn-ui', 'shadcn/ui components.'),
  skill('code-review', 'Use this skill whenever the user says "review my code" or "review the diff".'),
  skill('write-tests', 'Write tests for the change.'),
  skill('diagnose', 'Disciplined diagnosis loop for hard bugs.'),
  skill('writing-plans', 'Write an implementation plan.'),
  skill('conventional-commits', 'Write a Conventional Commits message.'),
  skill('create-pr', 'End-to-end pull-request flow.'),
  skill('handoff', 'Capture a session hand-off.'),
]

/** A source path, so the turn rules' `hasSourceEdits` guard is satisfied. */
const SOURCE_EDITS = new Set(['/repo/src/index.ts'])

await test('fingerprint finds a .csproj at the top level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-'))
  try {
    writeFileSync(join(dir, 'Foo.csproj'), '<Project />')
    resetFingerprintCache()
    assert.equal(fingerprint(dir).has('dotnet'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('fingerprint finds a .csproj one level down', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-'))
  try {
    // The case that matters: a monorepo's project file is never at the root,
    // so a top-level-only scan finds nothing exactly where it would help most.
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'Web.csproj'), '<Project />')
    resetFingerprintCache()
    assert.equal(fingerprint(dir).has('dotnet'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('fingerprint ignores node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-'))
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'Stray.csproj'), '<Project />')
    resetFingerprintCache()
    assert.equal(fingerprint(dir).has('dotnet'), false, 'a dependency is not this project')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('fingerprint reads package.json dependencies, not just file names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15', remotion: '4' } }))
    resetFingerprintCache()
    const types = fingerprint(dir)
    assert.equal(types.has('nextjs'), true)
    assert.equal(types.has('remotion'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('fingerprint requires shadcn components.json to name the shadcn schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-'))
  try {
    // `components.json` is a generic name; without the schema check any project
    // that happens to have one would be labelled shadcn.
    writeFileSync(join(dir, 'components.json'), JSON.stringify({ $schema: 'https://example.com/x.json' }))
    resetFingerprintCache()
    assert.equal(fingerprint(dir).has('shadcn'), false)
    writeFileSync(join(dir, 'components.json'), JSON.stringify({ $schema: 'https://ui.shadcn.com/schema.json' }))
    resetFingerprintCache()
    assert.equal(fingerprint(dir).has('shadcn'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('fingerprint of an unreadable directory is empty, not a throw', () => {
  resetFingerprintCache()
  assert.deepEqual([...fingerprint(join(tmpdir(), 'dsh-hints-does-not-exist'))], [])
})

await test('a project hint names an installed skill and nothing else', () => {
  const engine = new HintEngine()
  const s = situation({ projectTypes: new Set(['dotnet']) })
  const hit = engine.compute(s, CATALOG)
  assert.equal(hit.length, 1)
  assert.equal(hit[0].skill, 'dotnet-onion-api')
  assert.equal(hit[0].rule, 'project:dotnet')
  // The whole point: no installed match means no chip, rather than a chip the
  // user cannot type.
  assert.deepEqual(engine.compute(s, [skill('write-tests')]), [])
})

await test('a model-only skill is never offered', () => {
  const engine = new HintEngine()
  const s = situation({ projectTypes: new Set(['dotnet']) })
  assert.deepEqual(engine.compute(s, [skill('dotnet-onion-api', '', false)]), [])
})

await test('a skill already used this session is not suggested again', () => {
  const engine = new HintEngine()
  const s = situation({ projectTypes: new Set(['dotnet']), skillsUsed: new Set(['dotnet-onion-api']) })
  assert.deepEqual(engine.compute(s, CATALOG), [])
})

await test('a dismissed hint id stays dismissed across a recompute', () => {
  const engine = new HintEngine()
  const base = { projectTypes: new Set(['dotnet']) }
  const first = engine.compute(situation(base), CATALOG)
  assert.equal(first.length, 1)
  const again = engine.compute(situation({ ...base, dismissed: new Set([first[0].id]) }), CATALOG)
  assert.deepEqual(again, [], 'the id is `rule:skill`, so it survives recompute')
})

await test('turn:feature-done fires at three clean edits and not at two', () => {
  const engine = new HintEngine()
  const turn = (edits) => ({ ...emptyTurn(), edits })
  const at3 = engine.compute(situation({ lastTurn: turn(3), editedPaths: SOURCE_EDITS }), CATALOG)
  assert.ok(
    at3.some((h) => h.rule === 'turn:feature-done' && h.skill === 'code-review'),
    'three edits is a unit of work',
  )
  const at2 = engine.compute(situation({ lastTurn: turn(2), editedPaths: SOURCE_EDITS }), CATALOG)
  assert.equal(at2.some((h) => h.rule === 'turn:feature-done'), false)
})

await test('a turn rule does not fire while the turn is still running', () => {
  const engine = new HintEngine()
  const s = situation({ lastTurn: { ...emptyTurn(), edits: 5 }, editedPaths: SOURCE_EDITS, status: 'running' })
  assert.equal(engine.compute(s, CATALOG).some((h) => h.rule.startsWith('turn:')), false)
})

await test('a turn that only edited markdown gets no review or test hint', () => {
  const engine = new HintEngine()
  // The rules exist to say "you changed behaviour"; prose is not behaviour.
  const s = situation({ lastTurn: { ...emptyTurn(), edits: 4 }, editedPaths: new Set(['/repo/README.md']) })
  assert.equal(engine.compute(s, CATALOG).some((h) => h.rule.startsWith('turn:')), false)
})

await test('turn:tests-missing is silenced by a test run in the same turn', () => {
  const engine = new HintEngine()
  const withTests = situation({
    lastTurn: { ...emptyTurn(), edits: 4, ranTests: true },
    editedPaths: SOURCE_EDITS,
  })
  assert.equal(engine.compute(withTests, CATALOG).some((h) => h.rule === 'turn:tests-missing'), false)
})

await test('nothing is suggested while a turn is running', () => {
  const engine = new HintEngine()
  const s = situation({ projectTypes: new Set(['dotnet']), lastPrompt: 'review my code', status: 'running' })
  assert.deepEqual(engine.compute(s, CATALOG), [], 'a chip mid-turn is a control the user cannot act on')
})

await test('project chips show only before the first prompt', () => {
  const engine = new HintEngine()
  const fresh = engine.compute(situation({ projectTypes: new Set(['dotnet']), prompts: 0 }), CATALOG)
  assert.ok(fresh.some((h) => h.rule === 'project:dotnet'))
  const started = engine.compute(situation({ projectTypes: new Set(['dotnet']), prompts: 1 }), CATALOG)
  assert.equal(started.some((h) => h.rule === 'project:dotnet'), false, 'work has started; the moment has passed')
})

await test('every chip carries an intent, and prompt rules echo the prompt', () => {
  const engine = new HintEngine()
  const hits = engine.compute(situation({ lastPrompt: 'Can you review my code before I push?' }), CATALOG)
  assert.ok(hits.length > 0)
  for (const h of hits) assert.ok(h.intent.length > 0, `${h.id} has an intent`)
  const phrase = hits.find((h) => h.rule === 'prompt:phrase')
  assert.equal(phrase.intent, 'Can you review my code before I push?')
})

await test('turn intents name the files the turn touched', () => {
  const engine = new HintEngine()
  const s = situation({
    lastTurn: { ...emptyTurn(), edits: 3, paths: ['C:\\repo\\src\\Greeter.cs', '/repo/src/Calc.cs'] },
    editedPaths: SOURCE_EDITS,
  })
  const review = engine.compute(s, CATALOG).find((h) => h.skill === 'code-review')
  assert.equal(review.intent, 'review the changes from the last turn: Greeter.cs, Calc.cs')
  const tests = engine.compute(s, CATALOG).find((h) => h.rule === 'turn:feature-done' && /test/.test(h.skill))
  assert.equal(tests.intent, 'add tests for the changes from the last turn: Greeter.cs, Calc.cs')
})

await test('an intent is one line and capped', () => {
  const engine = new HintEngine()
  const long = 'review my code ' + 'x'.repeat(500) + '\n\nsecond paragraph'
  const hit = engine.compute(situation({ lastPrompt: long }), CATALOG).find((h) => h.rule === 'prompt:phrase')
  assert.ok(hit.intent.length <= 200)
  assert.equal(hit.intent.includes('\n'), false)
})

await test('observeToolCall remembers the edited paths for the intent, without duplicates', () => {
  const turn = emptyTurn()
  observeToolCall('write', { file_path: 'C:/p/A.cs' }, false, turn)
  observeToolCall('write', { file_path: 'C:/p/A.cs' }, false, turn)
  observeToolCall('str_replace_editor', { command: 'str_replace', path: 'C:/p/B.cs' }, false, turn)
  assert.deepEqual(turn.paths, ['C:/p/A.cs', 'C:/p/B.cs'])
  assert.equal(turn.edits, 3)
})

await test('turn:feature-done survives early tool errors when the last call succeeded', () => {
  // The live case: `dotnet --version` failed, web search failed, then three
  // writes and a green build. That turn produced a working MCP server and got
  // no review chip because every error counted. Only the LAST call decides.
  const engine = new HintEngine()
  const probesFailed = situation({
    lastTurn: { ...emptyTurn(), edits: 3, toolErrors: 2, lastToolErrored: false },
    editedPaths: SOURCE_EDITS,
  })
  assert.ok(engine.compute(probesFailed, CATALOG).some((h) => h.rule === 'turn:feature-done'))
  const endedRed = situation({
    lastTurn: { ...emptyTurn(), edits: 3, toolErrors: 1, lastToolErrored: true },
    editedPaths: SOURCE_EDITS,
  })
  assert.equal(engine.compute(endedRed, CATALOG).some((h) => h.rule === 'turn:feature-done'), false)
})

await test('observeToolCall tracks whether the LAST call errored, not just how many did', () => {
  const turn = emptyTurn()
  observeToolCall('pwsh', { command: 'dotnet --version' }, true, turn)
  assert.equal(turn.lastToolErrored, true)
  observeToolCall('write', { file_path: 'C:/p/Program.cs' }, false, turn)
  assert.equal(turn.lastToolErrored, false)
  assert.equal(turn.toolErrors, 1)
  assert.equal(turn.edits, 1)
})

await test('observeToolCall reads arguments handed over as a JSON string', () => {
  // The session log stores `arguments` as a string; a host that passed it
  // through unparsed must not silently stop counting edited paths.
  const turn = emptyTurn()
  const path = observeToolCall('write', '{"file_path":"C:/p/Program.cs","content":"x"}', false, turn)
  assert.equal(path, 'C:/p/Program.cs')
  assert.equal(observeToolCall('write', 'not json', false, emptyTurn()), undefined)
})

await test('fingerprint(cwd, true) sees a project scaffolded into a subdirectory mid-session', () => {
  resetFingerprintCache()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hints-scaffold-'))
  try {
    assert.equal(fingerprint(dir).has('dotnet'), false, 'empty at session start')
    // A `dotnet new` lands the project one level down. Writing INTO that
    // subdirectory changes no mtime the top level owns, so the cached answer
    // would stand for the whole TTL.
    mkdirSync(join(dir, 'hello'))
    writeFileSync(join(dir, 'hello', 'Hello.csproj'), '<Project />')
    assert.equal(fingerprint(dir, true).has('dotnet'), true, 'forced read finds it')
    assert.equal(fingerprint(dir).has('dotnet'), true, 'and the cache now carries it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('a phrase quoted in a skill description matches the prompt', () => {
  const engine = new HintEngine()
  const s = situation({ lastPrompt: 'Can you review my code before I push?' })
  const hit = engine.compute(s, CATALOG)
  assert.ok(hit.some((h) => h.rule === 'prompt:phrase' && h.skill === 'code-review'))
})

await test('prompt:bug stands down when a skill phrase already matched', () => {
  const engine = new HintEngine()
  const catalog = [skill('diagnose', 'Diagnosis loop.'), skill('my-fixer', 'Use when the user says "it is broken".')]
  const hit = engine.compute(situation({ lastPrompt: 'it is broken again' }), catalog)
  assert.ok(hit.some((h) => h.rule === 'prompt:phrase' && h.skill === 'my-fixer'))
  assert.equal(hit.some((h) => h.rule === 'prompt:bug'), false, 'one intent, one chip')
})

await test('prompt:bug fires when nothing advertised a phrase', () => {
  const engine = new HintEngine()
  const hit = engine.compute(situation({ lastPrompt: 'the build keeps failing' }), [skill('diagnose', 'Loop.')])
  assert.deepEqual(hit.map((h) => [h.rule, h.skill]), [['prompt:bug', 'diagnose']])
})

await test('the cap is honoured and the order is priority then id', () => {
  const s = situation({
    projectTypes: new Set(['dotnet', 'nextjs', 'tauri']),
    lastTurn: { ...emptyTurn(), edits: 4, committed: true },
    editedPaths: SOURCE_EDITS,
    prompts: 40,
  })
  // Five rules fire here (project rules stand down once work has started).
  // The cap is what keeps the row one line.
  assert.equal(new HintEngine({ maxHints: 2 }).compute(s, CATALOG).length, 2)

  const hit = new HintEngine({ maxHints: 3 }).compute(s, CATALOG)
  // turn:feature-done (5) contributes TWO chips — its rule offers a review line
  // and a test line — and both outrank turn:ready-to-ship (6), which in turn
  // outranks every project rule (20) and session:long (30). A chip about what
  // just happened beats a standing fact about the workspace.
  assert.deepEqual(hit.map((h) => h.rule), ['turn:feature-done', 'turn:feature-done', 'turn:ready-to-ship'])
  assert.deepEqual(hit.map((h) => h.priority), [5, 5, 6])
  // Equal priorities tie-break on the id, so the order is stable rather than
  // whatever the pattern list happened to be written in.
  assert.deepEqual(hit.slice(0, 2).map((h) => h.skill), ['code-review', 'write-tests'])
})

await test('compute is deterministic for one situation', () => {
  const engine = new HintEngine()
  const build = () =>
    situation({
      projectTypes: new Set(['dotnet', 'nextjs']),
      lastTurn: { ...emptyTurn(), edits: 3 },
      editedPaths: SOURCE_EDITS,
      lastPrompt: 'review my code',
      prompts: 30,
    })
  const a = engine.compute(build(), CATALOG).map((h) => h.id)
  const b = engine.compute(build(), CATALOG).map((h) => h.id)
  assert.deepEqual(a, b)
})

await test('one skill is never offered twice, and the sharper rule wins', () => {
  const engine = new HintEngine({ maxHints: 6 })
  // Both turn:feature-done (5) and turn:tests-missing (8) resolve write-tests.
  const s = situation({ lastTurn: { ...emptyTurn(), edits: 4 }, editedPaths: SOURCE_EDITS })
  const hit = engine.compute(s, CATALOG)
  const forWriteTests = hit.filter((h) => h.skill === 'write-tests')
  assert.equal(forWriteTests.length, 1)
  assert.equal(forWriteTests[0].rule, 'turn:feature-done')
})

await test('disableRules silences one rule and leaves the rest', () => {
  const engine = new HintEngine({ disableRules: ['session:long'] })
  const s = situation({ prompts: 40, lastPrompt: 'please review my code' })
  const hit = engine.compute(s, CATALOG)
  assert.equal(hit.some((h) => h.rule === 'session:long'), false)
  assert.ok(hit.some((h) => h.rule === 'prompt:phrase'))
})

await test('maxHints is clamped into 1..MAX_MAX_HINTS', () => {
  const s = situation({ projectTypes: new Set(['dotnet', 'nextjs', 'tauri', 'shadcn']), prompts: 40 })
  assert.equal(new HintEngine({ maxHints: 0 }).compute(s, CATALOG).length, 1)
  assert.ok(new HintEngine({ maxHints: 99 }).compute(s, CATALOG).length <= MAX_MAX_HINTS)
})

await test('every reason fits the strip and every id is rule:skill', () => {
  const engine = new HintEngine({ maxHints: 6 })
  const s = situation({
    projectTypes: new Set(['dotnet']),
    lastPrompt: `please ${'x'.repeat(400)} review my code`,
    lastTurn: { ...emptyTurn(), edits: 4, committed: true },
    editedPaths: SOURCE_EDITS,
  })
  const hints = engine.compute(s, CATALOG)
  assert.ok(hints.length > 0)
  for (const hint of hints) {
    assert.ok(hint.reason.length <= MAX_REASON, `"${hint.reason}" is ${hint.reason.length} chars`)
    assert.equal(hint.id, `${hint.rule}:${hint.skill}`)
  }
})

await test('every built-in rule id is namespaced and listed', () => {
  assert.ok(RULE_IDS.length >= 11)
  for (const id of RULE_IDS) assert.match(id, /^(project|prompt|turn|session):[a-z-]+$/)
})

// ── signal classification ──────────────────────────────────────────────────

await test('observeToolCall counts edits and reads BOTH path argument names', () => {
  const turn = emptyTurn()
  // Verified against the shipped tools: str_replace_editor takes `path`, while
  // dsh-tool-fs's read/write/edit take `file_path`. Guessing one silently
  // stops counting the other.
  assert.equal(observeToolCall('str_replace_editor', { command: 'create', path: '/a.ts' }, false, turn), '/a.ts')
  assert.equal(observeToolCall('edit', { file_path: '/b.ts' }, false, turn), '/b.ts')
  assert.equal(turn.edits, 2)
})

await test('a str_replace_editor view is not an edit', () => {
  const turn = emptyTurn()
  assert.equal(observeToolCall('str_replace_editor', { command: 'view', path: '/a.ts' }, false, turn), undefined)
  assert.equal(turn.edits, 0)
})

await test('a failed edit is an error, not an edit', () => {
  const turn = emptyTurn()
  observeToolCall('write', { file_path: '/a.ts' }, true, turn)
  assert.equal(turn.edits, 0)
  assert.equal(turn.toolErrors, 1)
})

await test('a test runner in a shell command sets ranTests', () => {
  for (const command of ['pnpm run test', 'dotnet test', 'cargo test', 'go test ./...', 'npx vitest run', 'pytest -q']) {
    const turn = emptyTurn()
    observeToolCall('bash', { command }, false, turn)
    assert.equal(turn.ranTests, true, command)
  }
})

await test('the word "test" inside a commit message is not a test run', () => {
  const turn = emptyTurn()
  observeToolCall('bash', { command: 'git commit -m "add a test"' }, false, turn)
  assert.equal(turn.ranTests, false, 'the runner list is a whitelist for exactly this reason')
  assert.equal(turn.committed, true)
})

await test('the skill tool marks the turn as already on a path', () => {
  const turn = emptyTurn()
  observeToolCall('skill', { name: 'code-review' }, false, turn)
  assert.equal(turn.usedSkill, true)
  assert.equal(turn.edits, 0)
})

await test("invokedSkillNames matches dsh-tool-skill's own gesture grammar", () => {
  assert.deepEqual(invokedSkillNames('/code-review please'), ['code-review'])
  assert.deepEqual(invokedSkillNames('run /write-tests and /code-review'), ['write-tests', 'code-review'])
  assert.deepEqual(invokedSkillNames('see src/a.ts'), [], 'a path is not an invocation')
  assert.deepEqual(invokedSkillNames('use /Code-Review'), [], 'the grammar is lowercase kebab-case')
})

// ── settings ───────────────────────────────────────────────────────────────

await test('the hints settings block has the documented defaults', () => {
  const value = new HooksSettings({})
  assert.equal(value.hints.enabled, true)
  assert.equal(value.hints.max, DEFAULT_MAX_HINTS)
  assert.deepEqual(value.hints.disableRules, [])
})

await test('an out-of-range hints.max is rejected by the schema', () => {
  assert.throws(() => new HooksSettings({ hints: { max: 99 } }))
})

console.log(`\n${passed} checks passed`)
