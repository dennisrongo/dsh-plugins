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
} = lib

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

console.log(`\n${passed} checks passed`)
