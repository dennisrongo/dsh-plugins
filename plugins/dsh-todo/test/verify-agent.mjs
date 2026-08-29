/**
 * OPT-IN: can a real model drive this CLI using nothing but its own help text?
 *
 * This is NOT part of `pnpm test` and never should be: it needs a network, a
 * model and credentials, and its result is non-deterministic. What it measures
 * is not whether the code works — the offline suites cover that — but whether
 * the AGENT-FACING SURFACE is self-serving: is `dsh-todo help` enough to
 * discover the commands, and is a refusal payload enough to recover from a bad
 * value unaided?
 *
 * It asserts on the DATABASE, never on what the model said. A model that
 * narrates success it did not achieve must fail this.
 *
 *   pnpm run test:agent
 *   DSH_AGENT_PROFILE=headless-plus DSH_AGENT_MODEL=deepseek/deepseek-chat pnpm run test:agent
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(root, 'lib/bin.js')
assert.ok(existsSync(BIN), 'lib/bin.js missing — run pnpm build')

const PROFILE = process.env.DSH_AGENT_PROFILE ?? 'headless'
const MODEL = process.env.DSH_AGENT_MODEL ?? ''
const TIMEOUT_MS = Number(process.env.DSH_AGENT_TIMEOUT_MS ?? 600000)

// Fail LOUD and early rather than reporting a model failure that is really a
// missing runner: the whole point of this probe is the model's behaviour.
const probe = spawnSync('dsh', ['--version'], { encoding: 'utf8', shell: true })
if (probe.status !== 0) {
  console.error('verify-agent: no `dsh` on PATH.')
  console.error('  This probe drives a REAL model and is opt-in; it is not part of pnpm test.')
  console.error('  Install the harness, then: pnpm run test:agent')
  process.exit(1)
}

/**
 * Never share a DSH_HOME with a harness that is already running.
 *
 * Sessions live at `$DSH_HOME/sessions/`, and two harnesses allocate session
 * numbers independently — they corrupt each other's open sessions silently,
 * across workspaces, surfacing only at a later restart. DSH Desktop sets
 * DSH_HOME to its own directory, so inheriting it here would run a second
 * harness against the home the Desktop is holding open. A throwaway home costs
 * nothing and removes the hazard entirely.
 */
const agentHome = process.env.DSH_AGENT_HOME ?? mkdtempSync(join(tmpdir(), 'todo-agent-home-'))
const ownsHome = !process.env.DSH_AGENT_HOME

const ws = mkdtempSync(join(tmpdir(), 'todo-agent-'))

/** Read the database back through the CLI — the model's work, as stored. */
function state() {
  const r = spawnSync(process.execPath, [BIN, 'list', '--json', '--workspace', ws], { encoding: 'utf8' })
  const active = JSON.parse(r.stdout)
  const b = spawnSync(process.execPath, [BIN, 'list', '--archived', '--json', '--workspace', ws], { encoding: 'utf8' })
  return { items: active.items ?? [], archived: JSON.parse(b.stdout).items ?? [] }
}

// The task deliberately withholds the flag names and the label rules. If the
// model needs them, it has to read `help` — which is exactly what is under test.
// It also plants a value the CLI MUST refuse (v2.0), so recovering from a
// refusal is part of the objective rather than an accident.
const TASK = [
  'You are managing a task list through a command line tool. Do not write any files yourself.',
  '',
  'The tool is run as:',
  '  node ' + JSON.stringify(BIN) + ' <command> [options] --workspace ' + JSON.stringify(ws),
  '',
  'Start by running it with the `help` command to learn the commands and options.',
  'Use --json so you can read the results reliably.',
  '',
  'Do all of the following:',
  '1. Add a task titled exactly "Ship the login fix" at the highest priority, for release v2.0.',
  '2. Add a second task titled exactly "Write release notes" in sprint 24.',
  '3. Mark the FIRST task done.',
  '',
  'If the tool refuses a value, read what it tells you and correct it yourself.',
  'When finished, state in one line what you stored.',
].join('\n')

const args = ['--profile', PROFILE]
if (MODEL) args.push('--model', MODEL)
args.push(TASK)

