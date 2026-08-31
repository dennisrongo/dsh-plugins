/**
 * Mission Control — fleet dashboard for DeepSeek Harness.
 *
 * A pure-consumer client plugin registering into the additive `shell.overlay`
 * slot: live session fleet, subagent swarm tree, token burn, and a permission
 * inbox. Reads only public faces (ctx.sessions.list, per-session
 * sessionStats projections, pendingInteraction) — no services of its own.
 */
import React from 'react'
import { useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MC_REMOTE } from './remote.ts'

/**
 * Required services (cordis fiber inject — service access is granted per-fiber).
 *
 * `remote` is the Typert client bridge, used here only for `$mount`. It MUST be
 * listed: cordis THROWS on an undeclared service get rather than returning
 * undefined, so the defensive `!ctx.remote` guard in apply() is itself the throw
 * site when this is missing — which fails the whole loader entry and drops the
 * app into startup recovery.
 *
 * The mounted namespace `remote.dshMissionControl` is deliberately NOT listed:
 * this plugin mounts that contract itself, so requiring it up front would park
 * apply() forever waiting on a service only apply() can create.
 */
export const inject = ['slots', 'remote', 'sessions', 'workspaces', 'modelDirectories']

// The loader injects `require` into the factory; not declared in the DOM lib.
declare const require: unknown

/**
 * The host types session ids as a branded `SessionId` (a compile-time-only
 * brand — `SessionId(id)` is a cast with no runtime cost). This plugin models
 * ids as plain `string` throughout, per the structural-types-only rule, so
 * calls into `ctx.sessions.*` need that brand reapplied at the boundary.
 *
 * `asSessionId` is that single seam: an identity function at runtime, and the
 * one place the brand is asserted. Prefer it over scattered inline casts —
 * it keeps every host call site honest about crossing the boundary.
 */
type BrandedSessionId = Parameters<ClientContext['sessions']['open']>[0]
const asSessionId = (id: string): BrandedSessionId => id as BrandedSessionId

/**
 * Host shell primitives, resolved through the module loader's static table.
 * Optional by design: a host without the package degrades tiles to plain text
 * instead of failing plugin load.
 */
/**
 * Copy shown inside rendered markdown (code-block buttons, footnote headings,
 * truncation notices).
 *
 * `MarkdownText` gained a REQUIRED `labels` prop in harness 0.1.2 with **no
 * default**, and its code-block renderer reads `labels.code.copyLabel`
 * unguarded — so passing only `text`/`streaming`, as this plugin did, throws
 * `Cannot read properties of undefined (reading 'code')` and takes the whole
 * `shell.overlay` slot down with it: the panel disappears entirely rather than
 * degrading. Every key the markdown path touches is supplied here; the object
 * is module-level and frozen so its identity is stable, which matters because
 * `MarkdownText` rebuilds its streaming renderer whenever `labels` changes.
 */
const MARKDOWN_LABELS = Object.freeze({
  code: Object.freeze({ copyLabel: 'Copy', copiedLabel: 'Copied' }),
  markdown: 'Markdown',
  footnotes: 'Footnotes',
  contentTruncated: 'Content truncated',
  sourcesTruncated: 'Sources truncated',
})

type MarkdownTextProps = {
  text: string
  streaming?: boolean
  labels?: unknown
}

const MarkdownText: React.ComponentType<MarkdownTextProps> | undefined = (() => {
  try {
    if (typeof require !== 'function') return undefined
    const p = (require as (id: string) => {
      MarkdownText?: React.ComponentType<MarkdownTextProps>
    })('@deepseek-ai/dsh-client-ui-primitives')
    return p?.MarkdownText
  } catch {
    return undefined
  }
})()

// ---------------------------------------------------------------------------
// Snapshot plumbing — ObservableSnapshot<T> binds straight to uSES.
// ---------------------------------------------------------------------------

/** Bind any ObservableSnapshot<T> to React with per-render getSnapshot capture. */
export function useObservable<T>(observable: {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}): T {
  return useSyncExternalStore(
    observable.subscribe.bind(observable),
    () => observable.getSnapshot(),
  )
}

// ---------------------------------------------------------------------------
// Types (structural — no runtime dependency on the dsh packages)
// ---------------------------------------------------------------------------

interface PendingLike {
  kind: 'approval' | 'question'
  sessionId: string
  payload: { toolName?: string; summary?: string }
  respond(result: unknown): Promise<unknown>
}

interface SessionLike {
  id: string
  displayTitle: string
  cwd?: string
  agentPreset?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  /**
   * Host contract (dsh-client-runtime sessions/pending.d.ts):
   *   type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'
   * It is a BARE STRING on the session summary, not an object. Reading
   * `.kind` off it yields undefined, which silently drops every waiting
   * session to "running" in the fleet.
   */
  pendingInteraction?: 'approval' | 'plan-review' | 'question'
  completed?: boolean
  updatedAt: number
  blank?: boolean
}

/**
 * One row of a parent's durable direct-child catalog (structural mirror of the
 * host `SubagentListEntry`). Healthy rows are `kind: 'child'`; unreadable ones
 * arrive as `kind: 'diagnostic'` and are skipped by the fleet tree.
 */
interface SubagentEntryLike {
  kind: 'child' | 'diagnostic'
  id: string
  /** Child driver state at the host sampling boundary ('child' rows only). */
  activity?: 'running' | 'inactive'
  /** True when this child itself has durable subagent children — the recursion hint. */
  hasChildren?: boolean
  mode?: 'one-shot' | 'continuable'
  label?: string
  reason?: 'corrupt' | 'unsupported' | 'unavailable'
}

/**
 * A parent-addressed catalog snapshot. Catalogs are lazy: a parent absent from
 * `subagentsByParent`, or present with `state: 'loading'`, means "not yet
 * known" — never "no children".
 */
interface SubagentCatalogLike {
  state: string
  entries?: readonly SubagentEntryLike[]
  parentAvailable?: boolean
}

interface SessionListStateLike {
  ids: readonly string[]
  byId: Record<string, SessionLike>
  current: string | undefined
  /**
   * Durable direct-child catalogs keyed by parent session id. This — NOT
   * `ids`/`byId` — is the authority on subagents: `ids` carries root sessions
   * only, and `byId` gains a subagent row solely as a navigation side effect
   * (the one currently addressed child), so deriving children by filtering
   * `ids` on `parentId` can never see more than that single row.
   */
  subagentsByParent: Readonly<Record<string, SubagentCatalogLike>>
}

interface WorkspaceLike {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

interface WorkspaceListStateLike {
  items: readonly WorkspaceLike[]
  archivedSessionIds: readonly string[]
  recentWorkspaceId?: string
}

interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}

interface ModelDirectoryLike {
  store: {
    getSnapshot(): { current: ModelSelectionLike | null }
    subscribe(fn: () => void): () => void
  }
  load(): Promise<unknown>
}

interface ModelDirsLike {
  directoryFor(sessionId: string): ModelDirectoryLike
}

interface ProjectionStoreLike {
  getSnapshot(): unknown
  subscribe(fn: () => void): () => void
}

interface UseProjectionLike {
  (sessionId: string, key: string): ProjectionStoreLike
}

/**
 * The `sessionStats` projection fields this panel aggregates. Structural
 * mirror of the host shape (see AGENTS.md) — only the three counters
 * `totalBurn` sums are declared.
 */
export interface StatsLike {
  steps: number
  llmMs: number
  decodeTokens: number
}

interface TokenUsageLike {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Cache-tier multipliers applied to the base INPUT price.
 *
 * Providers do not bill every input token at the same rate. A cache READ is
 * roughly a tenth of a fresh input token; a cache WRITE carries a premium for
 * persisting the block. Billing every input token at the full rate — which is
 * what this panel used to do — inflates the estimate several-fold on long
 * agentic sessions, because cache reads dominate input there.
 */
export const CACHE_READ_MULTIPLIER = 0.1
export const CACHE_WRITE_MULTIPLIER = 1.25

/**
 * Rough per-model pricing (USD per 1M tokens, in/out). Estimates only — the
 * harness reports token counts, not spend. Cache tiers ARE discounted (see
 * `CACHE_READ_MULTIPLIER`), but list prices drift and per-account discounts
 * are invisible here; treat figures as directional.
 */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet': { in: 3, out: 15 },
  'claude-opus': { in: 15, out: 75 },
  'claude-haiku': { in: 0.8, out: 4 },
  'grok': { in: 3, out: 15 },
  'glm': { in: 0.6, out: 2.2 },
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  'kimi': { in: 0.6, out: 2.5 },
  'qwen': { in: 0.5, out: 2 },
}

/** Match a model id to its price row (prefix match, first hit wins). */
export function priceRowFor(model: string | undefined): { in: number; out: number } | undefined {
  if (!model) return undefined
  const m = model.toLowerCase()
  for (const key of Object.keys(MODEL_PRICES)) {
    if (m.includes(key)) return MODEL_PRICES[key]
  }
  return undefined
}

/** Estimated cost of one session's usage under a price row (USD). */
export function estimateCost(usage: TokenUsageLike | undefined, price: { in: number; out: number } | undefined): number {
  if (!usage || !price) return 0
  const input = usage.uncachedInputTokens + usage.cacheReadTokens
  return (input / 1e6) * price.in + (usage.outputTokens / 1e6) * price.out
}

/** Output-token rate between two samples (tok/s), floored at 0. */
export function computeRate(prevOut: number | undefined, nowOut: number, elapsedMs: number): number {
  if (prevOut === undefined || elapsedMs <= 0) return 0
  return Math.max(0, (nowOut - prevOut) / (elapsedMs / 1000))
}

