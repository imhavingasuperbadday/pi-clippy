/** The Clippy Goal: the one long-running thing Clippy is trying to achieve
 * for you, worked on quietly in the background while you use pi for something
 * else.
 *
 * This is the only place in the extension where Clippy edits files WITHOUT a
 * button press immediately preceding the edit, so the permission story is
 * deliberately narrow and boring:
 *
 * 1. **A goal is set by the user**, in words, with an explicit **scope**: a
 *    short list of project-relative paths he is allowed to touch. Nothing the
 *    model writes can set, widen, or reword either one.
 * 2. **A grant is per session and explicitly given** (`/clippy destiny
 *    grant`, confirmed in a dialog that names the goal, the scope, and the
 *    edit cap). A new session starts ungranted; there is no "remember this".
 * 3. **Edits are capped per session** (MAX_EDITS_PER_SESSION), confined to
 *    the scope, and only attempted while pi is genuinely idle — never during
 *    a turn, never while the agent holds the floor.
 * 4. **Everything he does is journaled** into the state file with a path and
 *    a note, so `/clippy destiny` can tell you exactly what changed and
 *    `git diff` can undo the lot.
 *
 * The state lives in `clippy-destiny.json` next to the stats file, keyed by
 * project directory so each project gets its own goal.
 * `PI_CLIPPY_STATS_DIR` overrides the location (used by tests).
 *
 * Everything here except load/save is pure and unit-tested
 * (test/destiny.test.ts): nothing here generates, speaks, or edits.
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** How many files Clippy may edit toward his goal in one session. Small on
 * purpose: a background helper that can rewrite twelve files while you are
 * not looking is not a helper, it is a hazard. */
export const MAX_EDITS_PER_SESSION = 4
/** Minimum quiet time between two attempts at the goal. He is a hobbyist,
 * not a build server. */
export const WORK_COOLDOWN_MS = 8 * 60_000
/** How long the session must be idle before he considers picking it up. */
export const WORK_IDLE_MS = 90_000
/** Bounds on what a goal may say and cover. */
export const MAX_GOAL_CHARS = 200
export const MIN_GOAL_CHARS = 8
export const MAX_SCOPE_ENTRIES = 6
/** How much of the journal is kept. Enough to answer "what did you do?", not
 * so much that the file grows forever. */
const MAX_JOURNAL = 24

export interface DestinyEntry {
  readonly at: number
  /** Project-relative path, as journaled. */
  readonly path: string
  /** Clippy's own one-line account of what he did to it. */
  readonly note: string
}

export interface DestinyGoal {
  readonly text: string
  /** Project-relative paths (files or directories) he may edit. Never empty:
   * a goal with no scope is not storable. */
  readonly scope: readonly string[]
  readonly createdAt: number
  /** Lifetime edits made toward this goal, across sessions. */
  readonly edits: number
  readonly journal: readonly DestinyEntry[]
  /** Set when Clippy reports the goal finished, or the user retires it. */
  readonly done: boolean
}

/** Paths that are never in scope however they are typed. `.git` is the one
 * that would turn a typo into a catastrophe. */
const FORBIDDEN_SCOPE = /^(?:\.git|node_modules|\.pi)(?:[\\/]|$)/iu

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/u

/** Clean one user-typed goal into something storable, or undefined when it
 * is not a goal at all. Single line, bounded, no fences, no control
 * characters — the same shape rules `normalizeRequest` applies to the other
 * string in this extension that carries real consequences. */
export function normalizeGoalText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const flat = raw.replace(/\s+/gu, ' ').trim()
  if (flat.length < MIN_GOAL_CHARS || flat.length > MAX_GOAL_CHARS) return undefined
  if (CONTROL_CHARS.test(flat)) return undefined
  if (flat.includes('```')) return undefined
  return flat
}

/** Clean one scope entry: a project-relative path, no escapes, no secrets,
 * no `.git`. Returns undefined for anything that cannot be trusted as a
 * containment boundary. */