console.log('verify-agent: profile=' + PROFILE + (MODEL ? ' model=' + MODEL : '') + ' workspace=' + ws)
console.log('verify-agent: DSH_HOME=' + agentHome + (ownsHome ? ' (throwaway)' : ' (yours, via DSH_AGENT_HOME)'))
console.log('verify-agent: running the model (this costs tokens and may take minutes)…\n')

let failed = false
const check = (name, ok, detail) => {
  if (ok) console.log('  ok   ' + name)
  else { console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); failed = true }
}

try {
  const started = Date.now()
  const run = spawnSync('dsh', args, {
    encoding: 'utf8',
    shell: true,
    timeout: TIMEOUT_MS,
    env: { ...process.env, DSH_HOME: agentHome },
  })
  const secs = Math.round((Date.now() - started) / 1000)
  if (run.error) throw run.error

  const transcript = ((run.stdout || '') + (run.stderr || '')).trim()
  // Distinguish "the RUNNER failed" from "the model failed". Reporting a broken
  // runner as a model failure sends you reading a transcript that is not there —
  // which is exactly what an empty 4-second run looks like.
  if (run.status !== 0 || transcript === '') {
    console.error('verify-agent: the harness run failed before the model was reached.')
    console.error('  exit=' + run.status + ' after ' + secs + 's')
    if (transcript) console.error('  ' + transcript.split('\n').slice(0, 6).join('\n  '))
    if (/MISSING_CREDENTIAL|no API key/i.test(transcript)) {
      console.error('')
      console.error('  This probe runs in a THROWAWAY DSH_HOME, which has no stored credentials.')
      console.error('  That isolation is deliberate: two harnesses sharing one DSH_HOME allocate')
      console.error('  session numbers independently and corrupt each other silently.')
      console.error('  Supply a key one of two ways:')
      console.error('    $env:DEEPSEEK_API_KEY = "..."           # inherited by the throwaway home')
      console.error('    $env:DSH_AGENT_HOME   = "$HOME\\.dsh"    # reuse a home that HAS the key')
      console.error('                                            # (only with no harness running)')
    }
    process.exitCode = 1
    process.exit()
  }

  console.log('--- model transcript (tail) ---')
  console.log(transcript.split('\n').slice(-12).join('\n'))
  console.log('--- end (' + secs + 's) ---\n')

  const { items, archived } = state()
  const all = [...items, ...archived]
  const ship = all.find((i) => /ship the login fix/i.test(i.title))
  const notes = all.find((i) => /write release notes/i.test(i.title))

  // 1. It found the commands at all.
  check('the model created both tasks', Boolean(ship && notes),
    'found ' + all.length + ' task(s): ' + all.map((i) => i.title).join(' | '))

  // 2. It read the option names out of help rather than guessing.
  check('priority was set from help alone', ship?.priority === 'p0', 'priority=' + ship?.priority)
  check('sprint was set from help alone', notes?.sprint === '24', 'sprint=' + notes?.sprint)

  // 3. THE point of the probe: v2.0 is refused, and the refusal payload has to
  // be enough to self-correct. Storing 2.0 means it read and understood it.
  check('the model recovered from the refused release', ship?.release === '2.0',
    'release=' + JSON.stringify(ship?.release) + ' (expected "2.0" after v2.0 was refused)')

  // 4. A state transition, not just creation.
  check('the first task is done', ship?.status === 'done', 'status=' + ship?.status)

  // 5. Nothing invalid slipped into storage by any route.
  const bad = all.filter((i) => (i.release && !/^\\d+(\\.\\d+){0,2}$/.test(i.release)) ||
    (i.sprint && !/^\\d+(\\.\\d+)?$/.test(i.sprint)))
  check('no invalid label reached the database', bad.length === 0,
    bad.map((i) => i.title + ': release=' + i.release + ' sprint=' + i.sprint).join(' | '))

  console.log('')
  if (failed) {
    console.log('verify-agent: FAILED — the agent-facing surface did not carry the model through.')
    console.log('Read the transcript above: a failure here is usually a DOCUMENTATION bug')
    console.log('(help text or refusal message), not a code bug.')
  } else {
    console.log('verify-agent: OK — a model drove the CLI unaided, including the refusal.')
  }
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(ws, { recursive: true, force: true })
  if (ownsHome) rmSync(agentHome, { recursive: true, force: true })
}
