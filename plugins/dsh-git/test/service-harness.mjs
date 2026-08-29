/**
 * Shared rig for the service-level integration suites.
 *
 * Both `worktree-integration.mjs` and `branch-merge-stash.mjs` drive real
 * `GitService` methods against real repositories, which needs the same three
 * things every time: a repo with a commit, a cordis Context carrying a stub
 * `workspaceRegistry`, and a service pointed at it.
 *
 * The service imports the BUILT `lib/index.js`. That is not a shortcut — it is
 * required: `--experimental-strip-types` cannot parse the `@Remote` decorators,
 * so these files run under plain node, and this repo tests built output anyway.
 *
 * Nothing here needs the LLM or the API gateway, so both are provided as bare
 * service slots and never called.
 */
import './git-env.mjs'
import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../lib/index.js'

/** Every rig built this run, so one finally can clean them all up. */
const boxes = []

/**
 * Build a throwaway repository with one commit, plus a service bound to it.
 *
 * @param prefix - mkdtemp prefix, so a failure names the test that made it.
 * @returns the rig: paths, a raw git runner, the registry log, and the service.
 */
export function makeService(prefix) {
  const parent = mkdtempSync(join(tmpdir(), prefix))
  const repo = join(parent, 'proj')
  mkdirSync(repo)
  const g = (...a) =>
    execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-b', 'main')
  g('config', 'user.email', 'a@b.c')
  g('config', 'user.name', 'T')
  writeFileSync(join(repo, 'a.txt'), 'seed\n')
  g('add', '-A')
  g('commit', '-m', 'seed')
  const registered = []
  const ctx = new Context()
  ctx.provide('workspaceRegistry')
  ctx.provide('llm')
  ctx.provide('agentDefaultModel')
  ctx.workspaceRegistry = {
    list: () => [{ id: 'w1', path: repo }],
    create: async (path, title) => {
      registered.push({ path, title })
      return { id: 'new', path }
    },
  }
  const box = { parent, repo, g, registered, svc: new GitService(ctx) }
  boxes.push(box)
  return box
}

/** A repository with NO commits, for the unborn-branch paths. */
export function makeEmptyService(prefix) {
  const parent = mkdtempSync(join(tmpdir(), prefix))
  const repo = join(parent, 'proj')
  mkdirSync(repo)
  const g = (...a) =>
    execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-b', 'main')
  g('config', 'user.email', 'a@b.c')
  g('config', 'user.name', 'T')
  const ctx = new Context()
  ctx.provide('workspaceRegistry')
  ctx.provide('llm')
  ctx.provide('agentDefaultModel')
  ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: repo }] }
  const box = { parent, repo, g, registered: [], svc: new GitService(ctx) }
  boxes.push(box)
  return box
}

/** The workspace every rig registers. */
export const WS = { workspaceId: 'w1' }

/** Current branch name of a rig. */
export const head = (g) => g('rev-parse', '--abbrev-ref', 'HEAD').trim()

/** Local branch names, sorted, for stable assertions. */
export const branches = (g) =>
  g('branch', '--format=%(refname:short)').split('\n').map((s) => s.trim()).filter(Boolean).sort()

/** Remove every temp directory this run created. */
export function cleanup() {
  for (const b of boxes) {
    try { rmSync(b.parent, { recursive: true, force: true }) } catch {}
  }
}

/** Run one named check, awaiting the body so an async failure cannot pass. */
export function makeRunner() {
  const state = { passed: 0 }
  const test = async (name, fn) => {
    await fn()
    state.passed += 1
    console.log('  ok  ' + name)
  }
  return { test, state }
}