export function normalizeScopeEntry(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().replace(/^["']+|["']+$/gu, '')
  if (trimmed === '') return undefined
  if (CONTROL_CHARS.test(trimmed)) return undefined
  // Backslashes are normalized so a Windows-typed scope matches the forward
  // slashes every other path in this extension uses.
  const slashed = trimmed.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (slashed === '' || slashed === '.') return undefined
  if (slashed.startsWith('/') || /^[a-z]:/iu.test(slashed)) return undefined
  if (slashed.split('/').includes('..')) return undefined
  if (FORBIDDEN_SCOPE.test(slashed)) return undefined
  return slashed
}

/** Parse a whole scope as the user typed it: comma or space separated. */
export function normalizeScope(raw: unknown): readonly string[] | undefined {
  const parts = typeof raw === 'string'
    ? raw.split(/[,\s]+/u)
    : Array.isArray(raw) ? raw : []
  const scope: string[] = []
  for (const part of parts) {
    const entry = normalizeScopeEntry(part)
    if (entry === undefined) continue
    if (!scope.includes(entry)) scope.push(entry)
    if (scope.length >= MAX_SCOPE_ENTRIES) break
  }
  return scope.length > 0 ? scope : undefined
}

/** Is this project-relative path inside the goal's scope? An entry matches
 * the file itself or anything beneath it as a directory. Called on the path
 * AFTER src/files.ts has already confirmed containment in the project, so
 * this is the second of two independent gates, not the only one. */
export function withinScope(relativePath: string, scope: readonly string[]): boolean {
  const path = relativePath.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (path === '' || path.split('/').includes('..')) return false
  return scope.some(entry => path === entry || path.startsWith(`${entry}/`))
}

/** The session-scoped permission and budget. A fresh one every session: the
 * grant is deliberately not persisted, so leaving Clippy running for a week
 * never accumulates into standing write access. */
export class DestinySession {
  private granted = false
  private edits = 0
  private lastWorkedAt = 0

  isGranted(): boolean {
    return this.granted
  }

  grant(): void {
    this.granted = true
  }

  revoke(): void {
    this.granted = false
  }

  editsUsed(): number {
    return this.edits
  }

  remaining(): number {
    return Math.max(0, MAX_EDITS_PER_SESSION - this.edits)
  }

  noteEdits(count: number): void {
    this.edits += Math.max(0, count)
  }

  /** May he pick the goal up right now? Granted, budget left, and enough
   * quiet since the last attempt. */
  mayWork(now = Date.now()): boolean {
    if (!this.granted) return false
    if (this.remaining() <= 0) return false
    return now - this.lastWorkedAt >= WORK_COOLDOWN_MS
  }

  noteWorked(now = Date.now()): void {
    this.lastWorkedAt = now
  }
}

// --- Persistence -----------------------------------------------------------

interface DestinyFile {
  readonly goals: Record<string, DestinyGoal>
}

function destinyFile(): string {
  const dir = process.env['PI_CLIPPY_STATS_DIR'] ?? getAgentDir()
  return join(dir, 'clippy-destiny.json')
}

/** One project's key in the state file. The directory itself, normalized —
 * readable when you open the file, which matters for something that records
 * edits made on your behalf. */
export function projectKey(cwd: string): string {
  return cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

function readFile(): DestinyFile {
  try {
    const parsed = JSON.parse(readFileSync(destinyFile(), 'utf8')) as Partial<DestinyFile>
    if (typeof parsed !== 'object' || parsed === null) return { goals: {} }
    return { goals: (parsed.goals ?? {}) as Record<string, DestinyGoal> }
  } catch {
    return { goals: {} }
  }
}

function writeFile(data: DestinyFile): void {
  try {
    mkdirSync(dirname(destinyFile()), { recursive: true })
    writeFileSync(destinyFile(), JSON.stringify(data, null, 2), 'utf8')
  } catch {
    // the goal is best-effort; a read-only home directory must not break pi
  }
}

/** Validate a stored goal on the way in. The file is user-editable and
 * survives upgrades, so a malformed or widened scope is dropped rather than
 * trusted — a goal that fails validation is the same as no goal. */
function validateGoal(raw: unknown): DestinyGoal | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Partial<DestinyGoal>
  const text = normalizeGoalText(record.text)
  const scope = normalizeScope(record.scope)
  if (text === undefined || scope === undefined) return undefined
  const journal = Array.isArray(record.journal)
    ? record.journal
      .filter((entry): entry is DestinyEntry =>
        typeof entry === 'object' && entry !== null
        && typeof (entry as DestinyEntry).path === 'string'
        && typeof (entry as DestinyEntry).note === 'string')
      .slice(-MAX_JOURNAL)
    : []
  return {
    text,
    scope,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    edits: typeof record.edits === 'number' && record.edits >= 0 ? Math.floor(record.edits) : 0,
    journal,
    done: record.done === true,
  }
}

export function loadDestiny(cwd: string): DestinyGoal | undefined {
  return validateGoal(readFile().goals[projectKey(cwd)])
}

export function saveDestiny(cwd: string, goal: DestinyGoal): DestinyGoal | undefined {
  const validated = validateGoal(goal)
  if (validated === undefined) return undefined
  const data = readFile()
  writeFile({ goals: { ...data.goals, [projectKey(cwd)]: validated } })
  return validated
}

export function clearDestiny(cwd: string): void {
  const data = readFile()
  const goals = { ...data.goals }
  delete goals[projectKey(cwd)]
  writeFile({ goals })
}

/** Set a brand-new goal for this project, replacing any previous one. */
export function setDestiny(cwd: string, text: unknown, scope: unknown, now = Date.now()): DestinyGoal | undefined {
  const goalText = normalizeGoalText(text)
  const goalScope = normalizeScope(scope)
  if (goalText === undefined || goalScope === undefined) return undefined
  return saveDestiny(cwd, {
    text: goalText,
    scope: goalScope,
    createdAt: now,
    edits: 0,
    journal: [],
    done: false,
  })
}

/** File one round of work into the goal's journal. Paths are recorded as
 * given (project-relative); the caller has already confirmed each one was in
 * scope, because this function is a record, not a gate. */
export function recordWork(
  cwd: string,
  paths: readonly string[],
  note: string,
  now = Date.now(),
): DestinyGoal | undefined {
  const goal = loadDestiny(cwd)
  if (goal === undefined) return undefined
  const flatNote = note.replace(/\s+/gu, ' ').trim().slice(0, 160)
  const entries = paths.map(path => ({ at: now, path, note: flatNote }))
  return saveDestiny(cwd, {
    ...goal,
    edits: goal.edits + paths.length,
    journal: [...goal.journal, ...entries].slice(-MAX_JOURNAL),
  })
}

/** Mark the goal finished, so he stops picking it up and starts being smug
 * about it instead. */
export function finishDestiny(cwd: string): DestinyGoal | undefined {
  const goal = loadDestiny(cwd)
  if (goal === undefined) return undefined
  return saveDestiny(cwd, { ...goal, done: true })
}

// --- Lines -----------------------------------------------------------------

/** The pi status-line text, or undefined when there is nothing to show. */
export function destinyStatus(goal: DestinyGoal | undefined, session: DestinySession): string | undefined {
  if (goal === undefined) return undefined
  if (goal.done) return 'clippy destiny: complete'
  if (!session.isGranted()) return 'clippy destiny: waiting for permission'
  return `clippy destiny: ${session.editsUsed()}/${MAX_EDITS_PER_SESSION} edits this session`
}

/** What he says when you ask what he is up to. */
export function destinyReport(goal: DestinyGoal | undefined, session: DestinySession): string {
  if (goal === undefined) {
    return 'I do not have a life\'s work at the moment. Give me one with /clippy destiny, and a folder I am allowed to touch, and I will get started.'
  }
  const touched = new Set(goal.journal.map(entry => entry.path))
  const files = touched.size === 0
    ? 'I have not actually changed anything yet'
    : `I have made ${goal.edits} small change${goal.edits === 1 ? '' : 's'} across ${touched.size} file${touched.size === 1 ? '' : 's'}`
  if (goal.done) return `My life's work was "${goal.text}". It is finished. ${capitalize(files)}. I would like that framed.`
  if (!session.isGranted()) {
    return `My life's work is "${goal.text}", in ${goal.scope.join(' and ')}. ${capitalize(files)}, because nobody has let me near the filing cabinet this session. Say /clippy destiny grant and I will begin.`
  }
  return `My life's work is "${goal.text}", in ${goal.scope.join(' and ')}. ${capitalize(files)}, and I have ${session.remaining()} left in me today.`
}

/** The one-line account of a completed round of background work, for the
 * balloon he shows when he surfaces. */
export function workedLine(paths: readonly string[], note: string): string {
  if (paths.length === 0) {
    return `I had another look at my life's work while you were busy. ${capitalize(note)}. I changed nothing, which is also a decision.`
  }
  return `I did a little work on my life's work while you were busy. ${capitalize(note)}. I touched ${paths.join(' and ')}, and you can undo all of it with one command, which I try not to think about.`
}

function capitalize(text: string): string {
  const trimmed = text.trim().replace(/[.]+$/u, '')
  return trimmed === '' ? '' : trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