/** Keys of waits not yet notified; records them into `seen`. Pure logic seam for the notify effect. */
export function newWaitKeys<T extends { key: string }>(waits: readonly T[], seen: Set<string>): string[] {
  const fresh: string[] = []
  for (const w of waits) {
    if (seen.has(w.key)) continue
    seen.add(w.key)
    fresh.push(w.key)
  }
  return fresh
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export interface FleetRow {
  id: string
  title: string
  running: boolean
  pending?: string
  completed?: boolean
  preset?: string
  cwd?: string
  updatedAt?: number
  /** Cumulative output tokens (row-retained projection) — drives live tok/s. */
  outTokens?: number
  /**
   * The session's current to-do list (row-retained `todos` projection). The
   * host rewrites the whole list on every `todo_write`, so this is the plan as
   * it stands now, not a diff — undefined when the session never wrote one.
   */
  todos?: readonly TodoItem[]
  /**
   * Workspace this session was grouped under (buildGroups only — buildFleet has
   * no workspace list to consult). Lets detached views like Stage name the
   * origin of a tile without re-deriving the grouping.
   */
  workspace?: string
  children: FleetRow[]
}

/** Latest output-token count retained on a session row (projection mirror). */
function sessionOutTokens(s: SessionLike): number | undefined {
  return (s as { projectionValues?: { tokenUsage?: { outputTokens?: number } } } | undefined)
    ?.projectionValues?.tokenUsage?.outputTokens
}

/**
 * One entry of the host's `todos` projection. Structural mirror of the shape
 * the stock TodoPanel renders — only the two fields this strip shows are
 * declared, so an added host field cannot break the read.
 */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * The to-do list retained on a session row (projection mirror).
 *
 * A todo list is NOT a chat node, so `extractTail` cannot see it: the host
 * emits it as a per-session `todos` projection (on `todo/write`) and renders it
 * in a dock beside the composer rather than inline in the transcript. Reading
 * the row projection is what lets a stage tile show the plan without opening
 * the conversation. The host writes `null` to clear, hence the array guard.
 */
function sessionTodos(s: SessionLike | undefined): readonly TodoItem[] | undefined {
  const raw = (s as { projectionValues?: { todos?: unknown } } | undefined)?.projectionValues?.todos
  if (!Array.isArray(raw)) return undefined
  const out: TodoItem[] = []
  for (const item of raw) {
    const content = (item as { content?: unknown })?.content
    const status = (item as { status?: unknown })?.status
    if (typeof content !== 'string' || content === '') continue
    out.push({
      content,
      status: status === 'completed' || status === 'in_progress' ? status : 'pending',
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Fallback label for a catalog child with no durable label (one-shot rows may
 * omit it) — a short id suffix keeps rows distinguishable in the tree.
 */
function subagentTitle(entry: SubagentEntryLike): string {
  return entry.label ?? `subagent ${entry.id.slice(-6)}`
}

/**
 * Project one catalog entry into a fleet row, recursing through the catalogs of
 * children that report `hasChildren`. `seen` breaks cycles and prevents a
 * shared id from being expanded twice in one walk.
 *
 * A catalog row carries only coarse metadata, so richer fields (pending state,
 * tokens, cwd) are read off the matching `byId` row when navigation happens to
 * have one; otherwise the catalog's own `activity` bit drives `running`.
 */
function catalogRow(
  list: SessionListStateLike,
  entry: SubagentEntryLike,
  seen: Set<string>,
): FleetRow | undefined {
  if (entry.kind !== 'child' || seen.has(entry.id)) return undefined
  seen.add(entry.id)
  const live = list.byId[entry.id]
  return {
    id: entry.id,
    title: live?.displayTitle ?? subagentTitle(entry),
    running: live?.running ?? entry.activity === 'running',
    pending: live?.pendingInteraction,
    completed: live?.completed,
    preset: live?.agentPreset,
    cwd: live?.cwd,
    updatedAt: live?.updatedAt,
    outTokens: live ? sessionOutTokens(live) : undefined,
    todos: live ? sessionTodos(live) : undefined,
    // Always recurse: `hasChildren` is a durable-persistence hint, so it can be
    // false for a child that has just spawned live grandchildren into `byId`.
    // catalogChildren is cheap when both sources are empty.
    children: catalogChildren(list, entry.id, seen),
  }
}

/**
 * Direct subagent rows for one parent, unioned from the two faces that each
 * see a partial picture:
 *
 * 1. `byId` rows whose `parentId` matches — the live spawn feed. The host
 *    merges a spawned child into the list summaries as it appears, so this is
 *    what populates during an active run, and it carries the rich fields
 *    (pending state, tokens, title).
 * 2. The parent's durable catalog in `subagentsByParent` — the complete
 *    persisted roster, including cold children from earlier runs that are not
 *    resident in `byId`.
 *
 * Neither alone is sufficient: the catalog is empty until something requests
 * it (and only covers persisted children), while `byId` misses cold ones.
 * Catalog order wins for rows present in both, since it is the durable
 * `createdAt` ordering; live-only rows are appended after.
 */
function catalogChildren(
  list: SessionListStateLike,
  parentId: string,
  seen: Set<string>,
): FleetRow[] {
  const rows: FleetRow[] = []
  const emitted = new Set<string>()
  for (const entry of list.subagentsByParent?.[parentId]?.entries ?? []) {
    const row = catalogRow(list, entry, seen)
    if (row) {
      rows.push(row)
      emitted.add(row.id)
    }
  }
  for (const id of Object.keys(list.byId)) {
    const s = list.byId[id]
    if (
      s === undefined ||
      s.origin !== 'subagent' ||
      s.parentId !== parentId ||
      emitted.has(s.id) ||
      seen.has(s.id)
    ) {
      continue
    }
    seen.add(s.id)
    rows.push({
      id: s.id,
      title: s.displayTitle,
      running: s.running,
      pending: s.pendingInteraction,
      completed: s.completed,
      preset: s.agentPreset,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      outTokens: sessionOutTokens(s),
      todos: sessionTodos(s),
      children: catalogChildren(list, s.id, seen),
    })
  }
  // Newest/most-active first — the catalog's own order is oldest-first, which
  // buries a freshly dispatched swarm under every agent that came before it.
  return orderSubagents(rows)
}

/**
 * Build the root session → subagent tree.
 *
 * Roots come from the flat session list; children come from
 * `subagentsByParent` (see {@link SessionListStateLike}), which is the only
 * face that enumerates a full swarm.
 */
export function buildFleet(list: SessionListStateLike): FleetRow[] {
  const roots = list.ids
    .map((id) => list.byId[id])
    .filter((s) => s !== undefined && s.origin !== 'subagent')
  const seen = new Set<string>()
  const toRow = (s: SessionLike): FleetRow => ({
    id: s.id,
    title: s.displayTitle,
    running: s.running,
    pending: s.pendingInteraction,
    completed: s.completed,
    preset: s.agentPreset,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    outTokens: sessionOutTokens(s),
    todos: sessionTodos(s),
    children: catalogChildren(list, s.id, seen),
  })
  return roots.map(toRow)
}

export interface WorkspaceGroup {
  key: string
  title: string
  rows: FleetRow[]
}

/**
 * How the Fleet list orders sessions inside each workspace group.
 *
 * - `recent` (default) — most recently active first. Attention rank still wins
 *   the first cut, so a pending prompt never sinks below an idle session.
 * - `oldest` — the same attention rank, then least recently active first.
 * - `name` — attention rank, then title, case-insensitively.
 * - `burn` — attention rank, then most output tokens first: "what is costing
 *   me the most right now".
 */
export type FleetSortOrder = 'recent' | 'oldest' | 'name' | 'burn'

/** Default Fleet ordering — most recently active at the top. */
export const DEFAULT_FLEET_SORT: FleetSortOrder = 'recent'

/** Selectable Fleet orderings, with the labels the settings UI shows. */
export const FLEET_SORT_CHOICES: readonly { value: FleetSortOrder; label: string }[] = [
  { value: 'recent', label: 'Most recently active' },
  { value: 'oldest', label: 'Least recently active' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'burn', label: 'Token burn' },
]

/**
 * Normalise an untrusted sort order (persisted prefs are user-editable) to a
 * known value, falling back to the default.
 */
export function normalizeFleetSort(value: unknown): FleetSortOrder {
  return FLEET_SORT_CHOICES.some((c) => c.value === value)
    ? (value as FleetSortOrder)
    : DEFAULT_FLEET_SORT
}

/**
 * Order the workspace groups themselves, so the workspace you are actually
 * working in floats to the top of the Fleet list.
 *
 * Without this the groups render in the host's `workspaces.items` order — a
 * static registry order, unrelated to activity — which buries a freshly active
 * workspace under every project ever opened. A group inherits the standing of
 * its best row: the strongest attention rank it contains, then its most recent
 * activity.
 *
 * "Ungrouped" is pinned last regardless. It is a catch-all bucket rather than a
 * real workspace, so letting it win the top slot would be noise.
 *
 * `name` sorts groups by title; every other order ranks groups by
 * attention-then-recency, because "least recently active" or "token burn" are
 * statements about sessions, and demoting the live workspace to the bottom of
 * the panel is never what the user meant.
 */
export function compareFleetGroups(
  a: WorkspaceGroup,
  b: WorkspaceGroup,
  order: FleetSortOrder = DEFAULT_FLEET_SORT,
): number {
  // The catch-all bucket always sinks.
  const loose = (g: WorkspaceGroup): number => (g.key === '__ungrouped__' ? 1 : 0)
  const byLoose = loose(a) - loose(b)
  if (byLoose !== 0) return byLoose
  if (order === 'name') {
    const byName = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (byName !== 0) return byName
  }
  // Rows are already sorted, so the head row carries the group's best standing.
  const rank = (g: WorkspaceGroup): number => {
    const r = g.rows[0]
    if (!r) return 4
    return r.pending ? 0 : r.running ? 1 : r.completed ? 2 : 3
  }
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  const latest = (g: WorkspaceGroup): number =>
    g.rows.reduce((max, r) => (r.updatedAt !== undefined && r.updatedAt > max ? r.updatedAt : max), 0)
  const byRecency = latest(b) - latest(a)
  if (byRecency !== 0) return byRecency
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
}

/**
 * Comparator for rows within one workspace group.
 *
 * Attention rank (pending → running → completed → idle) is applied FIRST for
 * every order, because the list's job is to surface what needs a human; the
 * chosen order only breaks ties within a rank. Ordering falls back to `recent`
 * so equal keys (same name, same burn) stay deterministic.
 */
export function compareFleetRows(
  a: FleetRow,
  b: FleetRow,
  order: FleetSortOrder = DEFAULT_FLEET_SORT,
): number {
  const rank = (r: FleetRow): number =>
    r.pending ? 0 : r.running ? 1 : r.completed ? 2 : 3
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  const recent = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  if (order === 'oldest') {
    const oldest = (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
    if (oldest !== 0) return oldest
  } else if (order === 'name') {
    const byName = (a.title ?? '').localeCompare(b.title ?? '', undefined, {
      sensitivity: 'base',
    })
    if (byName !== 0) return byName
  } else if (order === 'burn') {
    const byBurn = (b.outTokens ?? 0) - (a.outTokens ?? 0)
    if (byBurn !== 0) return byBurn
  }
  return recent
}

/**
 * Group visible root sessions under their workspaces (stock-sidebar parity):
 * - archived sessions hidden (registry-global archive set)
 * - blank rows hidden (New-Session placeholders, per the sidebar's own rule)
 * - sessions belong to the workspace whose sessionIds contains them; the rest
 *   fall into a collapsed "Ungrouped" bucket
 * - within a group: running/pending first, then `order` (default: most
 *   recently active first — see {@link compareFleetRows})
 * - the groups themselves are ordered the same way, so the active workspace
 *   floats to the top and "Ungrouped" sinks (see {@link compareFleetGroups})
 */
export function buildGroups(
  list: SessionListStateLike,
  workspaces: WorkspaceListStateLike | undefined,
  order: FleetSortOrder = DEFAULT_FLEET_SORT,
): WorkspaceGroup[] {
  const archived = new Set(workspaces?.archivedSessionIds ?? [])
  /** Cycle guard for the catalog walk (distinct from `grouped` below). */
  const walked = new Set<string>()
  const toRowLocal = (s: SessionLike): FleetRow => ({
    id: s.id,
    title: s.displayTitle,
    running: s.running,
    pending: s.pendingInteraction,
    completed: s.completed,
    preset: s.agentPreset,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    outTokens: sessionOutTokens(s),
    todos: sessionTodos(s),
    children: catalogChildren(list, s.id, walked),
  })
  const visibleRoots = list.ids
    .map((id) => list.byId[id])
    .filter(
      (s) =>
        s !== undefined &&
        s.origin !== 'subagent' &&
        !s.blank &&
        !archived.has(s.id),
    )
  const rowsBySession = new Map<string, FleetRow>()
  for (const row of visibleRoots) rowsBySession.set(row!.id, toRowLocal(row!))
  const sortRows = (rows: FleetRow[]): FleetRow[] =>
    rows.sort((a, b) => compareFleetRows(a, b, order))
  const groups: WorkspaceGroup[] = []
  /** Roots already placed in a workspace group; the rest fall to "Ungrouped". */
  const grouped = new Set<string>()
  for (const w of workspaces?.items ?? []) {
    const rows = w.sessionIds
      .map((id) => rowsBySession.get(id))
      .filter((r): r is FleetRow => r !== undefined)
    if (rows.length === 0) continue
    for (const r of rows) {
      grouped.add(r.id)
      r.workspace = w.title
    }
    groups.push({ key: w.workspaceId, title: w.title, rows: sortRows(rows) })
  }
  const loose = [...rowsBySession.values()].filter((r) => !grouped.has(r.id))
  if (loose.length > 0) groups.push({ key: '__ungrouped__', title: 'Ungrouped', rows: sortRows(loose) })
  // Groups arrive in the host's registry order, which has nothing to do with
  // activity — order them so the workspace in use is the one you land on.
  return groups.sort((a, b) => compareFleetGroups(a, b, order))
}

/**
 * How long a parent's durable subagent catalog is trusted while that parent is
 * running. Children appear only while a parent is busy, and the host pushes
 * catalog updates solely for parents it has already loaded — so a running
 * parent is re-polled at this cadence to pick up a freshly dispatched swarm.
 * Settled parents are never re-polled.
 */
export const CATALOG_REPOLL_MS = 4_000

/**
 * Should this parent's catalog be pulled now?
 *
 * `last` is when it was last requested (undefined = never). A never-requested
 * parent always pulls. After that, only a RUNNING parent re-polls, and only
 * once `CATALOG_REPOLL_MS` has elapsed — the refresh writes back into the
 * session list that triggers it, so the time gate is what keeps the feedback
 * loop from spinning.
 */
export function shouldPullCatalog(
  last: number | undefined,
  running: boolean,
  now: number,
  intervalMs: number = CATALOG_REPOLL_MS,
): boolean {
  if (last === undefined) return true
  if (!running) return false
  return now - last >= intervalMs
}

/**
 * Register/deregister catalog-membership interest for a set of parents.
 *
 * Extracted from the subscription effect so the contract is testable without a
 * DOM: returns the ids actually registered, which is exactly what the cleanup
 * must later close. A host missing the seam (older 0.1.x) registers nothing and
 * reports it, leaving the timed re-poll as the only update source.
 *
 * @returns `opened` — ids successfully registered; `supported` — whether the
 * host exposes the seam at all.
 */
export function openCatalogSubscriptions(
  sessions: unknown,
  ids: readonly string[],
  open: boolean,
): { opened: string[]; supported: boolean } {
  const seam = (sessions as {
    setSubagentCatalogOpen?: (id: unknown, open: boolean) => void
  } | undefined)?.setSubagentCatalogOpen
  if (typeof seam !== 'function') return { opened: [], supported: false }
  const opened: string[] = []
  for (const id of ids) {
    try {
      seam.call(sessions, id, open)
      opened.push(id)
    } catch {
      // A parent that vanished mid-pass must not abort the rest.
    }
  }
  return { opened, supported: true }
}

/**
 * Order subagent siblings newest-first, so a freshly dispatched swarm lands at
 * the TOP of its parent instead of below every agent that ever ran.
 *
 * The catalog arrives in durable `createdAt` order (oldest first), which is
 * exactly backwards for "what am I running right now". Sorting is by:
 *
 *   1. liveness — running/waiting agents outrank settled ones, because a
 *      finished child is history and a live one is the current work;
 *   2. recency — newest first.
 *
 * Recency is tricky: `updatedAt` exists only for rows resident in `byId`, and
 * is `undefined` for cold catalog rows. So the incoming index acts as the
 * fallback ordinal — later in the catalog means created later — and a row with
 * a real timestamp is compared on that only against another row that has one.
 * Mixing the two would let an arbitrary 0 outrank a genuine timestamp.
 */
export function orderSubagents(rows: FleetRow[]): FleetRow[] {
  const ordinal = new Map<string, number>()
  rows.forEach((r, i) => ordinal.set(r.id, i))
  const live = (r: FleetRow): number => (r.pending ? 0 : r.running ? 1 : 2)
  return [...rows].sort((a, b) => {
    const byLive = live(a) - live(b)
    if (byLive !== 0) return byLive
    // Both timestamped: newest first.
    if (a.updatedAt !== undefined && b.updatedAt !== undefined) {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    }
    // Otherwise fall back to catalog position, reversed (later = newer).
    return (ordinal.get(b.id) ?? 0) - (ordinal.get(a.id) ?? 0)
  })
}

/**
 * Toggle one id in an immutable set, returning a NEW set so React sees the
 * change. Used for per-session subagent collapse in the fleet tree.
 */
export function toggleInSet(
  set: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Count subagent descendants of a row, whether or not they are rendered.
 * The collapse badge shows the size of what is hidden, so it must walk the
 * whole subtree rather than just direct children.
 */
export function countDescendants(row: FleetRow): number {
  let n = 0
  for (const child of row.children) n += 1 + countDescendants(child)
  return n
}

/** Default number of sessions listed per workspace group in the Fleet list. */
export const DEFAULT_SESSIONS_PER_WORKSPACE = 3

/** Sentinel for "no limit" — the settings UI offers it as "All". */
export const SESSIONS_PER_WORKSPACE_ALL = 0

/** Selectable values for the sessions-per-workspace setting (0 = All). */
export const SESSIONS_PER_WORKSPACE_CHOICES: readonly number[] = [3, 5, 10, 25, SESSIONS_PER_WORKSPACE_ALL]

/**
 * Normalise an untrusted sessions-per-workspace value (persisted prefs are
 * user-editable) to a non-negative integer, falling back to the default.
 */
export function normalizeSessionLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SESSIONS_PER_WORKSPACE
  const i = Math.floor(n)
  if (i <= 0) return SESSIONS_PER_WORKSPACE_ALL
  return i
}

export interface LimitedGroup extends WorkspaceGroup {
  /** Rows to render — the head of `rows` under the active limit. */
  visible: FleetRow[]
  /** How many rows the limit hides (0 when everything fits). */
  hidden: number
}

/**
 * Apply the per-workspace session limit to already-sorted groups. Groups keep
 * their full `rows` (counts stay honest); `visible` is what the list renders.
 * `expanded` names group keys the user chose to show in full, and a limit of
 * `SESSIONS_PER_WORKSPACE_ALL` disables trimming everywhere.
 */
export function limitGroups(
  groups: WorkspaceGroup[],
  limit: number,
  expanded?: ReadonlySet<string>,
): LimitedGroup[] {
  const max = normalizeSessionLimit(limit)
  return groups.map((g) => {
    const capped =
      max !== SESSIONS_PER_WORKSPACE_ALL && !expanded?.has(g.key) && g.rows.length > max
    return {
      ...g,
      visible: capped ? g.rows.slice(0, max) : g.rows,
      hidden: capped ? g.rows.length - max : 0,
    }
  })
}

/** Aggregate stats across sessions into one burn figure. */
export function totalBurn(stats: Iterable<StatsLike | undefined>) {
  let steps = 0
  let llmMs = 0
  let decodeTokens = 0
  for (const s of stats) {
    if (!s) continue
    steps += s.steps
    llmMs += s.llmMs
    decodeTokens += s.decodeTokens
  }
  return { steps, llmMs, decodeTokens }
}

/**
 * Count what the panel actually renders.
 *
 * `sessions` = visible roots.
 *
 * `subagents` = subagent children that are CURRENTLY LIVE (running, or
 * waiting on you). The tree deliberately renders cold children too — the
 * durable catalog is a persisted roster that keeps every child a parent has
 * ever spawned — but the stat reads as "how big is the swarm right now", so
 * counting the roster left it pinned at its high-water mark and it never
 * returned to 0 once the agents finished.
 *
 * `running` = live ROOTS only. It answers "how many of my sessions are
 * working", so it must not absorb the swarm: a lone parent driving 3 children
 * used to report 4 (itself plus each child). Roots and subagents are now
 * counted on separate axes, so `running` + `subagents` never double-count the
 * same agent.
 *
 * `active` = live roots AND live subagents — the "is anything happening at
 * all" bit that drives the burn indicator and the collapsed pill, which must
 * stay lit while a quiet parent waits on a busy child.
 */
export function countFleet(rows: FleetRow[]): {
  sessions: number
  running: number
  subagents: number
  active: number
} {
  let sessions = 0
  let running = 0
  let subagents = 0
  const isLive = (r: FleetRow): boolean => r.running === true || r.pending !== undefined
  const walk = (list: FleetRow[], isRoot: boolean) => {
    for (const r of list) {
      if (isRoot) {
        sessions++
        if (isLive(r)) running++
      } else if (isLive(r)) subagents++
      if (r.children.length > 0) walk(r.children, false)
    }
  }
  walk(rows, true)
  return { sessions, running, subagents, active: running + subagents }
}

/**
 * Activity rank for stage ordering — lower sorts first (far left of the grid).
 * The tile stands in for a whole tree, so a root inherits the best rank in it:
 * a quiet parent driving a running subagent is as "active" as a running root.
 *
 * 0 = waiting on you (needs a human now), 1 = running, 2 = merely recent.
 */
export function stageRank(row: FleetRow): number {
  let best = row.pending ? 0 : row.running ? 1 : 2
  for (const child of row.children) {
    if (best === 0) break
    const r = stageRank(child)
    if (r < best) best = r
  }
  return best
}

/**
 * True when the row or any descendant is waiting on you. The stage tile
 * stands in for the whole tree, so a waiting subagent paints its root amber —
 * the same inheritance stageRank already applies to ordering.
 */
export function treePending(row: FleetRow): string | undefined {
  if (row.pending) return row.pending
  for (const child of row.children) {
    const p = treePending(child)
    if (p) return p
  }
  return undefined
}

/** treePending for running — a busy descendant lifts its root too. */
export function treeRunning(row: FleetRow): boolean {
  if (row.running) return true
  return row.children.some(treeRunning)
}

/**
 * Stage membership: a root earns a tile when it is running or waiting, was
 * touched within `windowMs`, or any descendant subagent qualifies (the tile
 * stands in for the whole tree).
 *
 * Ordering is part of the membership contract: the grid fills left-to-right,
 * so the most active tiles are emitted first — blocked-on-you before running
 * before recent, and within a tier the most recently touched first. Ties fall
 * back to the incoming (workspace-grouped) order, so the sort is stable.
 */
export function stageRows(rows: FleetRow[], now: number, windowMs: number): FleetRow[] {
  const active = (r: FleetRow): boolean =>
    r.running ||
    !!r.pending ||
    (r.updatedAt !== undefined && now - r.updatedAt < windowMs) ||
    r.children.some(active)
  /** Most recent touch anywhere in the tree — a busy subagent lifts its root. */
  const touchedAt = (r: FleetRow): number => {
    let latest = r.updatedAt ?? 0
    for (const child of r.children) {
      const t = touchedAt(child)
      if (t > latest) latest = t
    }
    return latest
  }
  return rows
    .filter(active)
    .map((row, index) => ({ row, index, rank: stageRank(row), touched: touchedAt(row) }))
    .sort((a, b) => a.rank - b.rank || b.touched - a.touched || a.index - b.index)
    .map((e) => e.row)
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const fmtInt = new Intl.NumberFormat('en-US')

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return fmtInt.format(n)
}

export function fmtMs(n: number): string {
  n = Math.max(0, n)
  if (n >= 3_600_000) return `${(n / 3_600_000).toFixed(1)}h`
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}s`
  return `${Math.round(n)}ms`
}

/**
 * Elapsed ms from `start` to `now`, clamped to 0 for every known bad input:
 * undefined / non-finite start (no timing), epoch-SECONDS-scale start
 * (< 1e12 — violates the dsh epoch-ms contract; corrupt → hide, never guess
 * units), and future/skewed start (now < start). All elapsed math routes
 * through here so a negative or garbage duration can never reach a formatter.
 */
export function elapsedSince(start: number | undefined, now: number): number {
  if (start === undefined || !Number.isFinite(start) || start < 1e12) return 0
  const delta = now - start
  return delta < 0 ? 0 : delta
}

/** Compact relative time — "now", "12m", "3h", "2d", then "8/14". */
export function fmtRelative(ts: number | undefined, now = Date.now()): string {
  if (!ts) return ''
  const s = Math.round(elapsedSince(ts, now) / 1000)
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  const dt = new Date(ts)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

// ---------------------------------------------------------------------------
// Overlay panel
// ---------------------------------------------------------------------------

const PANEL_STYLES = `
/* Mission Control — re-themed onto the shell's design tokens (--dsw-*).
   Follows the left sidebar's fill/label/interactive colors and inherits
   light + dark themes automatically; state colors come from the shell's
   state tokens (business blue accent, success, warn, error). */
.dshmc,
.dshmc-stage {
  --mc-bg: var(--dsw-specific-sidebar-fill, #1b1b1c);
  --mc-elev: var(--dsw-specific-menu, #353638);
  --mc-input: var(--dsw-specific-input-major, #2c2c2e);
  --mc-surface: transparent;
  --mc-surface-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
  --mc-surface-active: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.14));
  --mc-nav-active: var(--dsw-specific-sidebar-nav-item-active, rgba(255,255,255,0.10));
  --mc-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  --mc-border-subtle: var(--dsw-alias-border-l1, rgba(255,255,255,0.06));
  --mc-text: var(--dsw-alias-label-primary, #f9fafb);
  --mc-text-2: var(--dsw-alias-label-secondary, #cfd3d6);
  --mc-text-3: var(--dsw-alias-label-tertiary, #adb2b8);
  --mc-text-4: var(--dsw-alias-label-caption, #81858c);
  --mc-dimmed: var(--dsw-alias-label-dimmed, #43454a);
  --mc-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --mc-accent-hover: var(--dsw-alias-button-info-hover, #679efe);
  --mc-on-accent: var(--dsw-alias-label-primary-foreground, #ffffff);
  --mc-green: var(--dsw-alias-state-success-primary, #22c55e);
  --mc-green-soft: var(--dsw-alias-state-success-tertiary, #233c2c);
  --mc-amber: var(--dsw-alias-state-warn-primary, #f59e0b);
  --mc-amber-label: var(--dsw-alias-state-warn-label, #dd8629);
  --mc-amber-soft: var(--dsw-alias-state-warn-tertiary, #27241f);
  --mc-red: var(--dsw-alias-state-error-primary, #ef4444);
  --mc-blue: var(--dsw-alias-state-business-primary, #4176e6);
  --mc-scrollbar: var(--dsw-alias-scrollbar-bg-l2, #545557);
  --mc-scrollbar-hover: var(--dsw-alias-scrollbar-hover-l2, #65676b);
  /* One message text size across every tile surface — grid + stage, all kinds.
     The small and large steps are stated rather than derived with calc(±1px):
     arithmetic on a scale step lands BETWEEN rungs (11px - 1px = 10px), which
     is one of the ways this panel drifted off the shell ladder. */
  --mc-msg-size: 11px;
  --mc-msg-sm: 11px;
  --mc-msg-lg: 12px;
  --mc-msg-line: 1.45;
  /* The close button's multiplication-sign glyph draws much smaller than its
     font-size, so it takes its own ladder step instead of deriving one from the
     control font — deriving it produced 18.5px. */
  --mc-close-glyph: 20px;
  /* Caption step for meta chips and footers. Stated for the same reason as the
     message steps: subtracting 2px from the control font resolved to 10px on
     the rail, a size the shell ladder does not have. */
  --mc-ctl-font-sm: 11px;
  --mc-ease: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  /* Breathing room the frame reservation adds BESIDE the rail's width (see the
     paddingRight effect). The rail itself stays flush to the viewport edge;
     the gap keeps docked conversation views off its seam — the centered chat
     supplies its own margins, but full-width plugin views (Todo, Source
     Control) would otherwise run right up against the panel. Read back
     through getComputedStyle so the stylesheet and the effect cannot drift. */
  --mc-dock-gap: 16px;
}
/* Docked right rail. The shell frame is a grid (sidebar | conversation |
   details) whose side seats are single-occupant and already filled, so this
   panel cannot claim a real column without shadowing a shipped one. Instead it
   mimics the sidebar's framing: flush to the viewport edge, full height, no
   rounding or float gap, and a single hairline on the INNER edge only — the
   same seam the sidebar presents to the conversation. It still floats above
   the chat rather than reflowing it; that is the one honest difference. */
.dshmc {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 400px;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  /* Inner (left) seam only: the outer edges meet the viewport, so a full
     border would draw hairlines against nothing and break the docked read. */
  border: 0;
  border-left: 1px solid var(--mc-border);
  background: var(--mc-bg);
  color: var(--mc-text);
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  /* Soft cast onto the conversation keeps the layering legible without the
     lifted-card look of a floating panel. */
  box-shadow: -8px 0 24px rgba(0,0,0,0.10);
  z-index: 2147483000;
  pointer-events: auto;
  overflow: hidden;
  animation: mc-in 0.22s var(--mc-ease);
}
body[data-ds-dark-theme] .dshmc {
  box-shadow: -8px 0 28px rgba(0,0,0,0.38);
}
/* Slides in from the docked edge instead of rising like a card. */
@keyframes mc-in {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}
/* On a narrow viewport a fixed 400px rail would bury the conversation it
   floats over. Yield width rather than cover the app whole. */
@media (max-width: 720px) {
  .dshmc { width: min(400px, 88vw); }
}
.dshmc *,
.dshmc-stage * { box-sizing: border-box; }
.dshmc[hidden] { display: none; }

/* Frame reservation (see the paddingRight effect). The shell frame is a grid
   that fills its parent with no explicit width, and it does NOT declare
   box-sizing — under content-box, padding-right would widen the element past
   the viewport instead of narrowing its columns, so the chat would not reflow
   at all. Pinning border-box with a full-width basis makes the padding eat
   into the frame, which is what shrinks the center column and its composer.
   Scoped to the attribute the effect sets, so the shell is untouched while the
   rail is closed or in stage mode. */
[data-dshmc-reserved] {
  box-sizing: border-box !important;
  width: 100% !important;
}

/* Header — icon rail on the left, mirroring the shell sidebar's logoRow:
   controls lead, centered on their own row, no title.

   The top padding keeps these controls out of DSH Desktop's window-drag strip.
   On Windows the app builds its window with titleBarStyle 'hidden' and its
   preload appends a full-width drag region (#dsh-desktop-windows-drag-region,
   top 0, height 36px) carrying -webkit-app-region: drag. A drag region is
   resolved by the compositor BEFORE hit-testing, so it swallows clicks even
   though it sets pointer-events: none — and it sits at z-index 2147483644,
   above this panel's 2147483000. Raising z-index therefore cannot fix it; the
   control has to sit outside the strip (or opt out of dragging, which the
   buttons do below). The browser has no such region, which is why the same
   markup worked in the web UI and died in the desktop app.

   Clearing 36px also keeps the buttons clear of the caption controls and the
   native menu button, which share that strip on the right edge where this rail
   docks. Non-Windows desktop and plain web get 0px and are unaffected. */
.dshmc,
.dshmc-stage {
  --mc-titlebar-h: 0px;
  /* Standard control metrics. The panel is a 400px rail where compact controls
     are appropriate; Stage is a full-screen surface, so it overrides these to
     comfortable sizes rather than inheriting the rail's cramped ones. */
  --mc-ctl-h: 28px;
  --mc-ctl-font: 12px;
}
.dshmc-stage {
  --mc-ctl-h: 32px;
  --mc-ctl-font: 13px;
  /* Message text too: 11px is tuned for the 400px rail's narrow tiles, and on a
     full-screen grid of 420px-wide tiles it reads as undersized next to the
     standard-size controls. Overridden here so the panel keeps its own scale. */
  --mc-msg-size: 14px;
  --mc-msg-sm: 13px;
  --mc-msg-lg: 16px;
  --mc-msg-line: 1.55;
}
body.dsh-desktop-windows-titlebar-layout .dshmc,
body.dsh-desktop-windows-titlebar-layout .dshmc-stage {
  --mc-titlebar-h: 36px;
}
.dshmc-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(8px + var(--mc-titlebar-h)) 10px 8px;
  border-bottom: 1px solid var(--mc-border-subtle);
}
.dshmc-sub { color: var(--mc-text-3); font-size: 12px; margin-top: 1px; }
.dshmc-sub b { color: var(--mc-text-2); font-weight: 500; }
/* Stage-bar exit button only — the panel header no longer has a close button
   (it collapses via the panel-right icon instead). The Stage bar supplies its
   own alignment, so no auto margin is carried here. */
.dshmc-close {
  flex: none;
  width: var(--mc-ctl-h); height: var(--mc-ctl-h);
  display: grid; place-items: center;
  border: 0; border-radius: 8px;
  background: transparent;
  color: var(--mc-text-3); cursor: pointer;
  /* The multiplication-sign glyph draws much smaller than its font-size, so it
     needs a deliberate bump to look the same weight as the text controls it
     sits beside — matching their font-size alone leaves it visibly small. */
  font-size: var(--mc-close-glyph); line-height: 1;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-close:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
/* Leads the header now (was margin-left:auto, pinned right). */
.dshmc-header-actions {
  flex: none;
  display: flex; align-items: center; gap: 2px;
}
/* Same metric as the shell sidebar's .iconButton: 28px circle, secondary
   label color, hover fill from the shared interactive token. */
.dshmc-icon-btn {
  flex: none;
  width: 28px; height: 28px;
  display: inline-flex;
  align-items: center; justify-content: center;
  padding: 0;
  border: 0; border-radius: 50%;
  background: transparent;
  color: var(--mc-text-3); cursor: pointer;
  font-size: 13px; line-height: 1;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
/* Glyphs never shrink in a flex row and never swallow the button's click.
   pointer-events: none also matters on the desktop app: the preload's no-drag
   allowlist covers "button" but NOT "svg", so a glyph left as its own hit
   target could land back inside the window-drag region. */
.dshmc-icon-btn > svg { flex: none; pointer-events: none; }

/* Belt-and-braces for DSH Desktop's Windows drag strip. The preload already
   grants "button" no-drag, but this panel is a plugin overlay the shell does
   not know about, and the explicit [data-dsh-no-drag] hook is the documented
   contract rather than an incidental tag match — so state it directly and
   survive any future narrowing of that allowlist. */
.dshmc-icon-btn,
.dshmc-header,
.dshmc-stage-bar {
  -webkit-app-region: no-drag;
}
.dshmc-icon-btn:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-icon-btn.on { background: var(--mc-surface-active); color: var(--mc-text); }
/* Disabled (no current workspace): visibly inert, never clickable-looking. */
.dshmc-icon-btn:disabled { opacity: 0.45; cursor: default; }
.dshmc-icon-btn:disabled:hover { background: transparent; color: var(--mc-text-3); }

/* Settings drawer */
.dshmc-settings {
  /* Extra right padding: the panel is docked flush to the VIEWPORT edge, and a
     native <select> popup is anchored to the control's own right edge. With the
     control running to the drawer edge the popup opened hard against the screen
     with no gap, so the control column is inset to give the popup room. */
  padding: 10px 16px 10px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
  background: var(--mc-surface-hover);
}
/* Two-column grid: every label shares one left column and every control one
   right column, so labels and controls line up across ALL rows. Per-row
   space-between could not do that — it aligns each control to its own label. */
/* The control column is sized for the widest option string the selects offer
   ("Least recently active"), not for the number inputs — a column that merely
   fit those truncated the sort labels. The label column is auto so it yields
   space rather than squeezing the control. */
.dshmc-settings-row {
  display: grid;
  grid-template-columns: minmax(0, auto) var(--mc-settings-control, 168px);
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}
.dshmc-settings-label {
  font-size: 12px;
  color: var(--mc-text-2);
  min-width: 0;
}
.dshmc-settings-select {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  justify-self: stretch;
  background: var(--mc-input);
  color: var(--mc-text);
  border: 1px solid var(--mc-border);
  border-radius: 7px;
  padding: 3px 7px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.dshmc-settings-select:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.dshmc-settings-hint { margin-top: 5px; font-size: 11px; color: var(--mc-text-4); }

/* "Show N more" affordance under a trimmed workspace group */
.dshmc-group-more {
  display: block;
  width: 100%;
  margin: 1px 0 3px;
  padding: 4px 6px 4px 22px;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mc-text-4);
  font: inherit; font-size: 11px;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-group-more:hover { background: var(--mc-surface-hover); color: var(--mc-text-2); }
.dshmc-group-more:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
.dshmc-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-body::-webkit-scrollbar { width: 8px; }
.dshmc-body::-webkit-scrollbar-thumb { background: var(--mc-scrollbar); border-radius: 4px; }
.dshmc-body::-webkit-scrollbar-thumb:hover { background: var(--mc-scrollbar-hover); }
.dshmc-body::-webkit-scrollbar-track { background: transparent; }

/* Pomodoro footer — pinned below the scroll area.
   flex:none in the .dshmc flex column means it reserves its own row and the
   scrolling body shrinks around it: it can never overlap fleet rows or burn
   data, and it is not rendered inside Stage at all. */
.dshmc-pomo {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--mc-border);
  background: var(--mc-elev);
  overflow: hidden;
  /* Per-phase accent: every colored part of the footer reads this one token,
     so a phase switch recolors the whole bar through a single transition. */
  --mc-pomo-hue: var(--mc-accent);
}
.dshmc-pomo.is-break { --mc-pomo-hue: var(--mc-green); }
.dshmc-pomo.is-long { --mc-pomo-hue: var(--mc-amber); }
/* Hairline of phase color along the top edge, so the footer is identifiable
   even when the timer is idle and the wash is empty. */
.dshmc-pomo::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--mc-pomo-hue) 55%, transparent) 35%,
    color-mix(in srgb, var(--mc-pomo-hue) 55%, transparent) 65%,
    transparent
  );
  opacity: 0.5;
  transition: opacity 0.3s var(--mc-ease);
  pointer-events: none;
}
.dshmc-pomo.is-running::before { opacity: 1; }
/* Elapsed-progress wash, painted under the controls. Gradient fades toward the
   leading edge so the fill reads as a sweep rather than a flat block. */
.dshmc-pomo-progress {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  transform: scaleX(0);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--mc-pomo-hue) 4%, transparent),
    color-mix(in srgb, var(--mc-pomo-hue) 20%, transparent)
  );
  transition: transform 1s linear, background 0.45s var(--mc-ease);
  pointer-events: none;
}
/* Bright leading edge on the wash — the only part that tracks the second hand. */
.dshmc-pomo-progress::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 2px;
  background: var(--mc-pomo-hue);
  opacity: 0;
  transition: opacity 0.3s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-progress::after { opacity: 0.9; }
/* Slow sheen travelling across the footer while the clock runs. */
.dshmc-pomo.is-running .dshmc-pomo-progress {
  animation: dshmc-pomo-breathe 4s var(--mc-ease) infinite;
}
@keyframes dshmc-pomo-breathe {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
.dshmc-pomo-main {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dshmc-pomo-phase {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mc-text-4);
  white-space: nowrap;
  transition: color 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-phase { color: var(--mc-pomo-hue); }
.dshmc-pomo.is-break .dshmc-pomo-phase { color: var(--mc-pomo-hue); }
/* Pulsing bead beside the phase label — the running heartbeat of the timer. */
.dshmc-pomo-pulse {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--mc-pomo-hue);
  opacity: 0.35;
  transition: opacity 0.3s var(--mc-ease), background 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-pulse {
  opacity: 1;
  animation: dshmc-pomo-pulse 2s var(--mc-ease) infinite;
}
@keyframes dshmc-pomo-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-pomo-hue) 45%, transparent); }
  50% { transform: scale(1.25); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mc-pomo-hue) 0%, transparent); }
}
.dshmc-pomo-clock {
  font-size: 16px;
  font-weight: 500;
  color: var(--mc-text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  transition: color 0.45s var(--mc-ease), text-shadow 0.45s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-clock {
  color: var(--mc-text);
  text-shadow: 0 0 14px color-mix(in srgb, var(--mc-pomo-hue) 35%, transparent);
}
/* Final 60 seconds: the clock turns urgent and ticks. */
.dshmc-pomo.is-ending .dshmc-pomo-clock {
  color: var(--mc-pomo-hue);
  animation: dshmc-pomo-tick 1s steps(1, end) infinite;
}
@keyframes dshmc-pomo-tick {
  0%, 60% { opacity: 1; }
  61%, 100% { opacity: 0.55; }
}
.dshmc-pomo-dots { display: flex; align-items: center; gap: 3px; margin-left: 2px; }
.dshmc-pomo-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--mc-dimmed);
  transition: background 0.3s var(--mc-ease), transform 0.3s var(--mc-ease),
    box-shadow 0.3s var(--mc-ease);
}
.dshmc-pomo-dot.on {
  background: var(--mc-pomo-hue);
  transform: scale(1.35);
  box-shadow: 0 0 6px color-mix(in srgb, var(--mc-pomo-hue) 60%, transparent);
  animation: dshmc-pomo-pop 0.4s var(--mc-ease);
}
@keyframes dshmc-pomo-pop {
  0% { transform: scale(0.4); }
  60% { transform: scale(1.7); }
  100% { transform: scale(1.35); }
}
.dshmc-pomo-actions {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
/* 28px to match .dshmc-icon-btn (itself the shell sidebar's metric), so the
   16px glyphs keep the same optical padding as the header icons. The square
   radius is kept deliberately: it distinguishes the transport row from the
   circular header controls without changing the icon metric. */
.dshmc-pomo-btn {
  width: 28px; height: 28px;
  display: inline-flex;
  align-items: center; justify-content: center;
  padding: 0;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--mc-text-3);
  cursor: pointer;
  line-height: 1;
  font-family: inherit;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease),
    transform 0.15s var(--mc-ease);
}
/* Matches the header rule: glyphs never shrink, and never become the hit
   target (the desktop drag-region allowlist covers "button" but not "svg"). */
.dshmc-pomo-btn > svg { flex: none; pointer-events: none; }
.dshmc-pomo-btn:hover {
  background: var(--mc-surface-hover);
  color: var(--mc-text);
  transform: translateY(-1px);
}
.dshmc-pomo-btn:active { transform: translateY(0) scale(0.92); }
.dshmc-pomo-btn.is-primary {
  color: var(--mc-text-2);
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease),
    transform 0.15s var(--mc-ease), box-shadow 0.3s var(--mc-ease);
}
.dshmc-pomo.is-running .dshmc-pomo-btn.is-primary {
  color: var(--mc-pomo-hue);
  background: color-mix(in srgb, var(--mc-pomo-hue) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-pomo-hue) 30%, transparent);
}
.dshmc-pomo-btn:focus-visible { outline: 2px solid var(--mc-pomo-hue); outline-offset: -2px; }

/* Number inputs in the settings drawer (pomodoro durations). Capped rather
   than stretched: a 152px box for a two-digit minute count reads as broken. It
   keeps the column's LEFT edge, so it still lines up with the selects above. */
.dshmc-settings-num {
  width: 72px;
  min-width: 0;
  justify-self: start;
  background: var(--mc-input);
  color: var(--mc-text);
  border: 1px solid var(--mc-border);
  border-radius: 7px;
  padding: 3px 7px;
  font-size: 12px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.dshmc-settings-num:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
/* The checkbox row is label-on-the-left too: the control column holds only the
   box, so it lines up with the selects and number inputs above and below it. */
.dshmc-settings-check {
  display: block;
  cursor: pointer;
  min-width: 0;
}
.dshmc-settings-box {
  justify-self: start;
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--mc-accent);
}
.dshmc-settings-sep {
  margin: 9px 0 7px;
  border-top: 1px solid var(--mc-border-subtle);
  padding-top: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mc-text-4);
}
.dshmc-settings-row + .dshmc-settings-row { margin-top: 6px; }


/* Mode tabs — full-width segmented control on its own row */
.dshmc-modes {
  display: flex;
  gap: 2px;
  margin: 10px 12px 2px;
  padding: 2px;
  border-radius: 9px;
  background: var(--mc-surface-hover);
}
.dshmc-mode {
  flex: 1;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--mc-text-3);
  font: inherit; font-size: 12px; font-weight: 500;
  padding: 4px 10px;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-mode:hover { color: var(--mc-text); }
.dshmc-mode.on { background: var(--mc-bg); color: var(--mc-text); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
body[data-ds-dark-theme] .dshmc-mode.on { background: var(--mc-surface-active); box-shadow: none; }
.dshmc-mode-badge {
  margin-left: 4px;
  font-size: 11px;
  color: var(--mc-amber-label);
  font-variant-numeric: tabular-nums;
}

/* Stats strip — flat cards, color carries the signal */
.dshmc-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 4px;
}
.dshmc-stat {
  border: 1px solid var(--mc-border-subtle);
  border-radius: 10px;
  padding: 8px 10px 7px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  position: relative;
  overflow: hidden;
  transition: border-color 0.25s var(--mc-ease), box-shadow 0.25s var(--mc-ease);
}
.dshmc-stat-value {
  font-weight: 500; font-size: 16px; letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  transition: color 0.25s var(--mc-ease);
}
.dshmc-stat-label { color: var(--mc-text-4); font-size: 11px; margin-top: 2px; }
.dshmc-stat.is-live { border-color: color-mix(in srgb, var(--mc-green) 35%, transparent); }
.dshmc-stat.is-live .dshmc-stat-value { color: var(--mc-green); }
.dshmc-stat.is-waiting-live { border-color: color-mix(in srgb, var(--mc-amber) 35%, transparent); }
.dshmc-stat.is-waiting-live .dshmc-stat-value { color: var(--mc-amber-label); }
/* Swarm (subagents): accent-toned so a live swarm is distinguishable at a
   glance from "running" (green) and "waiting on you" (amber). */
.dshmc-stat.is-swarm-live { border-color: color-mix(in srgb, var(--mc-accent) 35%, transparent); }
.dshmc-stat.is-swarm-live .dshmc-stat-value { color: var(--mc-accent); }

/* Active stat cards glow gently so live numbers read as alive, not static */
.dshmc-stat.is-live { animation: mc-stat-glow-green 3s ease-in-out infinite; }
.dshmc-stat.is-waiting-live { animation: mc-stat-glow-amber 2s ease-in-out infinite; }
.dshmc-stat.is-swarm-live { animation: mc-stat-glow-accent 2.6s ease-in-out infinite; }
@keyframes mc-stat-glow-green {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-green) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-green) 45%, transparent); }
}
@keyframes mc-stat-glow-amber {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-amber) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-amber) 55%, transparent); }
}
@keyframes mc-stat-glow-accent {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-accent) 0%, transparent); }
  50% { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--mc-accent) 50%, transparent); }
}
/* A sheen sweeps across a live card — reads as throughput at a glance */
.dshmc-stat.is-live::after,
.dshmc-stat.is-waiting-live::after,
.dshmc-stat.is-swarm-live::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-green) 14%, transparent) 50%,
    transparent 80%
  );
  transform: translateX(-100%);
  animation: mc-stat-sheen 3.4s var(--mc-ease) infinite;
}
.dshmc-stat.is-waiting-live::after {
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-amber) 16%, transparent) 50%,
    transparent 80%
  );
  animation-duration: 2.4s;
}
.dshmc-stat.is-swarm-live::after {
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--mc-accent) 15%, transparent) 50%,
    transparent 80%
  );
  animation-duration: 2.9s;
}
@keyframes mc-stat-sheen {
  0% { transform: translateX(-100%); }
  55%, 100% { transform: translateX(100%); }
}
/* Value flash — fires for one beat whenever the underlying count changes */
.dshmc-stat-value.is-bumped { animation: mc-stat-bump 0.5s var(--mc-ease); }
@keyframes mc-stat-bump {
  0% { transform: none; }
  30% { transform: translateY(-2px) scale(1.09); }
  100% { transform: none; }
}
.dshmc-stat.is-bumped-card { animation: mc-stat-bump-card 0.5s var(--mc-ease); }
@keyframes mc-stat-bump-card {
  0% { border-color: var(--mc-accent); box-shadow: 0 0 14px -3px color-mix(in srgb, var(--mc-accent) 60%, transparent); }
  100% { border-color: var(--mc-border-subtle); box-shadow: none; }
}

/* Section labels */
.dshmc-section {
  font-size: 11px;
  font-weight: 500;
  color: var(--mc-text-4);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin: 16px 2px 6px;
}

/* Groups — separated so each workspace reads as its own block */
.dshmc-group + .dshmc-group { margin-top: 10px; }

/* Group headers — sidebar section-header pattern */
.dshmc-group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  margin: 2px 0;
  cursor: pointer;
  border-radius: 8px;
  user-select: none;
  transition: background 0.15s var(--mc-ease);
}
.dshmc-group-header:hover { background: var(--mc-surface-hover); }
.dshmc-caret {
  color: var(--mc-text-4);
  font-size: 11px;
  transition: transform 0.18s var(--mc-ease);
  display: inline-block;
}
.dshmc-caret.open { transform: rotate(90deg); }
.dshmc-group-title {
  font-weight: 500; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-group-count {
  font-size: 11px; color: var(--mc-text-4);
  background: var(--mc-surface-hover);
  border-radius: 999px; padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}
.dshmc-group-live { font-size: 11px; color: var(--mc-green); margin-left: 1px; font-weight: 500; position: relative; }
.dshmc-group-live::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  display: inline-block;
  margin-right: 4px;
  vertical-align: 1px;
  animation: mc-pulse-dot 1.6s ease-in-out infinite;
}
@keyframes mc-pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* Session rows — sidebar nav-item fills; state shown by dot + edge bar */
.dshmc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin: 3px 0;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  position: relative;
  transition: background 0.15s var(--mc-ease);
}
.dshmc-row:hover { background: var(--mc-surface-hover); }
.dshmc-row.current { background: var(--mc-nav-active); }
/* Running: soft success wash + breathing edge bar + outer glow */
.dshmc-row.is-running {
  background: var(--mc-green-soft);
  animation: mc-breathe 2.6s ease-in-out infinite;
  overflow: hidden;
}
.dshmc-row.is-running:hover {
  background: linear-gradient(var(--mc-surface-hover), var(--mc-surface-hover)), var(--mc-green-soft);
}
@keyframes mc-breathe {
  0%, 100% {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--mc-green) 55%, transparent),
                0 0 0 0 transparent;
  }
  50% {
    box-shadow: inset 2px 0 0 var(--mc-green),
                0 0 10px -2px color-mix(in srgb, var(--mc-green) 40%, transparent);
  }
}
/* A light sweeps left-to-right along a running row: work is moving */
.dshmc-row.is-running::after,
.dshmc-row.is-waiting::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(
    100deg,
    transparent 25%,
    color-mix(in srgb, var(--mc-green) 12%, transparent) 50%,
    transparent 75%
  );
  transform: translateX(-100%);
  animation: mc-row-sweep 2.8s var(--mc-ease) infinite;
}
@keyframes mc-row-sweep {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(100%); }
}
/* Waiting-on-you: soft warn wash, faster edge pulse, warmer glow */
.dshmc-row.is-waiting {
  background: var(--mc-amber-soft);
  animation: mc-breathe-amber 1.8s ease-in-out infinite;
  overflow: hidden;
}
.dshmc-row.is-waiting:hover {
  background: linear-gradient(var(--mc-surface-hover), var(--mc-surface-hover)), var(--mc-amber-soft);
}
.dshmc-row.is-waiting::after {
  background: linear-gradient(
    100deg,
    transparent 25%,
    color-mix(in srgb, var(--mc-amber) 16%, transparent) 50%,
    transparent 75%
  );
  animation-duration: 1.9s;
}
@keyframes mc-breathe-amber {
  0%, 100% {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--mc-amber) 55%, transparent),
                0 0 0 0 transparent;
  }
  50% {
    box-shadow: inset 2px 0 0 var(--mc-amber),
                0 0 10px -2px color-mix(in srgb, var(--mc-amber) 50%, transparent);
  }
}
/* Row content sits above the sweep layer */
.dshmc-row > * { position: relative; z-index: 1; }
/* Freshly-changed row: one-shot accent flash when a session turns active */
.dshmc-row.is-flashing { animation: mc-row-flash 0.6s var(--mc-ease); }
@keyframes mc-row-flash {
  0% { background: color-mix(in srgb, var(--mc-accent) 22%, transparent); }
  100% { background: transparent; }
}
.dshmc-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--mc-dimmed); flex: none;
}
.dshmc-dot.running { background: var(--mc-green); animation: mc-pulse 2s ease-in-out infinite; }
.dshmc-dot.pending { background: var(--mc-amber); animation: mc-pulse-amber 1.4s ease-in-out infinite; }
.dshmc-dot.done { background: var(--mc-blue); }
@keyframes mc-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-green) 45%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes mc-pulse-amber {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mc-amber) 55%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.dshmc-title-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px;
  color: var(--mc-text-2);
  font-weight: 400;
}
.dshmc-row:hover .dshmc-title-text,
.dshmc-row.current .dshmc-title-text { color: var(--mc-text); }
/* Per-session subagent collapse toggle. Sized to the dot it sits beside so the
   row rhythm is unchanged; the spacer keeps childless rows aligned. */
.dshmc-rowcaret {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--mc-text-4);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s var(--mc-ease), background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-rowcaret.open { transform: rotate(90deg); }
.dshmc-rowcaret:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowcaret:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 1px;
}
.dshmc-rowcaret-spacer { flex: none; width: 14px; }
/* A folded row's count is the only remaining evidence of its swarm, so it
   gains weight instead of sitting muted like the expanded case. */
.dshmc-tag.is-folded {
  border-color: color-mix(in srgb, var(--mc-accent) 40%, transparent);
  color: var(--mc-accent);
}
.dshmc-branch {
  flex: none;
  height: 100%;
  min-height: 20px;
  margin-left: -8px;
  border-left: 1px solid var(--mc-border);
  margin-right: 8px;
}
.dshmc-time {
  flex: none;
  font-size: 11px;
  color: var(--mc-text-4);
  font-variant-numeric: tabular-nums;
}
.dshmc-tag {
  flex: none;
  font-size: 11px;
  font-weight: 500;
  padding: 1.5px 7px;
  border-radius: 999px;
  border: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-3);
  background: transparent;
}
.dshmc-tag-model {
  color: var(--mc-accent);
  border-color: color-mix(in srgb, var(--mc-accent) 30%, transparent);
  background: color-mix(in srgb, var(--mc-accent) 10%, transparent);
  max-width: 132px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshmc-rate {
  flex: none;
  font-size: 11px;
  color: var(--mc-green);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  animation: mc-rate-glow 1.8s ease-in-out infinite;
}
/* Token rate is the loudest activity signal in a row — let it shimmer */
@keyframes mc-rate-glow {
  0%, 100% { opacity: 0.7; text-shadow: 0 0 0 transparent; }
  50% { opacity: 1; text-shadow: 0 0 7px color-mix(in srgb, var(--mc-green) 60%, transparent); }
}

/* Buttons — shell patterns (were unstyled browser defaults) */
.dshmc-btnrow { display: flex; gap: 6px; align-items: center; }
.dshmc-btn {
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--dsw-alias-button-floating-fill, transparent);
  color: var(--mc-text-2);
  font: inherit; font-size: 12px; font-weight: 500;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s var(--mc-ease), color 0.15s var(--mc-ease);
}
.dshmc-btn:hover:not(:disabled) { background: var(--dsw-alias-button-floating-hover, var(--mc-surface-hover)); color: var(--mc-text); }
.dshmc-btn.primary {
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  border-color: transparent;
  color: var(--mc-on-accent);
}
.dshmc-btn.primary:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); color: var(--mc-on-accent); }
.dshmc-btn.ghost { background: transparent; border-color: var(--mc-border-subtle); color: var(--mc-text-3); }
.dshmc-btn.ghost:hover:not(:disabled) { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-btn:disabled { opacity: 0.5; cursor: default; }

/* Permission inbox */
.dshmc-inbox-item {
  border: 1px solid color-mix(in srgb, var(--mc-amber) 30%, transparent);
  background: var(--mc-amber-soft);
  border-radius: 10px;
  padding: 10px 11px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: border-color 0.15s var(--mc-ease);
}
.dshmc-inbox-item:hover { border-color: color-mix(in srgb, var(--mc-amber) 55%, transparent); }
.dshmc-inbox-kind { font-weight: 500; color: var(--mc-amber-label); font-size: 11px; letter-spacing: 0.01em; }
.dshmc-inbox-title { margin: 3px 0 8px; font-size: 12px; color: var(--mc-text-2); }
.dshmc-inbox-error { margin-top: 6px; font-size: 11px; color: var(--mc-red); }
.dshmc-inbox-item.is-attention {
  border-color: color-mix(in srgb, var(--mc-red) 30%, transparent);
  background: color-mix(in srgb, var(--mc-red) 7%, transparent);
}
.dshmc-inbox-item.is-attention:hover { border-color: color-mix(in srgb, var(--mc-red) 55%, transparent); }
.dshmc-inbox-item.is-attention .dshmc-inbox-kind { color: var(--mc-red); }
.dshmc-inbox-note {
  color: var(--mc-text-4);
  font-size: 11px;
  line-height: 1.45;
  margin: 6px 2px 0;
}
.dshmc-inbox-zero { text-align: center; padding: 26px 12px 10px; color: var(--mc-text-3); font-size: 12px; }
.dshmc-inbox-zero-mark { color: var(--mc-green); font-size: 16px; margin-bottom: 4px; }

/* Inline question answering: mirrors the session's real options 1:1 */
.dshmc-q { margin: 7px 0 9px; }
.dshmc-q + .dshmc-q { border-top: 1px solid var(--mc-border-subtle); padding-top: 9px; }
.dshmc-q-header {
  font-size: 11px; font-weight: 500;
  color: var(--mc-text-4);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 2px;
}
.dshmc-q-text { font-size: 12px; color: var(--mc-text-2); line-height: 1.4; }
.dshmc-q-detail { font-size: 11px; color: var(--mc-text-3); line-height: 1.45; margin-top: 3px; }
.dshmc-q-options { display: flex; flex-direction: column; gap: 4px; margin: 7px 0 6px; }
.dshmc-q-option {
  display: flex; flex-direction: column; gap: 2px;
  text-align: left;
  border: 1px solid var(--mc-border);
  background: var(--mc-input);
  color: var(--mc-text-2);
  border-radius: 7px;
  padding: 6px 9px;
  font: inherit; font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s var(--mc-ease), background 0.12s var(--mc-ease);
}
.dshmc-q-option:hover:not(:disabled) { border-color: var(--mc-accent); }
.dshmc-q-option:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.dshmc-q-option.is-selected {
  border-color: var(--mc-accent);
  background: color-mix(in srgb, var(--mc-accent) 16%, transparent);
  color: var(--mc-text);
}
.dshmc-q-option:disabled { opacity: 0.55; cursor: default; }
.dshmc-q-option-label { font-weight: 500; }
.dshmc-q-option-desc { color: var(--mc-text-3); font-size: 11px; line-height: 1.4; }
.dshmc-q-custom {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--mc-border);
  background: var(--mc-input);
  color: var(--mc-text-2);
  border-radius: 7px;
  padding: 5px 8px;
  font: inherit; font-size: 12px;
  margin-top: 2px;
}
.dshmc-q-custom:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-q-custom:disabled { opacity: 0.55; }

/* Empty states */
.dshmc-empty {
  color: var(--mc-text-4);
  font-size: 12px;
  padding: 6px 8px;
}

/* Reopen pill */
.dshmc-reopen {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  pointer-events: auto;
  border-radius: 999px;
  border: 1px solid var(--mc-border);
  background: var(--mc-bg);
  color: var(--mc-text-2);
  padding: 8px 14px;
  cursor: pointer;
  font: 500 12px/1 var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif);
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 12px 32px rgba(0,0,0,0.12));
  display: inline-flex; align-items: center; gap: 7px;
  transition: color 0.15s var(--mc-ease), border-color 0.15s var(--mc-ease);
}
body[data-ds-dark-theme] .dshmc-reopen { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.5); }
.dshmc-reopen::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--mc-accent);
}
.dshmc-reopen:hover { color: var(--mc-text); border-color: var(--dsw-alias-border-l3, var(--mc-border)); }
.dshmc-reopen.is-live { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-reopen.is-live::before { background: var(--mc-green); animation: mc-pulse-dot 1.6s ease-in-out infinite; }
.dshmc-reopen.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 40%, transparent); }
.dshmc-reopen.is-waiting::before { background: var(--mc-amber); animation: mc-pulse-dot 1.2s ease-in-out infinite; }

/* Row actions popover */
.dshmc-rowmenu-btn {
  opacity: 0;
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: transparent;
  color: var(--mc-text-3);
  cursor: pointer;
  font-size: 13px; line-height: 1;
  padding: 0;
  flex: none;
}
.dshmc-row:hover .dshmc-rowmenu-btn,
.dshmc-row:focus-within .dshmc-rowmenu-btn,
.dshmc-rowmenu-btn[aria-expanded="true"] { opacity: 1; }
.dshmc-rowmenu-btn:hover { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowmenu {
  position: fixed;
  z-index: 2147483200;
  min-width: 168px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--mc-border);
  background: var(--mc-elev);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,0.2));
}
body[data-ds-dark-theme] .dshmc-rowmenu { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.5); }
.dshmc-rowmenu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--mc-text-2);
  font: inherit; font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dshmc-rowmenu-item:hover:not(:disabled) { background: var(--mc-surface-hover); color: var(--mc-text); }
.dshmc-rowmenu-item:disabled { opacity: 0.45; cursor: default; }
.dshmc-rowmenu-item.danger { color: var(--mc-red); }
.dshmc-rowmenu-item.danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); color: var(--mc-red); }
.dshmc-rowmenu-divider { height: 1px; margin: 4px 6px; background: var(--mc-border-subtle); }
.dshmc-rowmenu-note { padding: 6px 8px 4px; color: var(--mc-text-4); font-size: 11px; }
.dshmc-rowmenu-error { padding: 6px 8px 4px; color: var(--mc-red); font-size: 11px; }
.dshmc-rowmenu-send {
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px;
  min-width: 224px;
}
.dshmc-rowmenu-send textarea,
.dshmc-rename-input {
  resize: none;
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--mc-input);
  color: var(--mc-text);
  font: inherit; font-size: 12px;
  padding: 6px 8px;
}
.dshmc-rowmenu-send textarea { min-height: 46px; }
.dshmc-rowmenu-send textarea:focus,
.dshmc-rename-input:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-rowmenu-send-row { display: flex; align-items: center; gap: 6px; }
.dshmc-rowmenu-send-mode { color: var(--mc-text-4); font-size: 11px; }
.dshmc-rowmenu-send-btn {
  margin-left: auto;
  border: 0; border-radius: 7px;
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  color: var(--mc-on-accent);
  font: inherit; font-size: 12px; font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
}
.dshmc-rowmenu-send-btn:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); }
.dshmc-rowmenu-send-btn:disabled { opacity: 0.5; cursor: default; }
.dshmc-backdrop { position: fixed; inset: 0; z-index: 2147483100; }

/* Search */
.dshmc-search { padding: 0 2px 6px; }
.dshmc-search-input {
  width: 100%;
  border: 1px solid var(--mc-border);
  border-radius: 9px;
  background: var(--mc-input);
  color: var(--mc-text);
  font: inherit; font-size: 13px;
  padding: 6px 10px;
}
.dshmc-search-input::placeholder { color: var(--mc-text-4); }
.dshmc-search-input:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-search-result {
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.dshmc-search-result:hover { background: var(--mc-surface-hover); }
.dshmc-search-result-title { font-size: 13px; color: var(--mc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshmc-search-result-snippet { font-size: 11px; color: var(--mc-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dshmc-tile {
  display: flex; flex-direction: column;
  min-height: 150px;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
  animation: mc-tile-in 0.2s var(--mc-ease);
}
@keyframes mc-tile-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
.dshmc-tile.is-running { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-tile.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 45%, transparent); }
.dshmc-tile-head {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--mc-border-subtle);
}
.dshmc-tile-title {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.dshmc-tile-title:hover { color: var(--mc-accent); }
.dshmc-tile-body {
  flex: 1;
  /* Without this a flex item refuses to shrink below its CONTENT height, so the
     scroller never engages and the tile grows instead. */
  min-height: 0;
  overflow-y: auto;
  padding: 7px 9px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: var(--mc-msg-size); line-height: var(--mc-msg-line);
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
/* Same shrink guard as the Stage tile below: children of a scrolling flex
   column must keep their natural height, or a long transcript squeezes the
   short rows (tool calls first) into unreadable lines. */
.dshmc-tile-body > * { flex: 0 0 auto; }
.dshmc-tile-msg { white-space: pre-wrap; word-break: break-word; }
/* User messages: right-aligned bubble, mirroring the chat's userRow/bubble */
.dshmc-tile-msg.user {
  align-self: flex-end;
  max-width: 88%;
  background: var(--dsw-specific-bubble, var(--mc-surface-hover));
  color: var(--mc-text);
  border-radius: 14px;
  /* Derived from the message size so the bubble stays proportional on Stage,
     which raises --mc-msg-size; a fixed 6px/11px looked pinched at 13px. */
  padding: calc(var(--mc-msg-size) * 0.55) calc(var(--mc-msg-size) * 1.0);
}
.dshmc-tile-msg.assistant { color: var(--mc-text); }
.dshmc-tile-msg.tool { color: var(--mc-accent); }
.dshmc-tile-msg.err { color: var(--mc-red); }
/* Host markdown inside tiles: inherit tile metrics, tighten block rhythm.
   Assistant text comes from the host's own MarkdownText component, which ships
   its own font sizing. Those host rules can outrank a bare .dshmc-md, leaving
   assistant messages a different size from the plain user rows beside them, so
   force every descendant onto the surface's message size. The exceptions below
   (headings, code, tables) then re-derive from the same token. */
.dshmc-md,
.dshmc-md * {
  font-size: inherit;
  line-height: inherit;
}
.dshmc-md { white-space: normal; }
.dshmc-md p { margin: 0 0 6px; }
.dshmc-md p:last-child { margin-bottom: 0; }
/* These all derive from --mc-msg-size rather than hardcoding px: assistant text
   renders through .dshmc-md, so fixed sizes here left assistant messages at 11px
   while user bubbles inherited the token — the two read as different sizes in
   the same conversation. Everything scales with the surface now. */
.dshmc-md h1, .dshmc-md h2, .dshmc-md h3, .dshmc-md h4 {
  margin: 8px 0 4px;
  font-size: var(--mc-msg-lg);
  line-height: 1.4;
}
.dshmc-md ul, .dshmc-md ol { margin: 4px 0; padding-left: 18px; }
.dshmc-md pre { margin: 6px 0; font-size: var(--mc-msg-sm); }
.dshmc-md code { font-size: var(--mc-msg-sm); }
.dshmc-md table { font-size: var(--mc-msg-sm); }
.dshmc-tile-foot {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 9px;
  border-top: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-4);
  font-size: 11px;
}
.dshmc-tile-foot .dshmc-time { margin-left: auto; }
/* Live LLM activity line: phase + elapsed (+ tok/s) under a tile's body */
.dshmc-llm {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 9px;
  border-top: 1px solid var(--mc-border-subtle);
  font-size: 11px; line-height: 1.4;
  color: var(--mc-text-3);
  min-width: 0;
}
.dshmc-llm .dshmc-dot { flex: none; }
.dshmc-llm-label { color: var(--mc-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshmc-llm-time { color: var(--mc-text-4); font-variant-numeric: tabular-nums; }
.dshmc-llm-rate { margin-left: auto; color: var(--mc-green); font-variant-numeric: tabular-nums; }
/* Expandable tool rows: head button + details panel */
.dshmc-tool { border: 1px solid var(--mc-border-subtle); border-radius: 8px; overflow: hidden; }
.dshmc-tool.is-err { border-color: color-mix(in srgb, var(--mc-red) 36%, transparent); }
.dshmc-tool-head {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0;
  border: 0; border-radius: 8px;
  background: var(--mc-elev); color: var(--mc-accent);
  font: inherit; text-align: left;
  padding: 3px 8px; cursor: pointer;
}
.dshmc-tool-head:hover { background: var(--mc-surface-hover); }
.dshmc-tool-head:focus-visible { outline: 1px solid var(--mc-accent); outline-offset: -1px; }
.dshmc-tool-caret { flex: none; width: 1em; color: var(--mc-text-4); }
.dshmc-tool-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshmc-tool-badge { margin-left: auto; flex: none; color: var(--mc-text-4); font-size: 11px; font-variant-numeric: tabular-nums; }
.dshmc-tool-badge.running { color: var(--mc-amber-label); }
.dshmc-tool-badge.failed { color: var(--mc-red); }
.dshmc-tool-subs { flex: none; color: var(--mc-text-4); font-size: 11px; }
.dshmc-tool-body {
  display: flex; flex-direction: column; gap: 4px;
  border-top: 1px solid var(--mc-border-subtle);
  padding: 5px 8px;
}
.dshmc-tool-args, .dshmc-tool-result {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px; line-height: 1.45; color: var(--mc-text-2);
  max-height: 140px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-tool-error { color: var(--mc-red); font-size: 11px; word-break: break-word; }
.dshmc-tool-none { color: var(--mc-text-4); font-size: 11px; }
.dshmc-tile-stop {
  border: 0; border-radius: 6px;
  background: color-mix(in srgb, var(--mc-red) 14%, transparent);
  color: var(--mc-red);
  font: inherit; font-size: 11px; font-weight: 500;
  padding: 1px 7px;
  cursor: pointer;
}
.dshmc-tile-stop:hover { background: color-mix(in srgb, var(--mc-red) 24%, transparent); }
.dshmc-caret-blink { animation: mc-blink 1s steps(1) infinite; color: var(--mc-accent); }
@keyframes mc-blink { 50% { opacity: 0; } }

/* Stage — full-screen live grid (swaps the panel in stage mode) */
.dshmc-stage {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  background: var(--mc-bg);
  color: var(--mc-text);
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
  pointer-events: auto;
  /* Full-screen surface: fades up in place. It must NOT share the panel's
     slide-from-the-right entrance, which only reads correctly on a rail
     docked to that edge. */
  animation: mc-stage-in 0.22s var(--mc-ease);
}
@keyframes mc-stage-in {
  from { opacity: 0; transform: scale(0.995); }
  to { opacity: 1; transform: none; }
}
/* Stage covers the whole viewport (inset: 0), so unlike the docked panel it
   also spans DSH Desktop's window-drag strip — the same 36px band documented on
   .dshmc-header above, which holds the caption controls on its right edge. The
   bar's own controls (window toggles, exit) sit at that right edge, so without
   this offset they land under the minimize/maximize/close buttons and are
   unclickable: the drag region resolves before hit-testing and outranks this
   overlay's z-index, so clearing the strip is the only fix. */
.dshmc-stage-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(12px + var(--mc-titlebar-h)) 16px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-title { font-weight: 500; font-size: 14px; }
.dshmc-stage-count { color: var(--mc-text-3); font-size: var(--mc-ctl-font); }
.dshmc-stage-count b { color: var(--mc-text-2); font-weight: 500; }
.dshmc-stage-window {
  display: flex;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border-radius: 9px;
  background: var(--mc-surface-hover);
}
.dshmc-stage-bar .dshmc-close { margin-left: 0; }
/* Stage bar controls take the full-screen surface's standard metrics: the
   panel's 11.5px/28px segmented control reads as undersized here. */
.dshmc-stage-window .dshmc-mode {
  font-size: var(--mc-ctl-font);
  padding: 0 14px;
  height: calc(var(--mc-ctl-h) - 4px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* The exit button matches the segmented control's outer height, so the two
   groups at the bar's right edge share one baseline and one visual size. */
.dshmc-stage-bar .dshmc-close {
  width: var(--mc-ctl-h);
  height: var(--mc-ctl-h);
}
.dshmc-stage-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  grid-auto-rows: minmax(260px, 1fr);
  gap: 10px;
  padding: 12px 16px 16px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
.dshmc-stage-empty { color: var(--mc-text-4); font-size: 13px; padding: 24px 16px; }
.dshmc-stage-tile {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
}
.dshmc-stage-tile.is-running { border-color: color-mix(in srgb, var(--mc-green) 40%, transparent); }
.dshmc-stage-tile.is-waiting { border-color: color-mix(in srgb, var(--mc-amber) 45%, transparent); }
.dshmc-stage-tile-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-tile-title {
  flex: 1; min-width: 0;
  font-size: var(--mc-ctl-font); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.dshmc-stage-tile-title:hover { color: var(--mc-accent); }
.dshmc-stage-tile-ws {
  flex: none;
  max-width: 40%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: 1px solid var(--mc-border-subtle);
  border-radius: 6px;
  padding: 1px 6px;
  color: var(--mc-text-4);
  font-size: var(--mc-ctl-font-sm);
}
/* To-do strip: docked directly above the composer, mirroring where the stock
   chat renders its to-do panel. Border is on TOP because it now separates the
   strip from the transcript above it, not from content below. */
.dshmc-todos {
  flex: none;
  border-top: 1px solid var(--mc-border-subtle);
  background: color-mix(in srgb, var(--mc-accent) 5%, transparent);
}
/* Whatever follows the strip (composer, or a wait prompt when the session is
   parked) already has its own top border — collapse the double line. */
.dshmc-todos + .dshmc-stage-tile-input,
.dshmc-todos + .dshmc-stage-tile-wait { border-top: 0; }
.dshmc-todos-head {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0;
  border: 0; background: none; color: var(--mc-text-2);
  font: inherit; font-size: var(--mc-msg-sm); text-align: left;
  padding: 5px 12px; cursor: pointer;
}
.dshmc-todos-head:hover { background: var(--mc-surface-hover); }
.dshmc-todos-head:focus-visible { outline: 1px solid var(--mc-accent); outline-offset: -1px; }
.dshmc-todos-caret { flex: none; width: 1em; color: var(--mc-text-4); }
.dshmc-todos-count { flex: none; color: var(--mc-accent); font-variant-numeric: tabular-nums; }
.dshmc-todos-active {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--mc-text-3);
}
.dshmc-todos-list {
  list-style: none; margin: 0;
  padding: 0 12px 7px 12px;
  display: flex; flex-direction: column; gap: 3px;
  max-height: 30vh; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--mc-scrollbar) transparent;
}
/* Same shrink guard: past 30vh a long plan would squash every item rather
   than scroll, and a wrapped todo would lose its lower lines. */
.dshmc-todos-list > * { flex: 0 0 auto; }
.dshmc-todo-item {
  display: flex; align-items: baseline; gap: 6px;
  font-size: var(--mc-msg-sm); line-height: var(--mc-msg-line);
  color: var(--mc-text-3);
}
.dshmc-todo-glyph { flex: none; width: 1em; text-align: center; }
.dshmc-todo-text { min-width: 0; word-break: break-word; }
.dshmc-todo-item[data-status="completed"] { color: var(--mc-text-4); }
.dshmc-todo-item[data-status="completed"] .dshmc-todo-glyph { color: var(--mc-green); }
.dshmc-todo-item[data-status="completed"] .dshmc-todo-text { text-decoration: line-through; }
.dshmc-todo-item[data-status="in_progress"] { color: var(--mc-text-2); font-weight: 500; }
.dshmc-todo-item[data-status="in_progress"] .dshmc-todo-glyph { color: var(--mc-amber-label); }
.dshmc-stage-tile-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
  font-size: var(--mc-msg-size); line-height: var(--mc-msg-line);
  scrollbar-width: thin;
  scrollbar-color: var(--mc-scrollbar) transparent;
}
/* A SCROLLING flex column still shrinks its children: flex-shrink defaults to
   1, so once the transcript outgrows the tile every row is squeezed instead of
   the container scrolling. Tool rows lose first — they have the least intrinsic
   height — collapsing to bare lines whose name and badge are clipped out of
   existence, which reads as "the tool calls disappeared" and gets worse as the
   conversation grows. Pin every direct child at its natural height and let
   overflow-y do the work it is there to do. */
.dshmc-stage-tile-body > * { flex: 0 0 auto; }
.dshmc-stage-tile-input {
  /* Column: the thumbnail strip stacks ABOVE the controls, so staged images
     never squeeze the textarea's width. */
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--mc-border-subtle);
  flex: none;
}
.dshmc-stage-tile-inputrow { display: flex; gap: 6px; align-items: flex-end; }
.dshmc-stage-tile-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.dshmc-stage-tile-thumb { position: relative; display: inline-flex; }
.dshmc-stage-tile-thumb img {
  width: 44px; height: 44px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--mc-border);
  display: block;
}
.dshmc-stage-tile-thumb-x {
  position: absolute; top: -5px; right: -5px;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%;
  background: var(--mc-bg); color: var(--mc-text);
  box-shadow: 0 0 0 1px var(--mc-border);
  /* Its own step, never a calc() off the control font. */
  font-size: var(--mc-close-glyph);
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.dshmc-stage-tile-thumb-x:hover { color: var(--dsw-alias-state-error-primary, var(--mc-text)); }
.dshmc-stage-tile-attach {
  border: 1px solid var(--mc-border); border-radius: 7px;
  background: transparent; color: var(--mc-text-3);
  /* Square, matching the send button's height so the row keeps one baseline. */
  height: var(--mc-ctl-h); width: var(--mc-ctl-h);
  font-family: inherit; font-size: var(--mc-msg-size); line-height: 1;
  cursor: pointer; flex: none;
}
.dshmc-stage-tile-attach:hover { color: var(--mc-text); border-color: var(--mc-accent); }
.dshmc-stage-tile-input textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  background: var(--mc-input);
  color: var(--mc-text);
  /* font-family only. The "font" shorthand resets font-size, so keeping them as
     separate declarations avoids depending on source order. */
  font-family: inherit;
  /* Matches the message text it composes, not the smaller control font. */
  font-size: var(--mc-msg-size);
  line-height: var(--mc-msg-line);
  /* Two lines of room by default: rows={1} plus a control-height min made this
     a single cramped line on a full-screen surface. */
  min-height: calc(var(--mc-msg-size) * var(--mc-msg-line) * 2 + 18px);
  padding: 8px 11px;
  max-height: 200px;
}
.dshmc-stage-tile-input textarea:focus { outline: none; border-color: var(--mc-accent); }
.dshmc-stage-tile-send {
  border: 0; border-radius: 7px;
  background: var(--dsw-alias-button-info-fill, var(--mc-accent));
  color: var(--mc-on-accent);
  font: inherit; font-size: var(--mc-ctl-font); font-weight: 500;
  /* Fixed height rather than vertical padding: the textarea beside it grows as
     it wraps, and align-items: flex-end keeps their baselines together. */
  height: var(--mc-ctl-h);
  padding: 0 16px;
  cursor: pointer;
  flex: none;
}
.dshmc-stage-tile-send:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--mc-accent-hover)); }
.dshmc-stage-tile-send:disabled { opacity: 0.5; cursor: default; }
.dshmc-stage-tile-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--mc-border-subtle);
  color: var(--mc-text-4);
  font-size: var(--mc-ctl-font-sm);
  flex: none;
}
/* A wait rendered inside its tile — reuses the inbox card, re-scoped to the
   narrower tile column so options wrap instead of overflowing. */
.dshmc-stage-tile-wait {
  border-top: 1px solid var(--mc-border-subtle);
  max-height: 46%;
  overflow: auto;
  flex: 0 0 auto;
}
.dshmc-stage-tile-wait .dshmc-inbox-item {
  border: none;
  border-left: 2px solid var(--mc-amber);
  border-radius: 0;
  background: color-mix(in srgb, var(--mc-amber) 7%, transparent);
  margin: 0;
}
.dshmc-stage-tile-wait .dshmc-q-option { white-space: normal; }
.dshmc-stage-tile-foot .dshmc-time { margin-left: auto; }
.dshmc-stage-tile-error { color: var(--mc-red); }

/* Reduced motion: state colors stay, movement stops */
@media (prefers-reduced-motion: reduce) {
  .dshmc,
  .dshmc-stage,
  .dshmc-row.is-running,
  .dshmc-row.is-waiting,
  .dshmc-row.is-flashing,
  .dshmc-group-live::before,
  .dshmc-dot.running,
  .dshmc-dot.pending,
  .dshmc-reopen.is-live::before,
  .dshmc-reopen.is-waiting::before,
  .dshmc-tile,
  .dshmc-caret-blink,
  .dshmc-stat.is-live,
  .dshmc-stat.is-waiting-live,
  .dshmc-stat.is-swarm-live,
  .dshmc-stat.is-bumped-card,
  .dshmc-stat-value.is-bumped,
  .dshmc-rate,
  .dshmc-pomo.is-running .dshmc-pomo-progress,
  .dshmc-pomo.is-running .dshmc-pomo-pulse,
  .dshmc-pomo.is-ending .dshmc-pomo-clock,
  .dshmc-pomo-dot.on {
    animation: none;
  }
  /* Sweep/sheen overlays are pure motion — remove them entirely */
  .dshmc-row.is-running::after,
  .dshmc-row.is-waiting::after,
  .dshmc-stat.is-live::after,
  .dshmc-stat.is-waiting-live::after,
  .dshmc-stat.is-swarm-live::after {
    content: none;
    animation: none;
  }
  /* Keep the standing state color that the animation would otherwise carry */
  .dshmc-row.is-running { box-shadow: inset 2px 0 0 var(--mc-green); }
  .dshmc-row.is-waiting { box-shadow: inset 2px 0 0 var(--mc-amber); }
  .dshmc-rate { opacity: 1; }
  .dshmc-caret { transition: none; }
  /* The rotation is decorative; aria-expanded still conveys the state. */
  .dshmc-rowcaret { transition: none; }
  /* Phase color survives; only the movement it rode in on is dropped. */
  .dshmc-pomo-progress { transition: none; }
  .dshmc-pomo-pulse { opacity: 1; }
  .dshmc-pomo.is-ending .dshmc-pomo-clock { opacity: 1; }
  .dshmc-pomo-dot,
  .dshmc-pomo-btn,
  .dshmc-pomo-phase,
  .dshmc-pomo-clock { transition: none; }
  .dshmc-pomo-dot.on { transform: none; }
  .dshmc-pomo-btn:hover,
  .dshmc-pomo-btn:active { transform: none; }
  .dshmc-stat { transition: none; }
  .dshmc-stat-value { transition: none; }
}
`

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dennisrongo/dsh-mission-control'
  tag.textContent = PANEL_STYLES
  document.head.appendChild(tag)
}

/**
 * Resolve the live PendingWait carriers for a session, across both harness
 * eras. 0.1.1 carries them on the session snapshot; 0.1.2 dropped `pending`
 * from `buildSnapshot()` and publishes them on `uiSession` instead — so this
 * feeds the permission inbox AND the wait notifications, both of which went
 * silently empty on Desktop without the second read.
 */
function pendingWaitsFor(ctx: ClientContext, sessionId: string): readonly PendingCarrierLike[] {
  try {
    const scoped = ctx.sessions.scope(asSessionId(sessionId))
    const face = scoped ? ctx.sessions.sessionOf(scoped) : undefined
    const snap = face?.getSnapshot?.()
    const fromSnap = (snap?.pending ?? []) as readonly PendingCarrierLike[]
    if (fromSnap.length > 0) return fromSnap
    return uiPendingFor(ctx, sessionId)
  } catch {
    return []
  }
}

/** One selectable answer offered by a question (host: AskUserQuestionOption). */
export interface QuestionOptionLike {
  label: string
  description?: string
}

/** One question in a `question/requested` payload (host: AskUserQuestionItem). */
export interface QuestionItemLike {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOptionLike[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

/** Answer to one question, echoing its caller-provided id. */
export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

/**
 * The pending wait's render face. `payload` is the requested frame's domain
 * fields verbatim, so its shape is kind-dependent: an approval carries
 * toolName/approvalId/reason, a question carries the `questions` array.
 */
interface PendingCarrierLike {
  kind: 'approval' | 'question'
  key: string
  sessionId: string
  payload: {
    toolName?: string
    reason?: string
    approvalId?: string
    callId?: string
    questions?: QuestionItemLike[]
  }
  respond(result: unknown): Promise<{ accepted?: boolean; reason?: string }>
}

/**
 * The questions carried by a wait, normalized defensively — a malformed or
 * absent array yields none rather than throwing mid-render.
 */
export function questionsOf(wait: {
  kind: string
  payload?: { questions?: unknown }
}): readonly QuestionItemLike[] {
  if (wait.kind !== 'question') return []
  const raw = wait.payload?.questions
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (q): q is QuestionItemLike =>
      !!q &&
      typeof (q as QuestionItemLike).id === 'string' &&
      typeof (q as QuestionItemLike).question === 'string',
  )
}

/**
 * Headline for a wait card. A question shows its own text (the first question,
 * plus a count when `ask()` batched several); an approval shows the host's
 * reason, falling back to the tool that needs approval.
 */
export function waitHeadline(wait: {
  kind: string
  payload?: { reason?: string; toolName?: string; questions?: unknown }
}): string {
  const questions = questionsOf(wait)
  if (questions.length > 0) {
    const first = questions[0]!
    const head = first.header ? `${first.header}: ${first.question}` : first.question
    return questions.length > 1 ? `${head} (+${questions.length - 1} more)` : head
  }
  return (
    wait.payload?.reason ??
    (wait.payload?.toolName ? `${wait.payload.toolName} needs approval` : wait.kind)
  )
}

/** Toggle one option label in a draft answer, honoring single vs multi select. */
export function toggleSelection(
  prev: QuestionAnswerItem | undefined,
  id: string,
  label: string,
  multiSelect: boolean,
): QuestionAnswerItem {
  const selected = prev?.selected ?? []
  if (!multiSelect) {
    return { id, selected: selected[0] === label ? [] : [label], custom: prev?.custom }
  }
  const next = selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label]
  return { id, selected: next, custom: prev?.custom }
}

/**
 * Whether an answer draft is submittable: every question resolved by a
 * selection or by free text. A question with no options is text-only.
 */
export function answerComplete(
  questions: readonly QuestionItemLike[],
  draft: Readonly<Record<string, QuestionAnswerItem | undefined>>,
): boolean {
  if (questions.length === 0) return false
  return questions.every((q) => {
    const a = draft[q.id]
    if (!a) return false
    return a.selected.length > 0 || (a.custom ?? '').trim().length > 0
  })
}

/** Build the batch answer payload for a question wait, dropping empty custom text. */
export function buildAnswer(
  questions: readonly QuestionItemLike[],
  draft: Readonly<Record<string, QuestionAnswerItem | undefined>>,
): { answers: QuestionAnswerItem[] } {
  return {
    answers: questions.map((q) => {
      const a = draft[q.id]
      const custom = (a?.custom ?? '').trim()
      const item: QuestionAnswerItem = { id: q.id, selected: a?.selected ?? [] }
      if (custom.length > 0) item.custom = custom
      return item
    }),
  }
}

/** One permission-inbox card: approvals get approve/deny, questions get their real options. */
function InboxItem({ ctx, sessionTitle, wait, onJump }: {
  ctx: ClientContext
  sessionTitle: string
  wait: PendingCarrierLike
  onJump: () => void
}): React.JSX.Element {
  const questions = questionsOf(wait)
  if (questions.length > 0) {
    return <InboxQuestion sessionTitle={sessionTitle} wait={wait} questions={questions} onJump={onJump} />
  }
  return <InboxApproval sessionTitle={sessionTitle} wait={wait} onJump={onJump} />
}

/** Approval card: the host's binary allow/reject outcome. */
function InboxApproval({ sessionTitle, wait, onJump }: {
  sessionTitle: string
  wait: PendingCarrierLike
  onJump: () => void
}): React.JSX.Element {
  const [busy, setBusy] = React.useState<'allow' | 'deny' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const answer = async (outcome: 'allowed-once' | 'rejected') => {
    if (busy) return
    setBusy(outcome === 'allowed-once' ? 'allow' : 'deny')
    setError(null)
    try {
      const receipt = await wait.respond({
        ok: true,
        value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome },
      })
      if (receipt && receipt.accepted === false) setError(receipt.reason ?? 'rejected by host')
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
    }
  }
  const headline = waitHeadline(wait)
  return (
    <div className="dshmc-inbox-item">
      <div className="dshmc-inbox-kind">Approval · {sessionTitle}</div>
      <div className="dshmc-inbox-title" title={headline}>{headline}</div>
      <div className="dshmc-btnrow">
        <button className="dshmc-btn" disabled={busy !== null} onClick={() => void answer('rejected')}>
          {busy === 'deny' ? '…' : 'Deny'}
        </button>
        <button className="dshmc-btn primary" disabled={busy !== null} onClick={() => void answer('allowed-once')}>
          {busy === 'allow' ? '…' : 'Approve'}
        </button>
        <button className="dshmc-btn ghost" disabled={busy !== null} onClick={onJump}>Open</button>
      </div>
      {error ? <div className="dshmc-inbox-error">{error}</div> : null}
    </div>
  )
}

/**
 * Question card: renders each question with its real text and its real options,
 * 1:1 with what the session asked, and responds with the batch answer the
 * user-questions contract expects ({ answers: [{ id, selected, custom? }] }).
 */
function InboxQuestion({ sessionTitle, wait, questions, onJump }: {
  sessionTitle: string
  wait: PendingCarrierLike
  questions: readonly QuestionItemLike[]
  onJump: () => void
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<Record<string, QuestionAnswerItem | undefined>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const pick = (q: QuestionItemLike, label: string) => {
    setDraft((prev) => ({
      ...prev,
      [q.id]: toggleSelection(prev[q.id], q.id, label, q.multiSelect === true),
    }))
  }
  const setCustom = (q: QuestionItemLike, text: string) => {
    setDraft((prev) => ({
      ...prev,
      [q.id]: { id: q.id, selected: prev[q.id]?.selected ?? [], custom: text },
    }))
  }

  const submit = async () => {
    if (busy || !answerComplete(questions, draft)) return
    setBusy(true)
    setError(null)
    try {
      const receipt = await wait.respond({
        ok: true,
        value: { sessionId: wait.sessionId, answer: buildAnswer(questions, draft) },
      })
      if (receipt && receipt.accepted === false) setError(receipt.reason ?? 'rejected by host')
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const ready = answerComplete(questions, draft)
  return (
    <div className="dshmc-inbox-item">
      <div className="dshmc-inbox-kind">Question · {sessionTitle}</div>
      {questions.map((q) => {
        const selected = draft[q.id]?.selected ?? []
        const multi = q.multiSelect === true
        return (
          <div className="dshmc-q" key={q.id}>
            {q.header ? <div className="dshmc-q-header">{q.header}</div> : null}
            <div className="dshmc-q-text">{q.question}</div>
            {q.detail ? <div className="dshmc-q-detail">{q.detail}</div> : null}
            {q.options && q.options.length > 0 ? (
              <div className="dshmc-q-options" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
                {q.options.map((opt) => {
                  const on = selected.includes(opt.label)
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      role={multi ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      disabled={busy}
                      className={`dshmc-q-option${on ? ' is-selected' : ''}`}
                      onClick={() => pick(q, opt.label)}
                    >
                      <span className="dshmc-q-option-label">{opt.label}</span>
                      {opt.description ? (
                        <span className="dshmc-q-option-desc">{opt.description}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <input
              className="dshmc-q-custom"
              type="text"
              disabled={busy}
              value={draft[q.id]?.custom ?? ''}
              placeholder={q.options && q.options.length > 0 ? 'Other…' : 'Your answer…'}
              aria-label={`Custom answer for: ${q.question}`}
              onChange={(e) => setCustom(q, e.target.value)}
            />
          </div>
        )
      })}
      <div className="dshmc-btnrow">
        <button className="dshmc-btn primary" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? '…' : 'Send'}
        </button>
        <button className="dshmc-btn ghost" disabled={busy} onClick={onJump}>Open</button>
      </div>
      {error ? <div className="dshmc-inbox-error">{error}</div> : null}
    </div>
  )
}
function modelTag(sel: ModelSelectionLike | null | undefined): string | undefined {
  if (!sel) return undefined
  const short = sel.model.replace(/^(anthropic\/|openai\/|xai\/|deepseek\/|zai-gl\w*-|glm-)/i, '')
  return sel.reasoningEffort ? `${short}·${sel.reasoningEffort}` : short
}

/** Convenience: read the model-selection snapshot for a session, if loadable. */
function useModelSelection(modelDirs: ModelDirsLike | undefined, sessionId: string): ModelSelectionLike | null {
  let dir: ModelDirectoryLike | undefined
  try {
    dir = modelDirs?.directoryFor(sessionId)
  } catch {
    return null
  }
  const state = useObservable({
    getSnapshot: () => dir?.store.getSnapshot() ?? null,
    subscribe: (fn: () => void) => dir?.store.subscribe(fn) ?? (() => {}),
  })
  return state?.current ?? null
}

/** Read one projection value for a session through the useProjection hook face. */
function useProjectionValue<T>(useProjection: UseProjectionLike | undefined, sessionId: string, key: string): T | undefined {
  const store = React.useMemo(() => {
    if (!useProjection) return undefined
    try {
      return useProjection(sessionId, key)
    } catch {
      return undefined
    }
  }, [useProjection, sessionId, key])
  const value = useObservable({
    getSnapshot: () => (store ? (store.getSnapshot() as T | undefined) : undefined),
    subscribe: (fn: () => void) => store?.subscribe(fn) ?? (() => {}),
  })
  return value
}

/** Lazy per-session model tag: loads the directory on first mount, renders when ready. */
function ModelTag({ modelDirs, sessionId }: { modelDirs: ModelDirsLike | undefined; sessionId: string }): React.JSX.Element | null {
  let dir: ModelDirectoryLike | undefined
  try {
    dir = modelDirs?.directoryFor(sessionId)
  } catch {
    return null
  }
  if (!dir) return null
  return <ModelTagValue dir={dir} sessionId={sessionId} />
}

function ModelTagValue({ dir, sessionId }: { dir: ModelDirectoryLike; sessionId: string }): React.JSX.Element | null {
  const snap = useObservable(dir.store)
  React.useEffect(() => {
    void dir.load().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // update the shared model registry for cost attribution (idempotent map)
  if (snap.current?.model) MODEL_OF_SESSION.set(sessionId, `${snap.current.provider}/${snap.current.model}`)
  const tag = modelTag(snap.current)
  if (!tag) return null
  return <span className="dshmc-tag dshmc-tag-model" title={`${snap.current!.provider}/${snap.current!.model}`}>{tag}</span>
}

/** Global model-per-session registry (filled by ModelTag renders; read by the burn strip). */
const MODEL_OF_SESSION = new Map<string, string>()

// ---------------------------------------------------------------------------
// Pomodoro — break reminder pinned to the panel footer
// ---------------------------------------------------------------------------

/** Default work stretch, in minutes. */
export const DEFAULT_WORK_MINUTES = 25
/** Default short break, in minutes. */
export const DEFAULT_BREAK_MINUTES = 5
/** Work stretches completed before a long break is offered. */
export const POMODORO_LONG_EVERY = 4
/** Default long break, in minutes. */
export const DEFAULT_LONG_BREAK_MINUTES = 15

/** Configurable minute bounds — keeps a corrupt pref or a fat-fingered entry sane. */
export const POMODORO_MIN_MINUTES = 1
export const POMODORO_MAX_MINUTES = 180

export type PomodoroPhase = 'work' | 'break' | 'long'

/**
 * Clamp an untrusted minutes value (persisted prefs and number inputs are both
 * attacker-ish here) to a whole number inside the supported range.
 * @param value - raw candidate, any type.
 * @param fallback - value used when the candidate is not a finite number.
 */
export function normalizeMinutes(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  const whole = Math.round(n)
  if (whole < POMODORO_MIN_MINUTES) return POMODORO_MIN_MINUTES
  if (whole > POMODORO_MAX_MINUTES) return POMODORO_MAX_MINUTES
  return whole
}

/** Configured phase lengths, in minutes. */
export interface PomodoroConfig {
  workMinutes: number
  breakMinutes: number
  longBreakMinutes: number
}

/** Duration of a phase under a config, in ms. */
export function phaseDurationMs(phase: PomodoroPhase, config: PomodoroConfig): number {
  const minutes =
    phase === 'work' ? config.workMinutes
    : phase === 'long' ? config.longBreakMinutes
    : config.breakMinutes
  return normalizeMinutes(minutes, DEFAULT_WORK_MINUTES) * 60_000
}

/** The phase that follows `phase` once `completed` work stretches are done. */
export function nextPhase(phase: PomodoroPhase, completed: number): PomodoroPhase {
  if (phase !== 'work') return 'work'
  return completed > 0 && completed % POMODORO_LONG_EVERY === 0 ? 'long' : 'break'
}

/** Running timer state. `endsAt` is only meaningful while `running`. */
export interface PomodoroState {
  phase: PomodoroPhase
  running: boolean
  /** Wall-clock ms at which the current phase ends (running only). */
  endsAt: number
  /** Ms left when paused. */
  remainingMs: number
  /** Work stretches finished this cycle. */
  completed: number
}

/** A fresh timer parked at the start of a work stretch. */
export function initialPomodoro(config: PomodoroConfig): PomodoroState {
  return {
    phase: 'work',
    running: false,
    endsAt: 0,
    remainingMs: phaseDurationMs('work', config),
    completed: 0,
  }
}

/**
 * The clock value the UI should render with.
 *
 * The shared ticker only samples Date.now() once a second, so a render
 * triggered by a click (start/resume) still holds a `now` from up to 999ms
 * BEFORE the phase began. Reading the timer at that stale instant reports more
 * time left than the phase actually has, and fmtClock's ceil turns it into a
 * "25:01" on a 25:00 phase. Clamping to the phase's real start keeps the
 * readout monotonic and never shows more than the configured duration.
 *
 * @param state - current timer state.
 * @param now - the (possibly stale) tick value.
 */
export function displayNow(state: PomodoroState, now: number): number {
  if (!state.running) return 0
  const startedAt = state.endsAt - state.remainingMs
  return now < startedAt ? startedAt : now
}

/** Ms left in the current phase at `now`, never negative. */
export function remainingOf(state: PomodoroState, now: number): number {
  const left = state.running ? state.endsAt - now : state.remainingMs
  return left > 0 ? left : 0
}

/**
 * Advance the timer to `now`. Pure: given the same inputs it always yields the
 * same next state, so a missed tick (backgrounded tab, sleeping laptop) rolls
 * forward correctly instead of drifting.
 *
 * Returns the state plus which phase, if any, just elapsed — the caller turns
 * that into the notification. Only one boundary is crossed per call: the timer
 * then waits for acknowledgement rather than silently burning through a break.
 *
 * @param state - current timer state.
 * @param now - wall-clock ms.
 * @param config - configured phase lengths.
 */
export function advancePomodoro(
  state: PomodoroState,
  now: number,
  config: PomodoroConfig,
): { state: PomodoroState; elapsed: PomodoroPhase | null } {
  if (!state.running || now < state.endsAt) return { state, elapsed: null }
  const finished = state.phase
  const completed = finished === 'work' ? state.completed + 1 : state.completed
  const upcoming = nextPhase(finished, completed)
  return {
    state: {
      phase: upcoming,
      // Auto-stop at the boundary: a break you didn't notice isn't a break.
      running: false,
      endsAt: 0,
      remainingMs: phaseDurationMs(upcoming, config),
      completed,
    },
    elapsed: finished,
  }
}

/** Start (or resume) the timer at `now`. */
export function startPomodoro(state: PomodoroState, now: number, config: PomodoroConfig): PomodoroState {
  if (state.running) return state
  const left = state.remainingMs > 0 ? state.remainingMs : phaseDurationMs(state.phase, config)
  return { ...state, running: true, endsAt: now + left, remainingMs: left }
}

/** Pause the timer, banking whatever is left. */
export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state
  return { ...state, running: false, endsAt: 0, remainingMs: remainingOf(state, now) }
}

/** Reset the current phase back to its full duration (keeps the cycle count). */
export function resetPomodoro(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  return { ...state, running: false, endsAt: 0, remainingMs: phaseDurationMs(state.phase, config) }
}

/** Skip straight to the next phase without counting the current one as done. */
export function skipPomodoro(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  const completed = state.phase === 'work' ? state.completed + 1 : state.completed
  const upcoming = nextPhase(state.phase, completed)
  return {
    phase: upcoming,
    running: false,
    endsAt: 0,
    remainingMs: phaseDurationMs(upcoming, config),
    completed,
  }
}

/** mm:ss for the footer readout; clamps at 0 and never goes exponential. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** Human label for a phase. */
export function phaseLabel(phase: PomodoroPhase): string {
  return phase === 'work' ? 'Focus' : phase === 'long' ? 'Long break' : 'Break'
}

/** Fraction of the current phase already spent, 0..1 — drives the progress bar. */
export function phaseProgress(state: PomodoroState, now: number, config: PomodoroConfig): number {
  const total = phaseDurationMs(state.phase, config)
  if (total <= 0) return 0
  const done = (total - remainingOf(state, now)) / total
  return done < 0 ? 0 : done > 1 ? 1 : done
}

/**
 * Identity of the parked clock for the duration-edit sync. Deliberately
 * EXCLUDES `running`: the sync exists so an idle timer tracks live edits to
 * its configured length, and keying on the running flag made every pause look
 * like a fresh idle state — the effect then "resynced" remainingMs to the
 * full duration and wiped the banked pause.
 */
export function idleSyncKey(state: PomodoroState, config: PomodoroConfig): string {
  return [
    state.phase,
    phaseDurationMs('work', config),
    phaseDurationMs('break', config),
    phaseDurationMs('long', config),
  ].join(':')
}

/** localStorage key for the persisted timer — separate from panel settings so
 *  a corrupt payload here can never take the settings down with it. */
export const POMODORO_KEY = 'dsh-mission-control:pomodoro'

/** Serialized form: the absolute `endsAt` makes a running timer survive a
 *  restart correctly, since remaining time re-derives from the wall clock. */
export function serializePomodoroState(state: PomodoroState): string {
  return JSON.stringify({
    phase: state.phase,
    running: state.running,
    endsAt: state.endsAt,
    remainingMs: state.remainingMs,
    completed: state.completed,
  })
}

/**
 * Restore a persisted timer, defensive by contract (same posture as
 * parseSettings): any bad shape falls back to a fresh parked timer. Values are
 * clamped into their valid ranges and a parked `remainingMs` can never exceed
 * the phase's currently configured duration, so a duration edit made while the
 * panel was closed cannot resurrect a longer stale remainder.
 *
 * @param raw - the localStorage payload, or null when absent.
 * @param config - current configured phase lengths.
 */
export function parsePomodoroState(raw: string | null, config: PomodoroConfig): PomodoroState {
  const fresh = initialPomodoro(config)
  if (raw === null) return fresh
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return fresh
  }
  if (typeof data !== 'object' || data === null) return fresh
  const d = data as Record<string, unknown>
  const phase = d.phase
  if (phase !== 'work' && phase !== 'break' && phase !== 'long') return fresh
  const running = d.running === true
  const endsAt = typeof d.endsAt === 'number' && Number.isFinite(d.endsAt) && d.endsAt >= 0 ? d.endsAt : 0
  const duration = phaseDurationMs(phase, config)
  const remainingMs =
    typeof d.remainingMs === 'number' && Number.isFinite(d.remainingMs) && d.remainingMs >= 0
      ? Math.min(d.remainingMs, duration)
      : duration
  const completed =
    typeof d.completed === 'number' && Number.isFinite(d.completed) && d.completed >= 0
      ? Math.floor(d.completed)
      : 0
  // A state that claims to be running with no deadline is corrupt: park it
  // with the banked remainder rather than trusting endsAt = 0.
  return running && endsAt > 0
    ? { phase, running, endsAt, remainingMs, completed }
    : { phase, running: false, endsAt: 0, remainingMs, completed }
}

/**
 * Timestamped wrapper around the persisted timer. The timestamp is what lets
 * a freshly mounted panel reconcile its localStorage seed against the
 * host-side cell (the origin-independent copy): the NEWER write wins, so a
 * timer started on another origin — or before a Desktop restart moved the
 * port — is adopted instead of clobbered by the mount.
 */
export interface PomodoroEnvelope {
  updatedAt: number
  state: PomodoroState
}

/** Wrap a timer for persistence at `updatedAt` (wall-clock ms). */
export function packPomodoroEnvelope(state: PomodoroState, updatedAt: number): string {
  return JSON.stringify({ updatedAt, state: JSON.parse(serializePomodoroState(state)) })
}

/**
 * Parse a persisted payload, accepting BOTH the envelope and the legacy bare
 * state written before the envelope existed (which reads as updatedAt 0, so
 * any real write outranks it). Returns null when there is nothing usable —
 * the caller then keeps whatever it already has rather than resetting.
 *
 * @param raw - the stored payload, or null.
 * @param config - current configured phase lengths (for clamping).
 */
export function parsePomodoroEnvelope(raw: string | null, config: PomodoroConfig): PomodoroEnvelope | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  const isEnvelope = typeof d.state === 'object' && d.state !== null
  const body = isEnvelope ? JSON.stringify(d.state) : raw
  const updatedAt =
    isEnvelope && typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) && d.updatedAt >= 0
      ? d.updatedAt
      : 0
  // parsePomodoroState never returns null; it falls back to a fresh timer,
  // which would masquerade as real data here. Reject shape failures first by
  // checking the phase, the one field every genuine state carries.
  const phase = (isEnvelope ? (d.state as Record<string, unknown>) : d).phase
  if (phase !== 'work' && phase !== 'break' && phase !== 'long') return null
  return { updatedAt, state: parsePomodoroState(body, config) }
}

// ---------------------------------------------------------------------------
// Host state bridge
// ---------------------------------------------------------------------------

/**
 * The host's `dshMissionControl` cell, mounted from apply(). localStorage is
 * origin-scoped and DSH Desktop serves the UI from an ephemeral port per
 * launch, so browser storage alone cannot survive a restart — the host cell
 * lives under DSH_HOME and is reached over the Typert bridge from any origin.
 * Everything degrades: with no host half (an older install), the panel runs
 * on localStorage exactly as before.
 */
interface HostStateRemote {
  load(request: Record<string, never>): Promise<{ state: string | null }>
  save(request: { state: string }): Promise<{ ok: true }>
  openTerminal(request: { path: string }): Promise<{ ok: true }>
}

let hostRemote: HostStateRemote | null = null
let hostLoaded = false
let hostPayload: string | null = null
const hostListeners = new Set<(payload: string | null) => void>()

/** Subscribe to the first host load; replays immediately once loaded. */
function onHostState(cb: (payload: string | null) => void): () => void {
  if (hostLoaded) {
    cb(hostPayload)
    return () => {}
  }
  hostListeners.add(cb)
  return () => hostListeners.delete(cb)
}

/** Persist to the host cell; silently skipped when the host half is absent. */
function saveHostState(payload: string): void {
  if (!hostRemote || !hostLoaded) return
  void hostRemote.save({ state: payload }).catch(() => {
    /* host unreachable — localStorage still holds this origin's copy */
  })
}

/** localStorage key for the panel's persisted preferences. */
const SETTINGS_KEY = 'dsh-mission-control:settings'

export interface PanelSettings {
  /** Sessions listed per workspace group; 0 = All. */
  sessionsPerWorkspace: number
  /** How sessions are ordered inside each workspace group. */
  fleetSort: FleetSortOrder
  /** Pomodoro work stretch, in minutes. */
  workMinutes: number
  /** Pomodoro short break, in minutes. */
  breakMinutes: number
  /** Pomodoro long break, in minutes. */
  longBreakMinutes: number
  /** Whether the pomodoro footer is shown at all. */
  pomodoroEnabled: boolean
}

const DEFAULT_SETTINGS: PanelSettings = {
  sessionsPerWorkspace: DEFAULT_SESSIONS_PER_WORKSPACE,
  fleetSort: DEFAULT_FLEET_SORT,
  workMinutes: DEFAULT_WORK_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  longBreakMinutes: DEFAULT_LONG_BREAK_MINUTES,
  pomodoroEnabled: true,
}

/** Parse persisted settings defensively — any bad shape falls back to defaults. */
export function parseSettings(raw: string | null | undefined): PanelSettings {
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<PanelSettings> | null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
    return {
      sessionsPerWorkspace: normalizeSessionLimit(
        parsed.sessionsPerWorkspace ?? DEFAULT_SESSIONS_PER_WORKSPACE,
      ),
      fleetSort: normalizeFleetSort(parsed.fleetSort),
      workMinutes: normalizeMinutes(parsed.workMinutes, DEFAULT_WORK_MINUTES),
      breakMinutes: normalizeMinutes(parsed.breakMinutes, DEFAULT_BREAK_MINUTES),
      longBreakMinutes: normalizeMinutes(parsed.longBreakMinutes, DEFAULT_LONG_BREAK_MINUTES),
      pomodoroEnabled: parsed.pomodoroEnabled !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Panel settings backed by localStorage; storage failures degrade to in-memory. */
function useSettings(): [PanelSettings, (patch: Partial<PanelSettings>) => void] {
  const [settings, setSettings] = React.useState<PanelSettings>(() => {
    try {
      return parseSettings(window.localStorage.getItem(SETTINGS_KEY))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  })
  const update = React.useCallback((patch: Partial<PanelSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        /* private mode / quota — keep the in-memory value */
      }
      return next
    })
  }, [])
  return [settings, update]
}

/** Re-render on an interval while `active`; the panel's shared clock. */
function useTicker(active: boolean, ms: number): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

/**
 * True for `ms` after `value` changes — drives one-shot "the number just moved"
 * flashes. The first observed value never bumps, so mounting is quiet.
 */
function useBump(value: number, ms = 500): boolean {
  const [bumped, setBumped] = React.useState(false)
  const prev = React.useRef(value)
  React.useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setBumped(true)
    const t = setTimeout(() => setBumped(false), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return bumped
}

/** Per-session output-token samples for live rate; latest snapshot value per session. */
const OUT_TOKENS = new Map<string, { at: number; out: number }>()

/** Read the fleet's current output-token total from row projections. */
function fleetOutTokens(list: SessionListStateLike): number {
  let total = 0
  for (const id of list.ids) {
    const usage = (list.byId[id] as { projectionValues?: { tokenUsage?: TokenUsageLike } } | undefined)
      ?.projectionValues?.tokenUsage
    if (usage) total += usage.outputTokens
  }
  return total
}

/**
 * Fleet output-token rate (tok/s), sampled on a 1s tick while anything is
 * active. Feeds the per-row rate readout.
 *
 * This used to also retain a rolling history for the header sparkline; both
 * that chart and the burn strip it lived in are gone, so only the instantaneous
 * rate is kept — retaining a 60-point series nothing renders was pure work on a
 * timer.
 */
function useFleetPulse(active: boolean, list: SessionListStateLike): { rate: number } {
  const now = useTicker(active, 1000)
  const total = fleetOutTokens(list)
  const [pulse, setPulse] = React.useState<{ rate: number; prev?: { at: number; out: number } }>({ rate: 0 })
  React.useEffect(() => {
    if (!active) return
    setPulse((p) => {
      const prev = p.prev ?? { at: now, out: total }
      const elapsed = elapsedSince(prev.at, now)
      // Below the sampling floor the previous rate stands rather than being
      // recomputed from a too-short interval.
      const rate = elapsed >= 900 ? computeRate(prev.out, total, elapsed) : p.rate
      return { rate, prev: { at: now, out: total } }
    })
  }, [now, active, total])
  return pulse
}

/**
 * One session's live output-token rate (tok/s) on a private 1s clock, only
 * ticking while that session runs. Mirrors useFleetPulse's sampling rules.
 */
function useSessionRate(out: number | undefined, active: boolean): { now: number; rate: number } {
  const now = useTicker(active, 1000)
  const [state, setState] = React.useState<{ prev?: { at: number; out: number }; rate: number }>({ rate: 0 })
  React.useEffect(() => {
    if (!active || out === undefined) return
    setState((s) => {
      const prev = s.prev ?? { at: now, out }
      const elapsed = elapsedSince(prev.at, now)
      const rate = elapsed >= 900 ? computeRate(prev.out, out, elapsed) : s.rate
      return { rate, prev: { at: now, out } }
    })
  }, [now, active, out])
  return { now: active ? now : Date.now(), rate: state.rate }
}

/** Per-tile expansion state for tool rows, keyed by chat node key. */
function useOpenTools(): { isOpen: (key: string) => boolean; toggle: (key: string) => void } {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set())
  const isOpen = (key: string) => open.has(key)
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  return { isOpen, toggle }
}

/**
 * Desktop-notify on new pending waits (dedup by wait key).
 *
 * The key lives on the carrier (`wait.key`), not on the wrapper the inbox
 * builds — reading a top-level `key` silently primed `undefined` as seen and
 * suppressed every later notification.
 */
function useWaitNotifications(waits: readonly { wait: { key: string }; title: string }[]): void {
  const seenRef = React.useRef<Set<string>>(new Set())
  const primedRef = React.useRef(false)
  React.useEffect(() => {
    // first run only marks existing waits as seen (no notification storm on load)
    const keyed = waits.map((w) => ({ key: w.wait.key, title: w.title }))
    if (!primedRef.current) {
      primedRef.current = true
      newWaitKeys(keyed, seenRef.current)
      return
    }
    const fresh = newWaitKeys(keyed, seenRef.current)
    if (fresh.length === 0) return
    if (typeof Notification === 'undefined') return
    const notify = () => {
      for (const key of fresh) {
        const w = keyed.find((x) => x.key === key)
        if (!w) continue
        try {
          const n = new Notification('Mission Control — approval needed', {
            body: w.title,
            tag: key,
          })
          n.onclick = () => { window.focus(); n.close() }
        } catch {
          /* notifications unavailable */
        }
      }
    }
    if (Notification.permission === 'granted') notify()
    else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => { if (p === 'granted') notify() })
  }, [waits])
}

/** Live conversation snapshot subset used by grid tiles. */
type ConversationSnapshotLike = {
  running?: boolean
  partial?: unknown
  lastAgentError?: string | null
  /**
   * History-window lifecycle. Only the STAGED (current) session is opened by
   * the host runtime, so every other tile starts 'cold' with an empty chat
   * until we open it ourselves — see useSessionSnapshot.
   */
  openState?: 'cold' | 'loading' | 'open' | 'error'
  chat?: {
    order: readonly string[]
    nodes: { get(key: string): unknown }
  } | null
  /** Turn number -> exact turn/start and optional matching turn/end times. */
  turnTimings?: ReadonlyMap<number, { startTime?: number; endTime?: number }>
  /** Tool calls seen without their result yet — what the agent is executing. */
  runningCalls?: readonly { name?: string; time?: number }[]
  /**
   * Live human-in-the-loop waits parked on this session (approvals and
   * questions). Same carriers the permission inbox renders — reading them off
   * the snapshot keeps a Stage tile reactive without a second subscription.
   */
  pending?: readonly PendingCarrierLike[]
}

/** Unified business-result shape used by the session verbs. */
type RpcLike<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/** One prompt content part: text, or a canonical base64 image. */
type PromptPartLike =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

/** The per-session behavior verbs Mission Control drives (subset of ISession). */
type SessionFaceLike = {
  prompt(
    content: PromptPartLike[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
  ): Promise<RpcLike<{ accepted: true }>>
  cancel(): Promise<RpcLike<{ accepted: true }>>
  rename(title: string): Promise<RpcLike<{ title: string; seq: number }>>
}

/** Resolve the behavior-verb face for a listed session, tolerating pruned scopes. */
function sessionFaceOf(ctx: ClientContext, id: string): SessionFaceLike | undefined {
  try {
    const scoped = ctx.sessions.scope(asSessionId(id))
    const face = scoped ? ctx.sessions.sessionOf(scoped) : undefined
    return (face as SessionFaceLike | undefined) ?? undefined
  } catch {
    return undefined
  }
}

/** Human-readable text for a thrown/Rpc error value. */
function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

/**
 * Row-level actions menu: jump, send (queue/steer), stop, rename, fork, archive.
 * Rendered in a fixed-position popover so panel overflow never clips it.
 */
function RowMenu({
  ctx,
  row,
  root,
  onJump,
}: {
  ctx: ClientContext
  row: FleetRow
  root: boolean
  onJump: () => void
}): React.JSX.Element {
  const [menuPos, setMenuPos] = React.useState<{ left: number; top: number } | null>(null)
  const [pane, setPane] = React.useState<'main' | 'send' | 'rename'>('main')
  const [text, setText] = React.useState('')
  const [title, setTitle] = React.useState(row.title)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const face = React.useMemo(() => sessionFaceOf(ctx, row.id), [ctx, row.id])
  const open = menuPos !== null
  const close = () => {
    setMenuPos(null)
    setPane('main')
    setError(null)
    setText('')
  }

  React.useEffect(() => {
    if (pane === 'send' && areaRef.current) areaRef.current.focus()
    else if (pane === 'rename' && inputRef.current) inputRef.current.focus()
  }, [pane])

  const openMenu = () => {
    setError(null)
    setPane('main')
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const W = 236
    const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8)
    const flip = r.bottom + 260 > window.innerHeight
    const top = flip ? Math.max(8, r.top - 264) : r.bottom + 4
    setMenuPos({ left, top })
  }

  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    fn()
      .catch((e: unknown) => setError(`${label}: ${errText(e)}`))
      .finally(() => setBusy(false))
  }

  const send = () => {
    const body = text.trim()
    if (!body || !face) return
    const mode = row.running ? 'steer' : 'queue'
    run('send', async () => {
      const res = await face.prompt([{ type: 'text', text: body }], mode)
      if (!res.ok) throw new Error(errText(res.error))
      close()
    })
  }

  const stop = () => {
    if (!face) return
    run('stop', async () => {
      const res = await face.cancel()
      if (!res.ok) throw new Error(errText(res.error))
      close()
    })
  }

  const rename = () => {
    const t = title.trim()
    if (!t || !face) return
    run('rename', async () => {
      const res = await face.rename(t)
      if (!res.ok) throw new Error(errText(res.error))
      close()
    })
  }

  const fork = () => {
    run('fork', async () => {
      const child = await ctx.sessions.fork({ sessionId: asSessionId(row.id), increaseTitle: true })
      close()
      ctx.sessions.open(child)
    })
  }

  const archive = () => {
    run('archive', async () => {
      const w = (ctx as unknown as {
        workspaces?: { archiveSession?: (id: string) => Promise<void> }
      }).workspaces
      if (!w?.archiveSession) throw new Error('workspaces face unavailable')
      await w.archiveSession(row.id)
      close()
    })
  }

  return (
    <React.Fragment>
      <button
        ref={btnRef}
        className="dshmc-rowmenu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Session actions"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation()
          if (open) close()
          else openMenu()
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >⋯</button>
      {open ? (
        <React.Fragment>
          <div className="dshmc-backdrop" onClick={close} />
          <div
            className="dshmc-rowmenu"
            role="menu"
            style={menuPos ?? undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {pane === 'main' ? (
              <React.Fragment>
                <button className="dshmc-rowmenu-item" role="menuitem" disabled={busy} onClick={onJump}>Jump to session</button>
                <button className="dshmc-rowmenu-item" role="menuitem" disabled={busy || !face || !root} onClick={() => setPane('send')}>Send message…</button>
                {row.running && root ? (
                  <button className="dshmc-rowmenu-item danger" role="menuitem" disabled={busy || !face} onClick={stop}>Stop (cancel turn)</button>
                ) : null}
                {root ? (
                  <React.Fragment>
                    <button className="dshmc-rowmenu-item" role="menuitem" disabled={busy || !face} onClick={() => setPane('rename')}>Rename…</button>
                    <button className="dshmc-rowmenu-item" role="menuitem" disabled={busy} onClick={fork}>Fork</button>
                    <div className="dshmc-rowmenu-divider" />
                    <button className="dshmc-rowmenu-item danger" role="menuitem" disabled={busy} onClick={archive}>Archive</button>
                  </React.Fragment>
                ) : null}
                {busy ? <div className="dshmc-rowmenu-note">working…</div> : null}
                {error ? <div className="dshmc-rowmenu-error">{error}</div> : null}
              </React.Fragment>
            ) : pane === 'send' ? (
              <div className="dshmc-rowmenu-send">
                <textarea
                  ref={areaRef}
                  value={text}
                  placeholder="Message this session…"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    } else if (e.key === 'Escape') {
                      close()
                    }
                  }}
                />
                <div className="dshmc-rowmenu-send-row">
                  <span className="dshmc-rowmenu-send-mode">{row.running ? 'steer · interrupts current turn' : 'queue · starts a new turn'}</span>
                  <button className="dshmc-rowmenu-send-btn" disabled={busy || !text.trim()} onClick={send}>{busy ? '…' : 'Send'}</button>
                </div>
                {error ? <div className="dshmc-rowmenu-error">{error}</div> : null}
              </div>
            ) : (
              <div className="dshmc-rowmenu-send">
                <input
                  ref={inputRef}
                  className="dshmc-rename-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename()
                    else if (e.key === 'Escape') close()
                  }}
                />
                <div className="dshmc-rowmenu-send-row">
                  <span className="dshmc-rowmenu-send-mode">Pins the title</span>
                  <button className="dshmc-rowmenu-send-btn" disabled={busy || !title.trim()} onClick={rename}>{busy ? '…' : 'Save'}</button>
                </div>
                {error ? <div className="dshmc-rowmenu-error">{error}</div> : null}
              </div>
            )}
          </div>
        </React.Fragment>
      ) : null}
    </React.Fragment>
  )
}

/** Content search over all sessions (`session.search`), jumping on click. */
function SearchBox({
  ctx,
  list,
  onOpen,
}: {
  ctx: ClientContext
  list: SessionListStateLike
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<{ sessionId: string; snippet: string }[] | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      // Client-side title matches are always available and instant.
      const needle = q.toLowerCase()
      const titleHits: { sessionId: string; snippet: string }[] = []
      for (const id of list.ids) {
        const row = list.byId[id]
        if (!row) continue
        if ((row.displayTitle ?? '').toLowerCase().includes(needle)) {
          titleHits.push({ sessionId: id, snippet: 'title match' })
        }
        if (titleHits.length >= 8) break
      }
      const merge = (items: { sessionId: string; snippet: string }[]) => {
        const seen = new Set<string>()
        const merged: { sessionId: string; snippet: string }[] = []
        for (const item of items.slice(0, 8)) {
          if (seen.has(item.sessionId)) continue
          seen.add(item.sessionId)
          merged.push(item)
        }
        for (const h of titleHits) {
          if (seen.has(h.sessionId)) continue
          if (merged.length >= 8) break
          seen.add(h.sessionId)
          merged.push(h)
        }
        return merged
      }
      // Content search can block through a host-side index reconcile; show
      // title matches fast, then let content hits supersede when they land.
      const slowTimer = window.setTimeout(() => {
        if (!ctrl.signal.aborted) {
          setSearching(false)
          setResults(titleHits)
        }
      }, 1500)
      ctx.sessions
        .search(q, ctrl.signal)
        .then((res) => {
          window.clearTimeout(slowTimer)
          if (ctrl.signal.aborted) return
          setSearching(false)
          // Content hits take precedence; title-only matches fill the rest.
          if (res.ok) setResults(merge(res.value.items))
          else setResults(titleHits)
        })
        .catch(() => {
          window.clearTimeout(slowTimer)
          if (ctrl.signal.aborted) return
          setSearching(false)
          setResults(titleHits)
        })
    }, 250)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [query, ctx, list])

  return (
    <div className="dshmc-search">
      <input
        className="dshmc-search-input"
        value={query}
        placeholder="Search sessions…"
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching ? <div className="dshmc-rowmenu-note">searching…</div> : null}
      {error !== null && !searching ? (
        <div className="dshmc-rowmenu-error">Search error: {error}</div>
      ) : results !== null && !searching ? (
        results.length === 0 ? (
          <div className="dshmc-rowmenu-note">No matches.</div>
        ) : (
          results.map((r) => (
            <div
              key={r.sessionId}
              className="dshmc-search-result"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpen(r.sessionId)
              }}
            >
              <span className="dshmc-search-result-title">
                {list.byId[r.sessionId]?.displayTitle ?? r.sessionId}
              </span>
              <span className="dshmc-search-result-snippet">{r.snippet}</span>
            </div>
          ))
        )
      ) : null}
    </div>
  )
}

/**
 * Whether a tile must pull this session's history window itself.
 *
 * The host opens the window for the STAGED session only, so an off-stage
 * session sits at 'cold' with an empty chat. 'loading'/'open' are already
 * handled by the host; 'error' is left alone so a failing session is not
 * retried on every snapshot flush. An absent openState means the face
 * predates the field — treat it as cold, since open() is idempotent.
 */
export function shouldOpenHistory(openState: string | undefined): boolean {
  return openState === undefined || openState === 'cold'
}

/** How many times one tile re-arms a window whose open() failed. */
export const HISTORY_RETRY_LIMIT = 3

/**
 * Whether a tile should re-arm a history window that FAILED to open.
 *
 * `shouldOpenHistory` deliberately refuses to retry 'error' on every snapshot
 * flush — that would hammer a genuinely broken session once per render. But
 * the host only retries a failed open when the session is next *staged*
 * (`followCurrent`), and a stage tile is by definition never staged. So a
 * transient failure — open() racing a reconnect's `resync`, or a blip while
 * the socket is down — left the tile permanently on "status only", and the
 * only way out was opening the conversation, which is exactly the workaround
 * the fallback copy tells the user to perform.
 *
 * Retry is therefore budgeted per mount rather than per flush: a bounded
 * number of attempts clears a transient failure, and a session that is truly
 * unreadable still settles instead of retrying forever.
 */
export function shouldRetryHistory(openState: string | undefined, attempts: number): boolean {
  return openState === 'error' && attempts < HISTORY_RETRY_LIMIT
}

/** The session face as this plugin reads it: uSES source plus history-open. */
type SnapshotFaceLike = {
  getSnapshot(): ConversationSnapshotLike
  subscribe(fn: () => void): () => void
  /**
   * First open: pull the tail history page. Idempotent on the host side — an
   * already-open or in-flight window resolves without a second fetch.
   */
  open?: () => Promise<void> | void
}

/** Chat view target as `uiConversation` publishes it (harness >= 0.1.2). */
type ChatViewSource = {
  getSnapshot(): ChatSnapshotLike | undefined
  subscribe(fn: () => void): () => void
}

/** The `{ order, nodes }` pair `extractTail` walks, from either harness era. */
type ChatSnapshotLike = { order: readonly string[]; nodes: { get(key: string): unknown } }

/**
 * Resolve the chat view for one session across BOTH harness generations.
 *
 * Up to 0.1.1-rc.2 the Session snapshot carried the whole conversation, so
 * `snap.chat` was the transcript. In 0.1.2-alpha.1 `buildSnapshot()` was
 * reduced to status only — `chat`, `views`, `nodes`, `turnTimings`, `partial`
 * and `runningCalls` all left the session face — and assembly moved to the
 * `uiConversation` service, which hands out one `BoundConversation` per
 * session whose `target('chat')` is an ObservableSnapshot of the same
 * `{ order, nodes }` shape. Reading only `snap.chat` therefore yields an
 * empty tile on 0.1.2: not an empty session, a relocated API.
 *
 * DSH Desktop bundles its own harness and upgraded ahead of the dsh CLI, so
 * both eras are live on this machine at once and the tile must satisfy the
 * repo's two-surface rule. `uiConversation` is optional and read defensively:
 * `ctx.get` yields undefined rather than throwing on the older harness.
 *
 * @param ctx - the plugin's client context.
 * @param id - session whose transcript the tile renders.
 * @returns the 0.1.2 chat source, or undefined to fall back to `snap.chat`.
 */
export function chatViewSource(ctx: ClientContext, id: string | undefined): ChatViewSource | undefined {
  if (!id) return undefined
  try {
    const ui = (ctx as unknown as { get(name: string): unknown }).get('uiConversation') as {
      binding(source: string): { target(target: string): ChatViewSource } | undefined
    } | undefined
    // Absent on <= 0.1.1: the caller keeps reading snap.chat.
    if (ui === undefined || typeof ui.binding !== 'function') return undefined
    // Throws for a session the controller does not know; an unlisted tile
    // simply has no transcript rather than taking down the overlay.
    return ui.binding(id)?.target('chat')
  } catch {
    return undefined
  }
}

/**
 * Whether NEITHER transcript source exists on this harness.
 *
 * `uiConversation` ships no published `.d.ts` (0.1.2-alpha.1 declares types in
 * `files` but the built packages contain none), so it is an OBSERVED API read
 * out of the shipped bundle rather than a promised contract, and a later alpha
 * may rename or move it without that being a breaking change on their part.
 * If that happens the tile would silently fall back to an empty chat — the
 * exact indistinguishable-from-idle symptom this whole class of bug produces.
 *
 * So the absence of both sources is stated as its own condition: an open
 * window that produced no chat container at all is a HARNESS mismatch, not an
 * empty session, and the tile says so instead of implying the session is idle.
 *
 * @param openState - history-window lifecycle from the session face.
 * @param hasChatSource - whether either era's chat container resolved.
 * @returns whether to report the transcript as unsupported here.
 */
export function transcriptUnavailable(openState: string | undefined, hasChatSource: boolean): boolean {
  return openState === 'open' && !hasChatSource
}

/** Image media types the harness accepts on a prompt (its own allowlist). */
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** `accept` for the file picker, kept in step with the allowlist above. */
const IMAGE_ACCEPT = IMAGE_MEDIA_TYPES.join(',')

/**
 * Whether the harness will accept this file as a prompt image.
 *
 * The host throws `UnsupportedImageMediaTypeError` on anything outside its
 * allowlist, so a tile filters first rather than letting a stray HEIC or SVG
 * reject the whole send.
 *
 * @param type - the file's MIME type.
 * @returns whether it is an accepted prompt image.
 */
export function isPromptImage(type: string | undefined): boolean {
  return type !== undefined && IMAGE_MEDIA_TYPES.includes(type)
}

/** One image staged in the tile composer, with its preview object URL. */
export interface DraftImage {
  id: string
  file: File
  previewUrl: string
  name?: string
}

/**
 * Encode one browser file as the canonical base64 image prompt part.
 *
 * Deliberately reimplemented rather than borrowed from `conversation`: that
 * service ships no published types, and `sendSession` also drives the
 * optimistic-echo path (`beginSubmission`) which does not exist on 0.1.1. The
 * wire shape itself — `{ type: 'image', mediaType, data, name? }` — is what
 * `session.prompt` takes on BOTH harness eras, and it is the same fallback the
 * host's own composer uses for subagent sessions, so encoding here keeps image
 * sending working on either harness with no unpublished dependency.
 *
 * @param file - a browser file already filtered by isPromptImage.
 * @returns the base64 prompt part.
 */
export async function encodePromptImage(file: File): Promise<{ type: 'image'; mediaType: string; data: string; name?: string }> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  // Chunked to keep a large paste off the argument-count limit of apply().
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return {
    type: 'image',
    mediaType: file.type,
    data: btoa(binary),
    ...(file.name === '' ? {} : { name: file.name }),
  }
}

/**
 * Read a live session conversation snapshot (undefined until scoped/opened).
 *
 * Scope resolution is pure, but the host's history window is *stage-driven*:
 * `SessionRuntime.followCurrent` calls `session.open()` for the CURRENT
 * session only. A resolved-but-never-staged session therefore reports
 * `openState: 'cold'` with an empty chat — which is why off-stage tiles used
 * to render status only. We open the window ourselves, in an effect (never
 * during render, so StrictMode double-invokes and discarded concurrent passes
 * stay side-effect free). `open()` is idempotent, so this costs one tail page
 * per session and no-ops for the staged one.
 */
function useSessionSnapshot(ctx: ClientContext, id: string | undefined): ConversationSnapshotLike | undefined {
  const obs = React.useMemo(() => {
    if (!id) return undefined
    try {
      // The scoped session face assembles the live conversation for any
      // listed session (not just the current selection).
      const scoped = ctx.sessions.scope(asSessionId(id))
      const face = scoped ? ctx.sessions.sessionOf(scoped) : undefined
      if (face) return face as unknown as SnapshotFaceLike
      return ctx.sessions.binding(asSessionId(id))?.session as unknown as SnapshotFaceLike | undefined
    } catch {
      return undefined
    }
  }, [ctx, id])
  const [snap, setSnap] = React.useState<ConversationSnapshotLike | undefined>(() => obs?.getSnapshot())
  React.useEffect(() => {
    setSnap(obs?.getSnapshot())
    if (!obs) return
    return obs.subscribe(() => setSnap(obs.getSnapshot()))
  }, [obs])
  // On 0.1.2 the transcript is a SEPARATE observable from the status snapshot,
  // so it needs its own subscription; on 0.1.1 this resolves to undefined and
  // the session snapshot's own `chat` is used unchanged.
  const chatSrc = React.useMemo(() => chatViewSource(ctx, id), [ctx, id])
  const [chat, setChat] = React.useState<ChatSnapshotLike | undefined>(() => {
    try { return chatSrc?.getSnapshot() } catch { return undefined }
  })
  React.useEffect(() => {
    if (!chatSrc) { setChat(undefined); return }
    const read = () => {
      try { setChat(chatSrc.getSnapshot()) } catch { setChat(undefined) }
    }
    read()
    return chatSrc.subscribe(read)
  }, [chatSrc])
  // Hydrate the history window for sessions the shell never staged.
  //
  // A failed open leaves openState 'error', and the host only retries when the
  // session is next STAGED — which never happens for a stage tile. So we also
  // re-arm a bounded number of times ourselves, keyed on the observed state so
  // the effect re-runs when a window transitions into 'error'. Without this a
  // transient failure pinned the tile on "status only" for the life of the
  // mount. Attempts are counted per face, so remounting the stage grants a
  // fresh budget while a single mount cannot spin.
  const retries = React.useRef(0)
  React.useEffect(() => { retries.current = 0 }, [obs])
  const openState = snap?.openState
  React.useEffect(() => {
    if (!obs || typeof obs.open !== 'function') return
    try {
      const state = obs.getSnapshot()?.openState
      const retry = shouldRetryHistory(state, retries.current)
      if (!shouldOpenHistory(state) && !retry) return
      if (retry) retries.current += 1
      void Promise.resolve(obs.open()).catch(() => undefined)
    } catch {
      /* history open unavailable — the tile degrades to status only */
    }
  }, [obs, openState])
  // Present one shape to every consumer regardless of harness era: the status
  // fields always come from the session face, and `chat` from whichever source
  // owns it. Identity is preserved when there is nothing to merge so the
  // existing `useMemo([snap])` consumers keep their caching.
  return React.useMemo(() => {
    if (!snap || !chatSrc) return snap
    return { ...snap, chat } as ConversationSnapshotLike
  }, [snap, chatSrc, chat])
}

export interface ToolDetail {
  name: string
  running: boolean
  argsRaw?: string
  startedAt?: number
  endedAt?: number
  resultText?: string
  isError?: boolean
  error?: string
  subCalls?: number
}

/**
 * Detail card for one tool row. `data.root` is the call's lifecycle block:
 * a RunningToolCall while in flight, a ToolResultNode once settled — the
 * settled node carries the paired call head (name/args), `callTime` for
 * duration, text content, and error info.
 */
export function toolDetailOf(root: unknown): ToolDetail {
  const r = root as {
    kind?: string
    name?: string
    label?: string
    title?: string
    callId?: string
    argsRaw?: string
    time?: number
    callTime?: number | null
    call?: { name?: string; argsRaw?: string } | null
    content?: { type?: string; text?: string }[]
    isError?: boolean
    error?: { name?: string; code?: string }
    subCalls?: readonly unknown[]
  }
  const subs = Array.isArray(r.subCalls) ? r.subCalls.length : undefined
  if (r.kind === 'tool-result') {
    const texts = Array.isArray(r.content)
      ? r.content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n')
      : ''
    return {
      name: r.call?.name ?? r.name ?? r.label ?? r.title ?? r.callId ?? 'tool',
      running: false,
      argsRaw: r.call?.argsRaw ?? r.argsRaw,
      startedAt: r.callTime ?? undefined,
      endedAt: r.time,
      resultText: texts !== '' ? texts.slice(0, 800) : undefined,
      isError: !!r.isError,
      error: r.error ? `${r.error.name ?? 'error'} ${r.error.code ?? ''}`.trim() : undefined,
      subCalls: subs,
    }
  }
  return {
    name: r.name ?? r.label ?? r.title ?? r.callId ?? 'tool',
    running: true,
    argsRaw: r.argsRaw,
    startedAt: r.time,
    subCalls: subs,
  }
}

export interface TailEntry {
  key: string
  kind: string
  text: string
  tool?: ToolDetail
}

/**
 * Derive a simplified message tail (last `limit` entries) from a live
 * conversation snapshot. Used by the stage's StageTile to read the chat
 * node store consistently.
 *
 * Chat nodes are view nodes (`{ kind, visibility, data, … }`): payloads live
 * under `data`. user/steering carry `content` (ContentBlock, `type`-tagged),
 * assistant steps carry `blocks` (AssistantBlock, `kind`-tagged), tool calls
 * carry `root` (ToolCallBlock — `name` is the tool), errors carry `message`.
 *
 * `maxChars` is OPT-IN (`undefined` = no truncation). Stage is a conversation
 * view, not a preview card: a character cap there cuts a message mid-sentence
 * and — because the text is rendered as markdown — can slice a `**` or a fence
 * off its partner, so the leftover delimiter renders literally. Clipping is a
 * caller's decision, and the tile scroller plus the `limit` entry cap are what
 * actually bound the DOM.
 */
export function extractTail(
  snap: ConversationSnapshotLike | undefined,
  limit: number,
  maxChars?: number,
): TailEntry[] {
  if (!snap?.chat) return []
  const out: TailEntry[] = []
  /** ContentBlock[] (`type`-tagged) → joined text blocks. */
  const contentText = (blocks: unknown): string => {
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((b) => (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join(' ')
  }
  /** AssistantBlock[] (`kind`-tagged) → joined text + reasoning blocks. */
  const assistantText = (blocks: unknown): string => {
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((b) => {
        const k = (b as { kind?: string; type?: string }).kind ?? (b as { type?: string }).type
        return k === 'text' || k === 'reasoning'
      })
      .map((b) => (b as { text?: string }).text ?? '')
      .join(' ')
  }
  try {
    for (const key of snap.chat.order) {
      const node = snap.chat.nodes.get(key)
      if (!node) continue
      if ((node as { visibility?: string }).visibility === 'hidden') continue
      const kn = (node as { kind?: string }).kind
      const data = ((node as { data?: unknown }).data ?? node) as Record<string, unknown>
      let text = ''
      let kind = 'assistant'
      let tool: ToolDetail | undefined
      const clip = (s: string): string => (maxChars === undefined ? s : s.slice(0, maxChars))
      if (kn === 'user' || kn === 'steering') {
        kind = 'user'
        text = clip(contentText(data.content))
      } else if (kn === 'assistant-step' || kn === 'assistant') {
        kind = 'assistant'
        text = clip(assistantText(data.blocks))
      } else if (kn === 'tool-call' || kn === 'tool-result') {
        kind = 'tool'
        tool = toolDetailOf(data.root ?? data)
        text = tool.name
      } else if (kn === 'turn-error' || kn === 'turn-max-tokens' || kn === 'model-retry') {
        kind = 'err'
        const current = (data.current ?? data) as { message?: unknown; detail?: unknown }
        text = String(current.message ?? current.detail ?? kn)
      } else {
        continue // turn-tail, manual-compaction, inbox, context, unknown — chrome, not content
      }
      if (text.trim() !== '') out.push({ key, kind, text, tool })
    }
  } catch {
    /* node store read failure — tile stays silent */
  }
  return out.slice(-limit)
}

export interface LlmActivity {
  phase: 'waiting' | 'reasoning' | 'streaming' | 'tools'
  elapsedMs: number
  detail: string
}

/**
 * What the LLM is doing right now in a running conversation:
 * `tools` — a tool call is in flight (deduped names ride `detail`);
 * `reasoning` / `streaming` — the live partial's last visible block kind;
 * `waiting` — the model was called but nothing visible has arrived yet
 * (time-to-first-token). Elapsed rides the current turn's start time,
 * falling back to the oldest running call's log time. Null when not running.
 */
export function llmActivityOf(snap: ConversationSnapshotLike | undefined, now: number): LlmActivity | null {
  if (!snap?.running) return null
  const calls = snap.runningCalls ?? []
  if (calls.length > 0) {
    const names: string[] = []
    let at = Infinity
    for (const c of calls) {
      const n = c.name ?? 'tool'
      if (!names.includes(n)) names.push(n)
      if (c.time !== undefined && c.time < at) at = c.time
    }
    const detail = names.slice(0, 2).join(' + ') + (names.length > 2 ? ` +${names.length - 2}` : '')
    return { phase: 'tools', elapsedMs: elapsedSince(Number.isFinite(at) ? at : undefined, now), detail }
  }
  const blocks = Array.isArray((snap.partial as { blocks?: unknown } | null)?.blocks)
    ? ((snap.partial as { blocks: { kind?: string; text?: string }[] }).blocks)
    : []
  const content = blocks.filter((b) => (b.kind === 'text' || b.kind === 'reasoning') && (b.text ?? '') !== '')
  const partialTurn = (snap.partial as { turn?: number } | null)?.turn
  let start = partialTurn !== undefined ? snap.turnTimings?.get(partialTurn)?.startTime : undefined
  if (start === undefined && snap.turnTimings) {
    // no partial yet — clock from the newest turn that has not ended
    let openTurn = -1
    for (const [turn, t] of snap.turnTimings) {
      if (t.endTime === undefined && t.startTime !== undefined && turn > openTurn) {
        openTurn = turn
        start = t.startTime
      }
    }
  }
  const elapsedMs = elapsedSince(start, now)
  if (content.length > 0) {
    return { phase: content[content.length - 1]!.kind === 'reasoning' ? 'reasoning' : 'streaming', elapsedMs, detail: '' }
  }
  return { phase: 'waiting', elapsedMs, detail: '' }
}

/**
 * One tail message in a tile. Assistant text renders through the host's own
 * MarkdownText (chat-identical formatting) when the primitives package is
 * available; user/tool/error rows stay plain, matching chat's treatment.
 */
function TileMessage({ kind, text, streaming = false }: {
  kind: string
  text: string
  streaming?: boolean
}): React.JSX.Element {
  if (kind === 'assistant' && MarkdownText) {
    return (
      <div className="dshmc-tile-msg assistant dshmc-md">
        <MarkdownText text={text} streaming={streaming} labels={MARKDOWN_LABELS} />
        {streaming ? <span className="dshmc-caret-blink">▍</span> : null}
      </div>
    )
  }
  return <div className={`dshmc-tile-msg ${kind}`}>{text}{streaming ? <span className="dshmc-caret-blink">▍</span> : null}</div>
}

/**
 * Live LLM activity line for a tile: what the model is doing right now —
 * waiting for first token, thinking, streaming (with tok/s), or the tool in
 * flight — with elapsed time on the tile's 1s clock.
 */
function LlmStatus({ activity, rate }: { activity: LlmActivity | null; rate: number }): React.JSX.Element | null {
  if (!activity) return null
  const label =
    activity.phase === 'tools'
      ? activity.detail
      : activity.phase === 'waiting'
        ? 'waiting for model'
        : activity.phase === 'reasoning'
          ? 'thinking'
          : 'streaming'
  return (
    <div className="dshmc-llm" role="status" aria-label={`LLM ${label}`}>
      <span className="dshmc-dot running" aria-hidden="true" />
      <span className="dshmc-llm-label">{label}</span>
      {activity.elapsedMs > 0 ? <span className="dshmc-llm-time">{fmtMs(activity.elapsedMs)}</span> : null}
      {activity.phase === 'streaming' && rate > 0 ? (
        <span className="dshmc-llm-rate">{Math.round(rate)} tok/s</span>
      ) : null}
    </div>
  )
}

/** Pretty-print a raw JSON args string; falls back to the raw text. */
function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/**
 * Expandable tool row: the head shows name, live/total duration, and the
 * sub-call count; expanding reveals the call args and the settled result
 * (text content, error info) when the window still carries them.
 */
function ToolMessage({ detail, now, expanded, onToggle }: {
  detail: ToolDetail
  now: number
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const dur = detail.running
    ? detail.startedAt !== undefined
      ? elapsedSince(detail.startedAt, now)
      : undefined
    : detail.endedAt !== undefined && detail.startedAt !== undefined
      ? elapsedSince(detail.startedAt, detail.endedAt)
      : undefined
  const badge = detail.isError ? 'failed' : detail.running ? 'running' : 'done'
  const args = detail.argsRaw ? prettyArgs(detail.argsRaw) : undefined
  const clippedArgs = args !== undefined && args.length > 4000 ? `${args.slice(0, 4000)}\n…` : args
  return (
    <div className={`dshmc-tool${detail.isError ? ' is-err' : ''}`}>
      <button
        type="button"
        className="dshmc-tool-head"
        onClick={onToggle}
        aria-expanded={expanded}
        title={detail.argsRaw ?? detail.name}
      >
        <span className="dshmc-tool-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="dshmc-tool-name">{detail.name}</span>
        <span className={`dshmc-tool-badge ${badge}`}>
          {badge}
          {dur !== undefined && dur > 0 ? ` ${fmtMs(dur)}` : ''}
        </span>
        {detail.subCalls ? <span className="dshmc-tool-subs" title="sub-calls">↳{detail.subCalls}</span> : null}
      </button>
      {expanded ? (
        <div className="dshmc-tool-body">
          {clippedArgs !== undefined ? <pre className="dshmc-tool-args">{clippedArgs}</pre> : null}
          {detail.error ? <div className="dshmc-tool-error">{detail.error}</div> : null}
          {detail.resultText ? <pre className="dshmc-tool-result">{detail.resultText}</pre> : null}
          {clippedArgs === undefined && !detail.resultText && !detail.error ? (
            <div className="dshmc-tool-none">no details in window</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Best-effort text from a partial assistant stream (AssistantBlock[] are `kind`-tagged). */
function partialText(p: unknown): string {
  try {
    const po = p as { text?: string; blocks?: { kind?: string; type?: string; text?: string }[] }
    if (typeof po.text === 'string' && po.text !== '') return po.text.slice(-300)
    if (Array.isArray(po.blocks)) {
      return po.blocks
        .filter((b) => {
          const k = b.kind ?? b.type
          return k === 'text' || k === 'reasoning'
        })
        .map((b) => b.text ?? '')
        .join(' ')
        .slice(-300)
    }
  } catch {
    /* unreadable partial */
  }
  return ''
}


/**
 * Last unhandled error signal in a conversation snapshot. Trailing-node rule:
 * any user/assistant/tool node after the error means it was already handled.
 * History only exists for sessions opened in this window (host contract).
 */
export function lastErrorOf(snap: ConversationSnapshotLike | undefined): { kind: string; text: string } | null {
  if (!snap) return null
  const order = snap.chat?.order
  const nodes = snap.chat?.nodes
  if (order && nodes) {
    for (let i = order.length - 1; i >= 0; i--) {
      let node: unknown
      try {
        node = nodes.get(order[i])
      } catch {
        return null
      }
      const kn = (node as { kind?: string } | undefined)?.kind
      // Chat chrome (footer rows, compaction cards, context injections) is not
      // conversation content — it never counts as handling a trailing error.
      if (!kn || kn === 'manual-compaction' || kn === 'compaction' || kn === 'unknown' || kn === 'context' || kn === 'turn-tail') continue
      if (kn === 'turn-error' || kn === 'turn-max-tokens' || kn === 'model-retry') {
        // View nodes carry their payload under `data`; model-retry nests the
        // live attempt under `data.current`.
        const data = ((node as { data?: unknown }).data ?? node) as { message?: unknown; detail?: unknown; current?: { message?: unknown; detail?: unknown } }
        const current = data.current ?? data
        const text = String(current.message ?? current.detail ?? kn)
        return { kind: kn === 'turn-max-tokens' ? 'max tokens' : kn === 'model-retry' ? 'model retry' : 'error', text }
      }
      return null
    }
    return null
  }
  const le = snap.lastAgentError
  if (typeof le === 'string' && le !== '') return { kind: 'agent error', text: le }
  return null
}

/** Pending row without a resolvable wait carrier (e.g. plan review). */
function PendingRow({ title, kind, onJump }: { title: string; kind: string; onJump: () => void }): React.JSX.Element {
  return (
    <div className="dshmc-inbox-item" role="button" tabIndex={0} onClick={onJump}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onJump() }}>
      <div className="dshmc-inbox-kind">{kind} · {title}</div>
      <div className="dshmc-inbox-title">Open the session to respond</div>
      <div className="dshmc-btnrow"><button className="dshmc-btn ghost">Open</button></div>
    </div>
  )
}

/** One attention card: a recent session whose conversation ended on an error. */
function AttentionCard({ ctx, row, onOpen, report }: {
  ctx: ClientContext
  row: SessionLike
  onOpen: () => void
  report: (id: string, has: boolean) => void
}): React.JSX.Element | null {
  const snap = useSessionSnapshot(ctx, row.id)
  const err = lastErrorOf(snap)
  React.useEffect(() => {
    report(row.id, err !== null)
    return () => report(row.id, false)
  }, [err, row.id, report])
  if (!err) return null
  return (
    <div className="dshmc-inbox-item is-attention" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen() }}>
      <div className="dshmc-inbox-kind">{err.kind} · {row.displayTitle}</div>
      <div className="dshmc-inbox-title">{err.text.slice(0, 200)}</div>
      <div className="dshmc-btnrow"><button className="dshmc-btn ghost">Open</button></div>
    </div>
  )
}

/**
 * Inbox mode: the triage surface. Waiting-on-you cards with inline
 * approve/deny, plus an attention scan over recent sessions that ended on an
 * error. Inbox zero when nothing needs a decision.
 */
function InboxView({ ctx, list, pendingRows, pendingWaits, counts, onOpen, now }: {
  ctx: ClientContext
  list: SessionListStateLike
  pendingRows: SessionLike[]
  pendingWaits: { wait: PendingCarrierLike; title: string }[]
  counts: { sessions: number; running: number; subagents: number }
  onOpen: (id: string) => void
  now: number
}): React.JSX.Element {
  const waitBySession = new Map(pendingWaits.map(({ wait }) => [wait.sessionId, wait] as const))
  const bare = pendingRows.filter((s) => !waitBySession.has(s.id))
  const ATTENTION_MS = 6 * 60 * 60 * 1000
  const candidates = React.useMemo(
    () =>
      list.ids
        .map((id) => list.byId[id])
        .filter(
          (s): s is SessionLike =>
            s !== undefined &&
            !s.blank &&
            s.origin !== 'subagent' &&
            !s.running &&
            s.pendingInteraction === undefined &&
            !s.completed &&
            now - (s.updatedAt ?? 0) < ATTENTION_MS,
        )
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 12),
    [list, now],
  )
  const [attentionIds, setAttentionIds] = React.useState<ReadonlySet<string>>(new Set())
  const report = React.useCallback((id: string, has: boolean) => {
    setAttentionIds((prev) => {
      const had = prev.has(id)
      if (has === had) return prev
      const next = new Set(prev)
      if (has) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const zero = pendingRows.length === 0 && attentionIds.size === 0
  return (
    <div>
      <div className="dshmc-section">Waiting on you</div>
      {pendingRows.length === 0 ? (
        <div className="dshmc-empty">Nothing is blocked on a decision.</div>
      ) : (
        <React.Fragment>
          {pendingWaits.map(({ wait, title }) => (
            <InboxItem
              key={wait.key}
              ctx={ctx}
              sessionTitle={title}
              wait={wait}
              onJump={() => onOpen(wait.sessionId)}
            />
          ))}
          {bare.map((s) => (
            <PendingRow key={s.id} title={s.displayTitle} kind={s.pendingInteraction ?? 'waiting'} onJump={() => onOpen(s.id)} />
          ))}
        </React.Fragment>
      )}
      <div className="dshmc-section">Attention</div>
      {candidates.map((s) => (
        <AttentionCard key={s.id} ctx={ctx} row={s} onOpen={() => onOpen(s.id)} report={report} />
      ))}
      <div className="dshmc-inbox-note">
        Scans sessions touched in the last 6h whose conversation ended on an error — history only exists for sessions opened in this window.
      </div>
      {zero ? (
        <div className="dshmc-inbox-zero">
          <div className="dshmc-inbox-zero-mark">✓</div>
          <div>Inbox zero — nothing needs you.</div>
          <div className="dshmc-sub"><b>{counts.running}</b> running · <b>{counts.subagents}</b> subagents</div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The waits parked on a snapshot, normalized defensively — a face that
 * predates `pending` (or hands back a malformed value) yields none rather
 * than throwing mid-render.
 */
export function pendingOf(snap: { pending?: unknown } | undefined): readonly PendingCarrierLike[] {
  const raw = snap?.pending
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (w): w is PendingCarrierLike =>
      !!w && typeof (w as PendingCarrierLike).key === 'string' && typeof (w as PendingCarrierLike).respond === 'function',
  )
}

/** A 0.1.2 pending interaction as `uiSession.pendingInteractions` carries it. */
type UiPendingInteraction = {
  sessionId?: string
  kind?: string
  key?: string
  questions?: QuestionItemLike[]
  toolName?: string
  reason?: string
  approvalId?: string
  callId?: string
  answer(result: unknown): Promise<unknown>
}

/**
 * Adapt one 0.1.2 pending interaction to the carrier the tile already renders.
 *
 * `buildSnapshot()` dropped `pending` in 0.1.2 along with the conversation, so
 * `pendingOf` finds nothing there and a session parked on a question shows no
 * question — the same relocation that emptied the transcript, one field over.
 * Waits now live on `uiSession.pendingInteractions` (an ObservableSnapshot of
 * `Map<sessionId, interaction>`, one winner per session by domain precedence)
 * and settle through `answer()` rather than `respond()`.
 *
 * The two verbs differ in more than name: `respond()` takes the Remote-Event
 * envelope (`{ ok, value }`) and reports a receipt, while `answer()` takes the
 * bare payload and resolves with nothing. Unwrapping here keeps `InboxQuestion`
 * and `InboxApproval` — and their pure answer-building logic — identical on
 * both harness eras.
 *
 * @param raw - one interaction off the 0.1.2 map.
 * @returns the normalized carrier, or undefined when it is not answerable.
 */
export function adaptPendingInteraction(raw: unknown): PendingCarrierLike | undefined {
  const w = raw as UiPendingInteraction | undefined
  if (!w || typeof w.answer !== 'function') return undefined
  const kind: 'approval' | 'question' = w.kind === 'approval' ? 'approval' : 'question'
  return {
    kind,
    key: typeof w.key === 'string' ? w.key : `${kind}:${String(w.sessionId ?? '')}`,
    sessionId: String(w.sessionId ?? ''),
    payload: {
      ...(w.toolName === undefined ? {} : { toolName: w.toolName }),
      ...(w.reason === undefined ? {} : { reason: w.reason }),
      ...(w.approvalId === undefined ? {} : { approvalId: w.approvalId }),
      ...(w.callId === undefined ? {} : { callId: w.callId }),
      ...(Array.isArray(w.questions) ? { questions: w.questions } : {}),
    },
    // The tile calls respond({ ok, value }); 0.1.2 wants the bare payload, and
    // an approval wants just its outcome string.
    respond: async (result: unknown) => {
      const value = (result as { value?: unknown })?.value ?? result
      const payload = kind === 'approval'
        ? (value as { outcome?: unknown })?.outcome ?? value
        : (value as { answer?: unknown })?.answer ?? value
      await w.answer(payload)
      return { accepted: true }
    },
  }
}

/**
 * Read the waits parked on one session across BOTH harness eras.
 *
 * 0.1.1 carries them on the session snapshot; 0.1.2 publishes them on
 * `uiSession`. Optional and defensive throughout: `uiSession` is read with
 * `ctx.get` (never `inject`, which would park `apply()` on the older harness),
 * and any throw yields no waits rather than taking down the overlay.
 *
 * @param ctx - the plugin's client context.
 * @param id - the session whose waits the tile renders.
 * @returns normalized carriers, newest era first.
 */
/**
 * Subscribe to 0.1.2 pending interactions for one session.
 *
 * The map is published independently of the session snapshot, so it needs its
 * own subscription — without one a question would only appear when some other
 * state happened to re-render the tile. Resolves to an empty list on 0.1.1,
 * where the waits ride `snap.pending` instead.
 *
 * @param ctx - the plugin's client context.
 * @param id - the session whose waits the tile renders.
 * @returns the current normalized carriers, re-read on every publication.
 */
function useUiPendingMap(ctx: ClientContext): ReadonlyMap<string, unknown> {
  const store = React.useMemo(() => {
    try {
      const ui = (ctx as unknown as { get(name: string): unknown }).get('uiSession') as {
        pendingInteractions?: { getSnapshot(): unknown; subscribe(fn: () => void): () => void }
      } | undefined
      const p = ui?.pendingInteractions
      return p && typeof p.subscribe === 'function' ? p : undefined
    } catch {
      return undefined
    }
  }, [ctx])
  const [map, setMap] = React.useState<ReadonlyMap<string, unknown>>(() => uiPendingMap(ctx))
  React.useEffect(() => {
    const read = () => setMap(uiPendingMap(ctx))
    read()
    if (!store) return
    try {
      return store.subscribe(read)
    } catch {
      return undefined
    }
  }, [store, ctx])
  return map
}

function useUiPending(ctx: ClientContext, id: string | undefined): readonly PendingCarrierLike[] {
  const map = useUiPendingMap(ctx)
  return React.useMemo(() => {
    if (!id) return []
    const hit = map.get(id)
    const carrier = hit === undefined ? undefined : adaptPendingInteraction(hit)
    return carrier ? [carrier] : []
  }, [map, id])
}

export function uiPendingFor(ctx: ClientContext, id: string | undefined): readonly PendingCarrierLike[] {
  if (!id) return []
  const hit = uiPendingMap(ctx).get(id)
  const carrier = hit === undefined ? undefined : adaptPendingInteraction(hit)
  return carrier ? [carrier] : []
}

/**
 * Shared empty map so a 0.1.1 read keeps a stable identity across renders.
 *
 * Declared ABOVE its first use on purpose. As a `const` below `uiPendingMap`
 * it sat in the temporal dead zone while the module body was still evaluating,
 * and `MissionControl` renders inside that window — so the first read threw
 * `Cannot access 'EMPTY_PENDING' before initialization` and took the whole
 * overlay down. The `try/catch` could not save it either, because the catch
 * branch returns the same binding. A `function` declaration would hoist; a
 * `const` does not.
 */
const EMPTY_PENDING: ReadonlyMap<string, unknown> = new Map()

/**
 * The whole 0.1.2 pending-interaction map, or an empty map on 0.1.1.
 *
 * 0.1.2 removed `pendingInteraction` from the session SUMMARY as well as
 * `pending` from the snapshot, so the fleet's amber dot, the sort precedence
 * ("needs you" first) and the inbox's row gate all lose their input at once —
 * not just the tile's question box. This map is the single replacement source
 * for every one of them.
 *
 * @param ctx - the plugin's client context.
 * @returns sessionId -> interaction; empty when the service is absent.
 */
export function uiPendingMap(ctx: ClientContext): ReadonlyMap<string, unknown> {
  try {
    const ui = (ctx as unknown as { get(name: string): unknown }).get('uiSession') as {
      pendingInteractions?: { getSnapshot(): unknown }
    } | undefined
    const snap = ui?.pendingInteractions?.getSnapshot?.()
    if (!snap || typeof (snap as Map<string, unknown>).get !== 'function') return EMPTY_PENDING
    return snap as ReadonlyMap<string, unknown>
  } catch {
    return EMPTY_PENDING
  }
}



/**
 * The pending KIND for one session, across both eras — what the fleet row's
 * amber dot and sort precedence key off.
 *
 * @param summaryKind - `pendingInteraction` off the 0.1.1 session summary.
 * @param interaction - the 0.1.2 interaction for that session, when present.
 * @returns the kind, or undefined when nothing is waiting.
 */
export function pendingKindOf(
  summaryKind: string | undefined,
  interaction: unknown,
): string | undefined {
  if (summaryKind !== undefined) return summaryKind
  const k = (interaction as { kind?: string } | undefined)?.kind
  return k === 'approval' || k === 'plan-review' || k === 'question' ? k : undefined
}

/**
 * Re-apply pending kinds to an already-built row tree.
 *
 * Done as one post-pass rather than threaded through the four row builders
 * (`buildGroups`, `buildFleet`, `catalogChildren`, the subagent row): those are
 * pure list projections, and adding a service-derived argument to each would
 * spread the harness-era split across all of them. Identity is preserved when
 * nothing changes, so React's memoized consumers do not re-render on 0.1.1.
 *
 * @param rows - the built tree.
 * @param pendingBySession - 0.1.2 interactions keyed by session.
 * @returns the same tree, or a copy with pending kinds filled in.
 */
export function withPendingKinds(
  rows: readonly FleetRow[],
  pendingBySession: ReadonlyMap<string, unknown>,
): FleetRow[] {
  if (pendingBySession.size === 0) return rows as FleetRow[]
  let changed = false
  // Returns the SAME array when no descendant changed, so an unchanged subtree
  // keeps its identity and the top-level check below stays meaningful.
  const walk = (list: readonly FleetRow[]): readonly FleetRow[] => {
    let dirty = false
    const next = list.map((row) => {
      const kind = pendingKindOf(row.pending, pendingBySession.get(row.id))
      const children = walk(row.children)
      if (kind === row.pending && children === row.children) return row
      dirty = true
      changed = true
      return { ...row, pending: kind, children: children as FleetRow[] }
    })
    return dirty ? next : list
  }
  const next = walk(rows)
  return changed ? (next as FleetRow[]) : (rows as FleetRow[])
}

/**
 * A wait rendered *inside* its Stage tile. The tile is where the operator is
 * already looking, so a session asking a question must show the question there
 * — an amber border alone said "something is waiting" without ever saying what.
 *
 * Same carriers, same pure answer logic, and the same `respond()` contract the
 * permission inbox uses, so answering from the Stage and answering from the
 * inbox are the same act; the wait clears from both the moment the host
 * accepts it.
 */
function StageTileWait({ wait, onJump }: {
  wait: PendingCarrierLike
  onJump: () => void
}): React.JSX.Element {
  const questions = questionsOf(wait)
  return (
    <div className="dshmc-stage-tile-wait" role="group" aria-label="Waiting on you">
      {questions.length > 0 ? (
        <InboxQuestion sessionTitle="Waiting on you" wait={wait} questions={questions} onJump={onJump} />
      ) : (
        <InboxApproval sessionTitle="Waiting on you" wait={wait} onJump={onJump} />
      )}
    </div>
  )
}

/**
 * One stage tile: fuller live conversation (last ~30 entries) with the
 * scroll pinned to the bottom while streaming, plus a per-tile composer —
 * steer while the session runs, queue when idle. Title click jumps to the
 * session and exits the stage.
 *
 * When the session is parked on a wait, the question or approval renders in
 * place of the composer: answering it *is* the next action, and a free-text
 * steer would not satisfy the wait.
 */
/**
 * The session's live to-do strip, collapsed to a progress line with the active
 * item beside it and expandable to the whole plan.
 *
 * Todos never appear in `extractTail`: the host carries them as a per-session
 * projection rather than a chat node, so without this the tile shows a
 * `todo_write` tool row and nothing about the plan it wrote. Collapsed by
 * default because a long plan would otherwise crowd out the transcript the
 * tile exists to show.
 */
function TileTodos({ todos }: { todos: readonly TodoItem[] }): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false)
  if (todos.length === 0) return null
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.find((t) => t.status === 'in_progress')
  // The in-progress item is the useful one-line summary; once every item is
  // done there is none, so fall back to naming completion.
  const summary = active ? active.content : done === todos.length ? 'all done' : 'no active task'
  return (
    <div className="dshmc-todos">
      <button
        className="dshmc-todos-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'Hide to-dos' : 'Show to-dos'}
      >
        <span className="dshmc-todos-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="dshmc-todos-count">{done}/{todos.length}</span>
        <span className="dshmc-todos-active">{summary}</span>
      </button>
      {open ? (
        <ul className="dshmc-todos-list">
          {todos.map((t, i) => (
            <li key={`${i}:${t.content}`} className="dshmc-todo-item" data-status={t.status}>
              <span className="dshmc-todo-glyph" aria-hidden="true">
                {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
              </span>
              <span className="dshmc-todo-text">{t.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function StageTile({
  ctx,
  row,
  modelDirs,
  now,
  onJump,
}: {
  ctx: ClientContext
  row: FleetRow
  modelDirs?: ModelDirsLike
  now: number
  onJump: () => void
}): React.JSX.Element {
  const snap = useSessionSnapshot(ctx, row.id)
  const running = row.running
  const waiting = row.pending
  const lastErr = snap?.lastAgentError ?? null
  const { now: liveNow, rate } = useSessionRate(row.outTokens, running)
  const activity = llmActivityOf(snap, liveNow)
  const tools = useOpenTools()
  // Waits come from the session snapshot on 0.1.1 and from `uiSession` on
  // 0.1.2 (which dropped `pending` from buildSnapshot alongside the chat).
  // Exactly one era answers on any given harness, so concatenating is safe.
  const snapWaits = pendingOf(snap)
  const uiWaits = useUiPending(ctx, row.id)
  const waits = React.useMemo(
    () => (snapWaits.length > 0 ? snapWaits : uiWaits),
    [snapWaits, uiWaits],
  )
  // Display state spans the whole tree (the tile stands in for it, like
  // stageRank) AND the live snapshot: a waiting subagent or a live
  // PendingWait paints the tile amber, and waiting wins over running — a
  // session parked on a question is often still flagged running. Behaviour
  // (steer/queue, stop button) stays row-scoped.
  const dispRunning = treeRunning(row)
  const dispWaiting = treePending(row) ?? (waits.length > 0 ? 'question' : undefined)
  // No character cap: Stage renders the real conversation, and clipping cut
  // messages mid-sentence (and broke markdown by orphaning a `**` or a fence).
  const tail = React.useMemo(() => extractTail(snap, 30), [snap])
  // The running assistant-step node is part of the tail; the legacy top-level
  // partial is only a fallback when the tail has nothing at all.
  const partial = snap?.running && tail.length === 0 ? partialText(snap.partial) : ''
  // Window lifecycle, kept separate from "the tail is empty": an unresolved
  // face (no snapshot yet) reads as still-loading, never as an empty session.
  const openState = snap?.openState

  // Auto-scroll pinned to the bottom; scrolling up unpins until the user
  // returns to the bottom edge.
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const pinnedRef = React.useRef(true)
  React.useEffect(() => {
    const el = bodyRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [tail, waits.length])

  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Images staged for the next send. Object URLs are revoked on release and on
  // unmount, so a tile that never sends does not leak them.
  const [images, setImages] = React.useState<DraftImage[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)
  const imagesRef = React.useRef<DraftImage[]>([])
  imagesRef.current = images
  React.useEffect(() => () => {
    for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl)
  }, [])

  /** Stage accepted image files; silently ignores non-images in a mixed drop. */
  const addFiles = (files: readonly File[]) => {
    const accepted = files.filter((f) => isPromptImage(f.type))
    if (accepted.length === 0) return
    setImages((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        ...(file.name === '' ? {} : { name: file.name }),
      })),
    ])
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      const hit = prev.find((i) => i.id === id)
      if (hit) URL.revokeObjectURL(hit.previewUrl)
      return prev.filter((i) => i.id !== id)
    })
  }

  const send = () => {
    const body = draft.trim()
    const staged = images
    // An image-only message is legitimate — do not require text.
    if ((!body && staged.length === 0) || busy) return
    const face = sessionFaceOf(ctx, row.id)
    if (!face) {
      setError('session face unavailable')
      return
    }
    setBusy(true)
    setError(null)
    // Images lead the content array, matching the host composer's own order.
    Promise.all(staged.map((i) => encodePromptImage(i.file)))
      .then((parts) => face.prompt(
        [...parts, ...(body === '' ? [] : [{ type: 'text' as const, text: body }])],
        running ? 'steer' : 'queue',
      ))
      .then((res) => {
        if (!res.ok) { setError(errText(res.error)); return }
        setDraft('')
        // Release previews only after the host accepted the prompt.
        for (const img of staged) URL.revokeObjectURL(img.previewUrl)
        setImages((prev) => prev.filter((i) => !staged.some((s) => s.id === i.id)))
      })
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  // Waiting-on-you wins over running: a session parked on a pending
  // interaction may still be flagged running, but it needs a human, so it
  // wears the amber treatment (matching the fleet row's precedence).
  const cls = dispWaiting ? 'is-waiting' : dispRunning ? 'is-running' : ''
  const statusLabel = dispWaiting
    ? (waits.length > 0 && waits[0]!.kind === 'question' ? 'waiting — answer below' : 'waiting on you')
    : dispRunning
      ? 'running'
      : row.updatedAt
        ? `idle ${fmtRelative(row.updatedAt, now)}`
        : 'idle'
  return (
    <div className={`dshmc-stage-tile ${cls}`} data-session-id={row.id}>
      <div className="dshmc-stage-tile-head">
        <span className={dispWaiting ? 'dshmc-dot pending' : dispRunning ? 'dshmc-dot running' : 'dshmc-dot'} />
        <span
          className="dshmc-stage-tile-title"
          title={row.cwd ?? row.title}
          role="button"
          tabIndex={0}
          onClick={onJump}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onJump() }}
        >{row.title}</span>
        {row.workspace ? (
          <span className="dshmc-stage-tile-ws" title={`Workspace: ${row.workspace}`}>{row.workspace}</span>
        ) : null}
        <ModelTag modelDirs={modelDirs} sessionId={row.id} />
        {running ? (
          <button
            className="dshmc-tile-stop"
            title="Stop (cancel turn)"
            onClick={(e) => {
              e.stopPropagation()
              const face = sessionFaceOf(ctx, row.id)
              if (face) void face.cancel().catch(() => undefined)
            }}
          >stop</button>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        className="dshmc-stage-tile-body"
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {tail.map((m, i) => m.tool ? (
          <ToolMessage
            key={m.key}
            detail={m.tool}
            now={liveNow}
            expanded={tools.isOpen(m.key)}
            onToggle={() => tools.toggle(m.key)}
          />
        ) : (
          <TileMessage
            key={m.key}
            kind={m.kind}
            text={m.text}
            streaming={!!snap?.running && i === tail.length - 1 && m.kind === 'assistant'}
          />
        ))}
        {partial !== '' ? <TileMessage kind="assistant" text={partial} streaming /> : null}
        {tail.length === 0 && partial === '' ? (
          // Three distinct states, never conflated: the window is still being
          // pulled (loading is its own flag, not an inference from an empty
          // tail), it failed to load, or the session genuinely has nothing to
          // show. Reporting "status only" during a load was a false claim
          // about the session and sent the user clicking through to a
          // conversation that was about to render here anyway.
          openState === 'cold' || openState === 'loading' || openState === undefined ? (
            <div className="dshmc-tile-msg tool" role="status">loading conversation…</div>
          ) : openState === 'error' ? (
            <div className="dshmc-tile-msg tool" role="status">conversation unavailable — click the title to open it</div>
          ) : transcriptUnavailable(openState, snap?.chat != null) ? (
            // An OPEN window that produced no chat container at all means this
            // harness keeps the transcript somewhere this build does not know
            // about — say so, rather than implying the session is idle.
            <div className="dshmc-tile-msg tool" role="status">
              transcript unavailable on this harness — click the title to open it
            </div>
          ) : (
            <div className="dshmc-tile-msg tool" role="note">no messages yet</div>
          )
        ) : null}
        {lastErr ? <div className="dshmc-tile-msg err">{String(lastErr).slice(0, 160)}</div> : null}
      </div>
      <LlmStatus activity={activity} rate={rate} />
      {row.todos && row.todos.length > 0 ? <TileTodos todos={row.todos} /> : null}
      {waits.length > 0 ? (
        waits.map((w) => <StageTileWait key={w.key} wait={w} onJump={onJump} />)
      ) : (
      <div
        className="dshmc-stage-tile-input"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          addFiles([...e.dataTransfer.files])
        }}
      >
        {images.length > 0 ? (
          <div className="dshmc-stage-tile-thumbs">
            {images.map((img) => (
              <span key={img.id} className="dshmc-stage-tile-thumb">
                <img src={img.previewUrl} alt={img.name ?? 'pasted image'} />
                <button
                  className="dshmc-stage-tile-thumb-x"
                  aria-label={`Remove ${img.name ?? 'image'}`}
                  title="Remove"
                  onClick={() => removeImage(img.id)}
                >×</button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="dshmc-stage-tile-inputrow">
          <button
            className="dshmc-stage-tile-attach"
            aria-label={`Attach image to ${row.title}`}
            title="Attach image"
            onClick={() => fileRef.current?.click()}
          >+</button>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])])
              // Reset so re-picking the same file fires change again.
              e.target.value = ''
            }}
          />
          <textarea
            rows={1}
            value={draft}
            placeholder={running ? 'Steer this session…' : 'Message this session…'}
            aria-label={`Message ${row.title}`}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files]
              if (files.length === 0) return
              // Only swallow the paste when it actually carries an image.
              if (!files.some((f) => isPromptImage(f.type))) return
              e.preventDefault()
              addFiles(files)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button
            className="dshmc-stage-tile-send"
            disabled={busy || (!draft.trim() && images.length === 0)}
            onClick={send}
          >
            {busy ? '…' : running ? 'Steer' : 'Send'}
          </button>
        </div>
      </div>
      )}
      <div className="dshmc-stage-tile-foot">
        <span>{statusLabel}</span>
        {error ? <span className="dshmc-stage-tile-error" title={error}>send failed</span> : null}
        <span className="dshmc-time">{fmtRelative(row.updatedAt, now)}</span>
      </div>
    </div>
  )
}

/**
 * Stage: the full-screen live grid. Membership *and order* come from stageRows —
 * running/waiting roots plus anything touched inside the activity window
 * (30m / 2h toggle), most active first so the busiest tiles sit far left.
 * Esc or × exits back to the panel.
 */
function StageView({
  ctx,
  rows,
  modelDirs,
  now,
  onJump,
  onExit,
}: {
  ctx: ClientContext
  rows: FleetRow[]
  modelDirs?: ModelDirsLike
  now: number
  onJump: (id: string) => void
  onExit: () => void
}): React.JSX.Element {
  const [windowMin, setWindowMin] = React.useState(30)
  const tiles = React.useMemo(() => stageRows(rows, now, windowMin * 60_000), [rows, now, windowMin])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])
  return (
    <div className="dshmc-stage">
      <div className="dshmc-stage-bar">
        <span className="dshmc-stage-title">Stage</span>
        <span className="dshmc-stage-count"><b>{tiles.length}</b> active</span>
        {/* data-dsh-no-drag: same contract the panel header's buttons use — the
            Stage bar sits across DSH Desktop's drag strip, which swallows
            clicks before hit-testing unless a control opts out. */}
        <div className="dshmc-stage-window" role="group" aria-label="Activity window">
          <button
            className={`dshmc-mode${windowMin === 30 ? ' on' : ''}`}
            data-dsh-no-drag=""
            onClick={() => setWindowMin(30)}
          >
            30m
          </button>
          <button
            className={`dshmc-mode${windowMin === 120 ? ' on' : ''}`}
            data-dsh-no-drag=""
            onClick={() => setWindowMin(120)}
          >
            2h
          </button>
        </div>
        <button
          className="dshmc-close"
          data-dsh-no-drag=""
          onClick={onExit}
          aria-label="Exit Stage"
          title="Exit Stage (Esc)"
        >
          ×
        </button>
      </div>
      {tiles.length === 0 ? (
        <div className="dshmc-stage-empty">
          Nothing active. Tiles appear while agents run, wait on you, or were active in the last {windowMin === 30 ? '30 minutes' : '2 hours'}.
        </div>
      ) : (
        <div className="dshmc-stage-grid">
          {tiles.map((row) => (
            <StageTile key={row.id} ctx={ctx} row={row} modelDirs={modelDirs} now={now} onJump={() => onJump(row.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/*
 * Header glyphs, drawn inline at the shell sidebar's icon geometry: a 16px box
 * on a 28px circular button, 1.5px strokes on `currentColor`.
 *
 * The shell draws its own from `@deepseek-ai/dsh-client-ui-primitives`
 * (`IconPanelLeftOutline16`), but that package is not a resolvable dependency
 * here and this plugin is a deliberate pure consumer — importing shell
 * internals would trade a two-element SVG for a hard dependency on a private
 * surface. Matching the geometry gets the same result at no coupling cost.
 */
const ICON_SIZE = 16

/**
 * Shared glyph frame. Every icon in the panel is drawn on this one geometry, so
 * a size or stroke change lands everywhere at once instead of drifting per
 * call site — which is how the pomodoro row ended up with 10px text glyphs
 * beside the header's 16px SVGs, the same ⚙ rendering at two sizes.
 */
function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Panel-collapse glyph: the sidebar's panel icon mirrored for a right-hand rail. */
function IconPanelRight(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2" y="2.75" width="12" height="10.5" rx="2.5" />
      <line x1="10" y1="2.75" x2="10" y2="13.25" />
    </Glyph>
  )
}

/** Settings gear, replacing the bare ⚙ text glyph so both buttons share a metric. */
function IconSettings(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M12.9 9.8a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.89 1.89l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.89-1.89l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.89-1.89l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.89 1.89l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67Z" />
    </Glyph>
  )
}

/** Terminal window with a prompt chevron: open the workspace in a terminal. */
function IconTerminal(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M5 6.4l2.2 1.7L5 9.8" />
      <line x1="8.4" y1="9.8" x2="11" y2="9.8" />
    </Glyph>
  )
}

/* Pomodoro transport glyphs. Filled shapes for play/pause read better than
   strokes at this size, so they set `fill` and clear the inherited stroke. */

/** Play triangle (start the timer). */
function IconPlay(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M5.5 3.4v9.2l7-4.6z" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** Pause bars (halt the running timer). */
function IconPause(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="5" y="3.5" width="2.2" height="9" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="8.8" y="3.5" width="2.2" height="9" rx="0.9" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** Counter-clockwise arrow (reset the current interval). */
function IconReset(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.48" />
      <path d="M2.6 3.2v3.1h3.1" />
    </Glyph>
  )
}

/** Skip-forward: triangle plus end bar (jump to the next phase). */
function IconSkip(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 3.8v8.4l6-4.2z" fill="currentColor" stroke="none" />
      <line x1="11.6" y1="3.8" x2="11.6" y2="12.2" />
    </Glyph>
  )
}

/** One stats-strip card: colored while live, and flashes when its number moves. */
function StatCard({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone?: 'live' | 'waiting' | 'swarm'
}): React.JSX.Element {
  const bumped = useBump(value)
  // Every toned card animates while its count is non-zero; an untoned card
  // stays inert. 'swarm' is the subagent tone — a live swarm should read as
  // active in its own right, not sit still while only "running" glows.
  const active = tone !== undefined && value > 0
  const cls = [
    'dshmc-stat',
    active && tone === 'live' ? 'is-live' : '',
    active && tone === 'waiting' ? 'is-waiting-live' : '',
    active && tone === 'swarm' ? 'is-swarm-live' : '',
    bumped ? 'is-bumped-card' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      <div className={`dshmc-stat-value${bumped ? ' is-bumped' : ''}`}>{value}</div>
      <div className="dshmc-stat-label">{label}</div>
    </div>
  )
}

function FleetRowView({
  ctx,
  row,
  depth = 0,
  current,
  onSelect,
  modelDirs,
  rate,
  collapsed,
  onToggleCollapsed,
}: {
  ctx: ClientContext
  row: FleetRow
  depth?: number
  current: string | undefined
  onSelect: (row: FleetRow) => void
  modelDirs?: ModelDirsLike
  rate?: number
  /** Ids whose subagent children are hidden (per-session, any depth). */
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (id: string) => void
}): React.JSX.Element {
  // A collapsed root hides its subagents, so a child parked on an approval
  // would otherwise leave the only visible row un-coloured. Inherit waiting
  // from the subtree — the same rule the stage tile already applies — so the
  // fleet's amber always matches what is actually waiting on you.
  const waiting = treePending(row)
  const hasChildren = row.children.length > 0
  const isCollapsed = collapsed.has(row.id)
  const dotClass = waiting
    ? 'dshmc-dot pending'
    : row.running
      ? 'dshmc-dot running'
      : row.completed
        ? 'dshmc-dot done'
        : 'dshmc-dot'
  return (
    <div>
      <div
        className={`dshmc-row${row.id === current ? ' current' : ''}${waiting ? ' is-waiting' : row.running ? ' is-running' : ''}`}
        onClick={() => onSelect(row)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect(row)
        }}
      >
        {depth > 0 ? (
          <span className="dshmc-branch" style={{ width: depth * 14 }} aria-hidden="true" />
        ) : null}
        {/* Per-session collapse. Rendered only when this row actually has
            subagents; a fixed-width spacer keeps childless rows aligned with
            their siblings instead of shifting the dot left. Stops propagation
            so toggling never doubles as selecting the session. */}
        {hasChildren ? (
          <button
            className={`dshmc-rowcaret${isCollapsed ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapsed(row.id)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Show' : 'Hide'} ${row.children.length} subagent${row.children.length === 1 ? '' : 's'} of ${row.title}`}
            title={isCollapsed ? 'Show subagents' : 'Hide subagents'}
          >
            ▸
          </button>
        ) : (
          <span className="dshmc-rowcaret-spacer" aria-hidden="true" />
        )}
        <span
          className={dotClass}
          role="img"
          aria-label={
            waiting
              ? row.pending
                ? 'waiting on you'
                : 'subagent waiting on you'
              : row.running
                ? 'running'
                : row.completed
                  ? 'done'
                  : 'idle'
          }
        />
        <span className="dshmc-title-text" title={row.cwd ?? row.title}>{row.title}</span>
        <ModelTag modelDirs={modelDirs} sessionId={row.id} />
        {hasChildren ? (
          <span
            className={`dshmc-tag${isCollapsed ? ' is-folded' : ''}`}
            title={`${countDescendants(row)} subagent${countDescendants(row) === 1 ? '' : 's'} in this tree`}
          >
            {countDescendants(row)}
          </span>
        ) : null}
        {row.running && rate !== undefined && rate > 0 ? (
          <span className="dshmc-rate" title="Fleet output rate">{Math.round(rate)} tok/s</span>
        ) : null}
        <span className="dshmc-time">{fmtRelative(row.updatedAt)}</span>
        <RowMenu ctx={ctx} row={row} root={depth === 0} onJump={() => onSelect(row)} />
      </div>
      {!isCollapsed
        ? row.children.map((child) => (
            <FleetRowView
              key={child.id}
              ctx={ctx}
              row={child}
              depth={depth + 1}
              current={current}
              onSelect={onSelect}
              modelDirs={modelDirs}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
            />
          ))
        : null}
    </div>
  )
}

function GroupView({
  ctx,
  group,
  collapsed,
  onToggle,
  expanded,
  onToggleExpanded,
  current,
  onSelect,
  modelDirs,
  rate,
  collapsedRows,
  onToggleRow,
}: {
  ctx: ClientContext
  group: LimitedGroup
  collapsed: boolean
  onToggle: () => void
  expanded: boolean
  onToggleExpanded: () => void
  current: string | undefined
  onSelect: (row: FleetRow) => void
  modelDirs?: ModelDirsLike
  rate?: number
  /** Per-session subagent collapse state, threaded down to every row. */
  collapsedRows: ReadonlySet<string>
  onToggleRow: (id: string) => void
}): React.JSX.Element {
  const hasLive = (rows: FleetRow[]): boolean =>
    rows.some((r) => r.running || r.pending || hasLive(r.children))
  const live = hasLive(group.rows)
  return (
    <div className="dshmc-group">
      <div className="dshmc-group-header" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}>
        <span className={`dshmc-caret${collapsed ? '' : ' open'}`}>▸</span>
        <span className="dshmc-group-title">{group.title}</span>
        <span className="dshmc-group-count">{group.rows.length}</span>
        {live ? <span className="dshmc-group-live">active</span> : null}
      </div>
      {!collapsed ? (
        <>
          {group.visible.map((row) => (
            <FleetRowView
              key={row.id}
              ctx={ctx}
              row={row}
              depth={0}
              current={current}
              onSelect={onSelect}
              modelDirs={modelDirs}
              rate={rate}
              collapsed={collapsedRows}
              onToggleCollapsed={onToggleRow}
            />
          ))}
          {group.hidden > 0 || expanded ? (
            <button
              className="dshmc-group-more"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Show fewer sessions in ${group.title}`
                  : `Show ${group.hidden} more session${group.hidden === 1 ? '' : 's'} in ${group.title}`
              }
            >
              {expanded ? 'Show fewer' : `Show ${group.hidden} more`}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pomodoro footer
// ---------------------------------------------------------------------------

/** Fire the break/back-to-work notification for a phase that just elapsed. */
function notifyPhaseEnd(elapsed: PomodoroPhase, upcoming: PomodoroPhase): void {
  if (typeof Notification === 'undefined') return
  const title =
    elapsed === 'work' ? 'Mission Control — time for a break' : 'Mission Control — break over'
  const body =
    elapsed === 'work'
      ? `${phaseLabel(upcoming)} time. Step away from the fleet.`
      : 'Back to it — starting a new focus stretch.'
  const fire = () => {
    try {
      const n = new Notification(title, { body, tag: 'dshmc-pomodoro' })
      n.onclick = () => { window.focus(); n.close() }
    } catch {
      /* notifications unavailable */
    }
  }
  if (Notification.permission === 'granted') fire()
  else if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((p) => { if (p === 'granted') fire() })
  }
}

/**
 * Break reminder pinned to the panel footer. Owns its own 1s clock (only while
 * running) so it never re-renders the fleet list, and holds no session state —
 * the panel's pure-consumer posture is untouched.
 *
 * @param config - configured phase lengths from panel settings.
 */
function PomodoroBar({ config }: { config: PomodoroConfig }): React.JSX.Element {
  const [state, setState] = React.useState<PomodoroState>(() => {
    // Seed synchronously from this origin's localStorage; storage failures
    // (private mode, quota) degrade to a fresh parked timer.
    try {
      const env = parsePomodoroEnvelope(window.localStorage.getItem(POMODORO_KEY), config)
      return env ? env.state : initialPomodoro(config)
    } catch {
      return initialPomodoro(config)
    }
  })
  // Timestamp of the seed / last local change. The host cell is adopted only
  // while this mount is untouched AND its write is newer — otherwise a stale
  // host reply landing after the user pressed Start would rewind the timer.
  const touchedRef = React.useRef(0)
  const dirtyRef = React.useRef(false)
  const now = useTicker(state.running, 1000)

  // Reconcile against the host cell once its first load resolves. The host
  // copy survives origin changes (Desktop's per-launch port); localStorage
  // does not, so a newer host write always wins over this origin's seed.
  React.useEffect(() => {
    return onHostState((payload) => {
      const env = parsePomodoroEnvelope(payload, config)
      if (!env || dirtyRef.current || env.updatedAt <= touchedRef.current) return
      dirtyRef.current = true
      touchedRef.current = env.updatedAt
      setState(env.state)
    })
    // config identity changes with settings edits; re-running the adoption is
    // safe because a dirty mount never adopts.
  }, [config])

  // Persist every transition, to BOTH stores: localStorage seeds the next
  // mount synchronously, the host cell carries the state across origins and
  // restarts. endsAt is absolute wall-clock, so a running timer reloaded
  // after a restart simply re-derives its remainder.
  //
  // The MOUNT render is skipped: the seed was already persisted, and marking
  // the mount dirty would make the host reconciliation above refuse every
  // adoption — the persist effect runs before the host's load resolves.
  const mountedRef = React.useRef(false)
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const updatedAt = Date.now()
    touchedRef.current = updatedAt
    dirtyRef.current = true
    const payload = packPomodoroEnvelope(state, updatedAt)
    try {
      window.localStorage.setItem(POMODORO_KEY, payload)
    } catch {
      /* storage unavailable — the timer keeps working in memory */
    }
    saveHostState(payload)
  }, [state])

  // Roll the timer forward to the current clock. Pure reducer + effect keeps a
  // backgrounded tab honest: one boundary is crossed per pass, so a long sleep
  // lands on the break instead of skipping it.
  React.useEffect(() => {
    if (!state.running) return
    const { state: next, elapsed } = advancePomodoro(state, Date.now(), config)
    if (!elapsed) return
    setState(next)
    notifyPhaseEnd(elapsed, next.phase)
  }, [now, state, config])

  // A parked phase must track live edits to its duration, otherwise the readout
  // lies about the setting the user just changed. The key excludes `running`:
  // keying on it made every pause look like a new idle state and the resync
  // below wiped the banked remainder — pausing "restarted" the phase.
  const idleKey = idleSyncKey(state, config)
  const lastIdleRef = React.useRef(idleKey)
  React.useEffect(() => {
    if (lastIdleRef.current === idleKey) return
    lastIdleRef.current = idleKey
    setState((s) => (s.running ? s : { ...s, remainingMs: phaseDurationMs(s.phase, config) }))
  }, [idleKey, config])

  // Clamp to the phase start: the ticker's sample can predate the click that
  // started this phase, which would render a second more than exists.
  const at = displayNow(state, now)
  const remaining = remainingOf(state, at)
  const progress = phaseProgress(state, at, config)
  const label = phaseLabel(state.phase)
  const isBreak = state.phase !== 'work'
  const cycle = state.completed % POMODORO_LONG_EVERY
  // Final-minute urgency, only while actually counting down — a paused timer
  // parked under a minute should sit still, not flash.
  const isEnding = state.running && remaining <= 60_000

  const cls =
    'dshmc-pomo' +
    (isBreak ? ' is-break' : '') +
    (state.phase === 'long' ? ' is-long' : '') +
    (state.running ? ' is-running' : '') +
    (isEnding ? ' is-ending' : '')

  return (
    <div className={cls} role="group" aria-label="Pomodoro break timer">
      <div
        className="dshmc-pomo-progress"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />
      <div className="dshmc-pomo-main">
        <span className="dshmc-pomo-phase">
          <span className="dshmc-pomo-pulse" aria-hidden="true" />
          {label}
        </span>
        <span
          className="dshmc-pomo-clock"
          role="timer"
          aria-live="off"
          aria-label={`${label}: ${fmtClock(remaining)} remaining`}
        >
          {fmtClock(remaining)}
        </span>
        <span className="dshmc-pomo-dots" aria-label={`${state.completed} focus stretches completed`}>
          {Array.from({ length: POMODORO_LONG_EVERY }, (_, i) => (
            <span key={i} className={`dshmc-pomo-dot${i < cycle ? ' on' : ''}`} aria-hidden="true" />
          ))}
        </span>
      </div>
      <div className="dshmc-pomo-actions">
        <button
          className="dshmc-pomo-btn is-primary"
          onClick={() =>
            setState((s) => (s.running ? pausePomodoro(s, Date.now()) : startPomodoro(s, Date.now(), config)))
          }
          aria-label={state.running ? `Pause ${label} timer` : `Start ${label} timer`}
          title={state.running ? 'Pause' : 'Start'}
        >
          {state.running ? <IconPause /> : <IconPlay />}
        </button>
        <button
          className="dshmc-pomo-btn"
          onClick={() => setState((s) => resetPomodoro(s, config))}
          aria-label="Reset current interval"
          title="Reset"
        >
          <IconReset />
        </button>
        <button
          className="dshmc-pomo-btn"
          onClick={() => setState((s) => skipPomodoro(s, config))}
          aria-label={`Skip to ${phaseLabel(nextPhase(state.phase, state.phase === 'work' ? state.completed + 1 : state.completed))}`}
          title="Skip"
        >
          <IconSkip />
        </button>
      </div>
    </div>
  )
}

export function MissionControl({ ctx }: { ctx: ClientContext }): React.JSX.Element {
  const [open, setOpen] = React.useState(true)
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({
    __ungrouped__: true,
  })
  const [expandedGroups, setExpandedGroups] = React.useState<ReadonlySet<string>>(new Set())
  /**
   * Sessions whose subagent children are hidden. Collapse is opt-in (a swarm
   * is the interesting part of a fleet row), so the default empty set leaves
   * every tree expanded, and only ids the user explicitly folded are held.
   */
  const [collapsedRows, setCollapsedRows] = React.useState<ReadonlySet<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settings, updateSettings] = useSettings()
  const [mode, setMode] = React.useState<'fleet' | 'inbox'>('fleet')
  // Stage is a full-screen takeover layered over the panel modes, not a panel
  // mode itself — keeping it separate preserves the tab you came from.
  const [stageOpen, setStageOpen] = React.useState(false)
  const [nowTick, setNowTick] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const list = useObservable(ctx.sessions.list as unknown as {
    getSnapshot(): SessionListStateLike
    subscribe(fn: () => void): () => void
  })
  const workspaces = useObservable(ctx.workspaces.list as unknown as {
    getSnapshot(): WorkspaceListStateLike
    subscribe(fn: () => void): () => void
  })

  // The terminal button rides the host half, which mounts asynchronously and,
  // on an older install, never mounts at all. onHostState fires exactly once
  // the first load settles, so it doubles as the "remote is up" signal. A host
  // from BEFORE openTerminal existed (updated client, unrestarted profile —
  // the client is served from disk per request while the host loads at boot)
  // gets a disabled button saying so, not a click that silently no-ops.
  const [hostReady, setHostReady] = React.useState(hostLoaded && hostRemote !== null)
  React.useEffect(() => onHostState(() => setHostReady(hostRemote !== null)), [])
  const hostHasTerminal = hostReady && typeof hostRemote?.openTerminal === 'function'

  /** Directory of the workspace the CURRENT session belongs to, if any. */
  const currentWorkspacePath = React.useMemo(() => {
    const current = list.current
    if (current === undefined) return undefined
    for (const w of workspaces?.items ?? []) {
      if (w.sessionIds.some((id) => String(id) === String(current))) return w.path
    }
    return undefined
  }, [list, workspaces])

  const openTerminal = () => {
    if (currentWorkspacePath === undefined) return
    const remote = hostRemote
    // A stale pairing (new client bundle, older host half) lacks the method;
    // degrade to a log line rather than throwing out of a click handler.
    if (!remote || typeof remote.openTerminal !== 'function') {
      console.error('dsh-mission-control: the host half has no openTerminal (restart the profile)')
      return
    }
    void remote.openTerminal({ path: currentWorkspacePath }).catch((error: unknown) => {
      console.error('dsh-mission-control: could not open a terminal', error)
    })
  }

  React.useEffect(() => injectStyles(), [])

  // 0.1.2 publishes waits on `uiSession` and removed `pendingInteraction` from
  // the session summary, so the amber dot, the "needs you first" sort and the
  // inbox all read this map instead. Empty on 0.1.1, where the summary answers.
  const pendingMap = useUiPendingMap(ctx)
  const groups = React.useMemo(
    () => buildGroups(list, workspaces, normalizeFleetSort(settings.fleetSort)).map((g) => ({
      ...g,
      rows: withPendingKinds(g.rows, pendingMap),
    })),
    [list, workspaces, settings.fleetSort, pendingMap],
  )
  const limitedGroups = React.useMemo(
    () => limitGroups(groups, settings.sessionsPerWorkspace, expandedGroups),
    [groups, settings.sessionsPerWorkspace, expandedGroups],
  )
  const visibleRoots = React.useMemo(
    () => groups.flatMap((g) => g.rows),
    [groups],
  )
  const counts = React.useMemo(() => countFleet(visibleRoots), [visibleRoots])

  /**
   * Prime the durable subagent catalogs the fleet tree reads.
   *
   * Catalogs are lazy: the host populates `subagentsByParent` only after
   * `refreshSubagents(parent)`, so without this the tree would render every
   * root as childless. We pull one level per pass — a root's catalog reveals
   * which children report `hasChildren`, and the resulting list update
   * re-runs this effect to pull the next level down.
   *
   * `requestedCatalogsRef` makes each parent a once-per-mount request. That
   * matters because refreshing writes back into `list`, which is this effect's
   * own dependency: without the guard, every pull would retrigger the effect
   * and spin.
   *
   * The once-per-mount guard alone is WRONG for a busy parent, though. A root
   * is typically primed while it is still childless, and the host does not
   * push catalog updates for a parent whose catalog it has never successfully
   * loaded — so a burst of subagents dispatched after that first pull would
   * never light up: the tree keeps rendering the stale empty catalog until the
   * panel remounts. Children appear precisely while the parent is RUNNING, so
   * a running parent is re-polled on a timer instead of being latched.
   *
   * The re-poll is time-gated rather than tick-gated because the refresh feeds
   * back into `list`: gating on elapsed time keeps the feedback loop from
   * becoming a spin while still converging within one interval of a spawn.
   */
  const requestedCatalogsRef = React.useRef<Map<string, number>>(new Map())
  const [catalogTick, setCatalogTick] = React.useState(0)
  React.useEffect(() => {
    const now = Date.now()
    const wanted: string[] = []
    const want = (id: string, live: boolean) => {
      // A settled parent stays latched; a busy one re-polls so newly spawned
      // children reach the tree without waiting for a remount.
      if (shouldPullCatalog(requestedCatalogsRef.current.get(id), live, now)) {
        wanted.push(id)
      }
    }
    const collect = (rows: FleetRow[]) => {
      for (const r of rows) {
        // `running` here is the row's OWN driver state, not treeRunning: a
        // parent spawns children while it is itself running, and inheriting a
        // busy descendant's state would re-poll settled ancestors forever.
        want(r.id, r.running === true)
        if (r.children.length > 0) collect(r.children)
      }
    }
    collect(visibleRoots)
    // Live subagent rows resident in `byId` are catalog owners too: a running
    // child can spawn its own children, and its catalog is what reveals them.
    for (const id of Object.keys(list.byId)) {
      const s = list.byId[id]
      if (s?.origin === 'subagent') want(id, s.running === true)
    }
    if (wanted.length === 0) return
    let cancelled = false
    for (const id of wanted) {
      requestedCatalogsRef.current.set(id, now)
      void Promise.resolve(ctx.sessions.refreshSubagents(asSessionId(id))).catch(() => {
        // A parent whose catalog cannot be read (gone, unreadable) stays
        // marked as requested: retrying on every list tick would hammer it.
        // The timestamp already recorded above supplies that backoff.
        if (!cancelled) return
      })
    }
    return () => {
      cancelled = true
    }
  }, [visibleRoots, list, catalogTick])

  /**
   * Heartbeat for the catalog re-poll above. The effect's other dependencies
   * (`list`, `visibleRoots`) do not change when a swarm is dispatched into a
   * catalog the host has never loaded — that is exactly the blind spot — so a
   * timer supplies the ticks. It runs only while something is actually
   * running, so an idle panel stays quiet.
   */
  const anyRunning = React.useMemo(
    () => visibleRoots.some(treeRunning),
    [visibleRoots],
  )
  React.useEffect(() => {
    if (!anyRunning) return
    const t = window.setInterval(() => setCatalogTick((n) => n + 1), CATALOG_REPOLL_MS)
    return () => window.clearInterval(t)
  }, [anyRunning])

  /**
   * Subscribe to live catalog membership for every visible root.
   *
   * THIS is what makes a freshly dispatched swarm appear. On `host/session-added`
   * the runtime refetches a parent's catalog ONLY when that parent is the
   * SELECTED session or is registered through `setSubagentCatalogOpen`
   * (dsh-client-runtime, host/session-added handler). Mission Control watches
   * every root at once and selects none of them, so without registering here
   * the host never tells it that children appeared: the panel's own re-poll can
   * only paper over that with a delay, and a never-loaded catalog stays empty.
   *
   * Registering marks these parents as consuming membership updates, so the
   * host pushes catalog refreshes as subagents spawn and retire. Cleanup
   * deregisters exactly what this pass registered, so a root leaving the
   * visible set stops costing refetches.
   */
  const watchedRootIds = React.useMemo(
    () => visibleRoots.map((r) => r.id).join('\u0000'),
    [visibleRoots],
  )
  React.useEffect(() => {
    const ids = (watchedRootIds === '' ? [] : watchedRootIds.split('\u0000')).map(
      (id) => asSessionId(id) as unknown as string,
    )
    const { opened } = openCatalogSubscriptions(ctx.sessions, ids, true)
    return () => {
      openCatalogSubscriptions(ctx.sessions, opened, false)
    }
  }, [watchedRootIds])

  const pendingRows = React.useMemo(
    () =>
      list.ids
        .map((id) => list.byId[id])
        // Either era may answer: 0.1.1 sets pendingInteraction on the summary,
        // 0.1.2 only publishes the interaction on uiSession.
        .filter((s) => s !== undefined && pendingKindOf(s.pendingInteraction, pendingMap.get(s.id)) !== undefined),
    [list, pendingMap],
  )

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  const toggleGroupExpanded = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleRowCollapsed = React.useCallback((id: string) => {
    setCollapsedRows((prev) => toggleInSet(prev, id))
  }, [])
  const openSession = (id: string) => {
    const session = list.byId[id]
    if (session?.origin === 'subagent') {
      const address = ctx.sessions.subagentAddress(asSessionId(id))
      if (address) ctx.sessions.openSubagent(address)
      else ctx.sessions.open(asSessionId(id))
    } else {
      ctx.sessions.open(asSessionId(id))
    }
  }
  const selectSession = (row: FleetRow) => openSession(row.id)

  const pendingWaits = React.useMemo(() => {
    const waits: { wait: PendingCarrierLike; title: string }[] = []
    for (const s of pendingRows) {
      if (!s) continue
      for (const w of pendingWaitsFor(ctx, s.id)) waits.push({ wait: w, title: s.displayTitle })
    }
    return waits
  }, [pendingRows, ctx])

  const pomodoroConfig = React.useMemo<PomodoroConfig>(
    () => ({
      workMinutes: normalizeMinutes(settings.workMinutes, DEFAULT_WORK_MINUTES),
      breakMinutes: normalizeMinutes(settings.breakMinutes, DEFAULT_BREAK_MINUTES),
      longBreakMinutes: normalizeMinutes(settings.longBreakMinutes, DEFAULT_LONG_BREAK_MINUTES),
    }),
    [settings.workMinutes, settings.breakMinutes, settings.longBreakMinutes],
  )

  const pulse = useFleetPulse(counts.active > 0, list)
  useWaitNotifications(pendingWaits)

  const close = () => setOpen(false)
  const reopen = () => setOpen(true)

  /** The docked rail element — the measurement source for the frame reservation. */
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  // Reserve the rail's width in the shell frame so the conversation and its
  // composer RESIZE instead of running underneath the panel.
  //
  // There is no additive seat for this: `shell.overlay` is defined as a
  // "frame-wide floating layer, above every column", the `sidebar`/`details`
  // grid columns are single-occupant and already taken by shipped UI, and
  // ctx.layout exposes only toggleSidebar/openDetails/closeDetails — nothing
  // that reserves width for a plugin. So the frame is padded directly.
  //
  // The frame is found structurally, via the overlay layer this plugin is
  // rendered into: its CSS-module class is a build-time hash (`pI_x6G_frame`)
  // that any upgrade may change, so matching on it would silently rot. The
  // element is padded rather than having its inline `grid-template-columns`
  // rewritten, because AppFrame owns that property and recomputes it on every
  // resize and drag — an edit there would be clobbered, and would fight the
  // shell's own concession solver. Padding is a property nothing else writes,
  // and the frame already transitions its columns, so the reflow animates with
  // the shell instead of snapping.
  //
  // Stage mode is full-screen and must NOT reserve anything.
  const reserveWidth = open && !stageOpen
  React.useEffect(() => {
    // Cheap check first: when nothing is reserved there is no reason to walk
    // the DOM. panelRef is intentionally not a dependency — the panel is
    // hidden rather than unmounted, so the node identity is stable for the
    // lifetime of this component.
    if (!reserveWidth) return
    const panel = panelRef.current
    if (!panel) return
    const frame = panel.closest<HTMLElement>('[data-shell-overlay]')?.parentElement
    if (!frame) return
    const prev = frame.style.paddingRight
    frame.setAttribute('data-dshmc-reserved', '')
    const apply = (): void => {
      // Measure the rendered rail: the width is media-query dependent, so a
      // hardcoded 400 would be wrong on a narrow viewport. The reservation is
      // the rail's width PLUS --mc-dock-gap: without the gutter a full-width
      // conversation view (a plugin tab such as Todo or Source Control) ends
      // flush against the rail's seam, while the centered chat keeps its
      // margins — the panel then reads as sitting on top of the tab's
      // components even though nothing geometrically overlaps.
      //
      // offsetWidth, NOT getBoundingClientRect().width. `dsh-theme`'s UI scale
      // puts the whole shell under `#root { zoom: … }`, and the two disagree
      // there: the rect is TRUE viewport px (already scaled) while the padding
      // written below is an AUTHOR px length the zoom scales again. Feeding the
      // rect back in under-reserved by exactly the zoom factor — at the 90%
      // step the rail claimed 377px, rendered 339px, and left the conversation
      // column (and anything docked flush to it, such as dsh-plan-board's plan
      // panel) 22px underneath this rail. offsetWidth is author px, the same
      // space as the gap and the padding, so all three agree at every scale.
      const w = panel.offsetWidth
      const gap = parseFloat(getComputedStyle(panel).getPropertyValue('--mc-dock-gap')) || 0
      frame.style.paddingRight = w > 0 ? `${Math.round(w + gap)}px` : ''
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(panel)
    return () => {
      ro.disconnect()
      frame.style.paddingRight = prev
      frame.removeAttribute('data-dshmc-reserved')
    }
  }, [reserveWidth])

  const modelDirs = (() => {
    try {
      return (ctx as unknown as { modelDirectories?: ModelDirsLike }).modelDirectories
    } catch {
      return undefined
    }
  })()

  // Stage mode swaps the panel for a full-screen live grid. All hooks above
  // stay mounted, so notifications and the pulse keep running.
  if (stageOpen) {
    return (
      <StageView
        ctx={ctx}
        rows={visibleRoots}
        modelDirs={modelDirs}
        now={nowTick}
        onJump={(id) => {
          setStageOpen(false)
          openSession(id)
        }}
        onExit={() => setStageOpen(false)}
      />
    )
  }

  return (
    <div>
      <div className="dshmc" hidden={!open} ref={panelRef}>
        <div className="dshmc-header">
          <div className="dshmc-header-actions">
            {/* data-dsh-no-drag: DSH Desktop's preload allowlists this
                attribute out of the window-drag region that covers the top
                36px on Windows. Without it a click here is consumed by the OS
                as a window drag. */}
            <button
              className="dshmc-icon-btn"
              data-dsh-no-drag=""
              onClick={close}
              aria-label="Collapse Mission Control"
              title="Collapse"
            >
              <IconPanelRight />
            </button>
            {hostReady ? (
              <button
                className="dshmc-icon-btn"
                data-dsh-no-drag=""
                disabled={!hostHasTerminal || currentWorkspacePath === undefined}
                onClick={openTerminal}
                aria-label="Open current workspace in a terminal"
                title={
                  !hostHasTerminal
                    ? 'Open in Terminal (restart the app to enable)'
                    : currentWorkspacePath === undefined
                      ? 'Open in Terminal (no session selected)'
                      : `Open in Terminal — ${currentWorkspacePath}`
                }
              >
                <IconTerminal />
              </button>
            ) : null}
            <button
              className={`dshmc-icon-btn${settingsOpen ? ' on' : ''}`}
              data-dsh-no-drag=""
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Mission Control settings"
              aria-expanded={settingsOpen}
              title="Settings"
            >
              <IconSettings />
            </button>
          </div>
        </div>
        {settingsOpen ? (
          <div className="dshmc-settings" role="group" aria-label="Mission Control settings">
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-label" htmlFor="dshmc-sessions-per-workspace">
                Sessions per workspace
              </label>
              <select
                id="dshmc-sessions-per-workspace"
                className="dshmc-settings-select"
                value={String(normalizeSessionLimit(settings.sessionsPerWorkspace))}
                onChange={(e) => updateSettings({ sessionsPerWorkspace: normalizeSessionLimit(e.target.value) })}
              >
                {SESSIONS_PER_WORKSPACE_CHOICES.map((n) => (
                  <option key={n} value={String(n)}>
                    {n === SESSIONS_PER_WORKSPACE_ALL ? 'All' : `Last ${n}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-label" htmlFor="dshmc-fleet-sort">
                Sort sessions by
              </label>
              <select
                id="dshmc-fleet-sort"
                className="dshmc-settings-select"
                value={normalizeFleetSort(settings.fleetSort)}
                onChange={(e) => updateSettings({ fleetSort: normalizeFleetSort(e.target.value) })}
              >
                {FLEET_SORT_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="dshmc-settings-sep">Pomodoro</div>
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-check dshmc-settings-label" htmlFor="dshmc-pomo-enabled">
                Show break timer
              </label>
              <input
                id="dshmc-pomo-enabled"
                className="dshmc-settings-box"
                type="checkbox"
                checked={settings.pomodoroEnabled}
                onChange={(e) => updateSettings({ pomodoroEnabled: e.target.checked })}
              />
            </div>
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-label" htmlFor="dshmc-pomo-work">Focus minutes</label>
              <input
                id="dshmc-pomo-work"
                className="dshmc-settings-num"
                type="number"
                min={POMODORO_MIN_MINUTES}
                max={POMODORO_MAX_MINUTES}
                value={settings.workMinutes}
                onChange={(e) => updateSettings({ workMinutes: normalizeMinutes(e.target.value, DEFAULT_WORK_MINUTES) })}
              />
            </div>
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-label" htmlFor="dshmc-pomo-break">Break minutes</label>
              <input
                id="dshmc-pomo-break"
                className="dshmc-settings-num"
                type="number"
                min={POMODORO_MIN_MINUTES}
                max={POMODORO_MAX_MINUTES}
                value={settings.breakMinutes}
                onChange={(e) => updateSettings({ breakMinutes: normalizeMinutes(e.target.value, DEFAULT_BREAK_MINUTES) })}
              />
            </div>
            <div className="dshmc-settings-row">
              <label className="dshmc-settings-label" htmlFor="dshmc-pomo-long">Long break minutes</label>
              <input
                id="dshmc-pomo-long"
                className="dshmc-settings-num"
                type="number"
                min={POMODORO_MIN_MINUTES}
                max={POMODORO_MAX_MINUTES}
                value={settings.longBreakMinutes}
                onChange={(e) => updateSettings({ longBreakMinutes: normalizeMinutes(e.target.value, DEFAULT_LONG_BREAK_MINUTES) })}
              />
            </div>
            <div className="dshmc-settings-hint">
              A long break replaces the short one every {POMODORO_LONG_EVERY} focus stretches.
            </div>
          </div>
        ) : null}
        <div className="dshmc-modes">
          <button className={`dshmc-mode${mode === 'fleet' ? ' on' : ''}`} onClick={() => setMode('fleet')}>Fleet</button>
          <button className={`dshmc-mode${mode === 'inbox' ? ' on' : ''}`} onClick={() => setMode('inbox')}>
            Inbox{pendingRows.length > 0 ? <span className="dshmc-mode-badge">{pendingRows.length}</span> : null}
          </button>
          <button className="dshmc-mode" onClick={() => setStageOpen(true)} title="Full-screen live grid">Stage</button>
        </div>
        {mode === 'inbox' ? (
          <div className="dshmc-body">
            <InboxView ctx={ctx} list={list} pendingRows={pendingRows} pendingWaits={pendingWaits} counts={counts} onOpen={openSession} now={nowTick} />
          </div>
        ) : (
        <div className="dshmc-body">
          <SearchBox ctx={ctx} list={list} onOpen={openSession} />
          <div className="dshmc-stats">
            <StatCard value={counts.sessions} label="sessions" />
            <StatCard value={counts.running} label="running" tone="live" />
            <StatCard value={counts.subagents} label="subagents" tone="swarm" />
            <StatCard value={pendingRows.length} label="waiting" tone="waiting" />
          </div>

          <div className="dshmc-section">Fleet</div>
          {groups.length === 0 ? (
            <div className="dshmc-empty">No sessions yet.</div>
          ) : (
            limitedGroups.map((group) => (
              <GroupView
                key={group.key}
                ctx={ctx}
                group={group}
                collapsed={!!collapsedGroups[group.key]}
                onToggle={() => toggleGroup(group.key)}
                expanded={expandedGroups.has(group.key)}
                onToggleExpanded={() => toggleGroupExpanded(group.key)}
                current={list.current}
                onSelect={selectSession}
                modelDirs={modelDirs}
                rate={pulse.rate}
                collapsedRows={collapsedRows}
                onToggleRow={toggleRowCollapsed}
              />
            ))
          )}
        </div>
        )}
        {settings.pomodoroEnabled ? (
          <PomodoroBar config={pomodoroConfig} />
        ) : null}
      </div>
      {!open ? (
        <button
          className={`dshmc-reopen${counts.active > 0 ? ' is-live' : pendingRows.length > 0 ? ' is-waiting' : ''}`}
          onClick={reopen}
          title="Open Mission Control"
        >
          {/* Collapsed label: only non-zero facets, so a quiet panel reads
              "Mission Control" rather than a row of zeros. */}
          {[
            counts.running > 0 ? `${counts.running} running` : '',
            counts.subagents > 0 ? `${counts.subagents} subagents` : '',
            pendingRows.length > 0 ? `${pendingRows.length} waiting` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'Mission Control'}
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: register Mission Control into the additive shell.overlay seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-mission-control' },
          () => React.createElement(MissionControl, { ctx }),
        ),
      ),
    'dsh-mission-control: shell.overlay registration',
  )

  // Mount the host state contract. `$mount` publishes the namespace
  // ASYNCHRONOUSLY as `remote.dshMissionControl`, so the load below waits on
  // ctx.inject for the service to exist rather than reading it directly
  // (which would capture undefined). An older install without the host half
  // simply never resolves the inject — the panel stays on localStorage.
  const anyCtx = ctx as never as {
    remote: { $mount: (c: unknown) => Promise<() => Promise<void>> }
    inject: (
      services: readonly string[],
      callback: (scoped: unknown) => void,
    ) => { dispose: () => void }
  }
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    let fiber: { dispose: () => void } | undefined
    // A runtime without the remote bridge (or an older install) leaves the
    // panel on localStorage — degradation, never a thrown shell.
    if (!anyCtx.remote || typeof anyCtx.remote.$mount !== 'function') return () => {}
    void anyCtx.remote
      .$mount(MC_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
        fiber = anyCtx.inject(['remote.dshMissionControl'], (scoped) => {
          hostRemote = (scoped as { remote: Record<string, HostStateRemote> }).remote.dshMissionControl
          void hostRemote
            .load({})
            .then((res) => {
              hostPayload = res?.state ?? null
            })
            .catch(() => {
              hostPayload = null
            })
            .finally(() => {
              hostLoaded = true
              for (const cb of hostListeners) cb(hostPayload)
              hostListeners.clear()
            })
        })
      })
      .catch((error: unknown) => {
        console.error('dsh-mission-control: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      fiber?.dispose()
      void unmount?.()
      hostRemote = null
      hostLoaded = false
      hostPayload = null
    }
  }, 'dsh-mission-control: mount host state remote')
}
