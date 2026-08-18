/** Personal stats for Clippy: streaks, sessions, balloons, and test counts,
 * persisted in the pi agent dir so Clippy has a memory of you across days and
 * projects. `PI_CLIPPY_STATS_DIR` overrides the location (used by tests). */
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ClippyStats {
  readonly lastActiveDate: string
  readonly streak: number
  readonly bestStreak: number
  readonly sessions: number
  readonly balloons: number
  readonly testsPassedToday: number
  readonly testsFailedToday: number
  readonly testsDate: string
  readonly lastGreetingDate: string
  /** Highest session entry id already counted for today's test stats. */
  readonly lastCountedId: string
  /** Missed-day tokens banked from balloon interactions. touchSession spends
   * one automatically to cover a single missed day instead of resetting. */
  readonly graceTokens: number
  /** Balloon count the last time a grace token was granted, so the next
   * grant is measured from there instead of from zero. */
  readonly graceWatermark: number
}

const DEFAULTS: ClippyStats = {
  lastActiveDate: '',
  streak: 0,
  bestStreak: 0,
  sessions: 0,
  balloons: 0,
  testsPassedToday: 0,
  testsFailedToday: 0,
  testsDate: '',
  lastGreetingDate: '',
  lastCountedId: '',
  graceTokens: 0,
  graceWatermark: 0,
}

/** Streak lengths that get a real celebration instead of a quiet increment. */
const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100, 200, 365]

/** How many balloon interactions earn one grace token, and the cap on how
 * many can be banked at once — insurance is a rare grace, not a currency. */
const GRACE_TOKEN_BALLOONS = 40
const MAX_GRACE_TOKENS = 2

/** The mock corporate ladder a streak climbs, longest tenure first. */
const STREAK_TITLES: ReadonlyArray<readonly [number, string]> = [
  [365, 'Chairman of the Board (Paperclip Division)'],
  [200, 'Executive Paperclip Emeritus'],
  [100, 'Vice President of Not Closing The Editor'],
  [50, 'Assistant Regional Manager of Uptime'],
  [30, 'Senior Office Assistant'],
  [14, 'Office Assistant, First Class'],
  [7, 'Junior Office Assistant'],
  [3, 'Associate Paperclip'],
  [0, 'Temp'],
]

/** The rank a streak of this length has earned. */
export function streakTitle(streak: number): string {
  for (const [min, title] of STREAK_TITLES) {
    if (streak >= min) return title
  }
  return 'Temp'
}

/** What actually happened to the streak on this session start — a plain
 * increment is the boring case; the others are what the greeting reacts to. */
export type StreakEvent =
  | { readonly kind: 'same-day' }
  | { readonly kind: 'started' }
  | { readonly kind: 'continued'; readonly streak: number; readonly milestone?: number }
  | { readonly kind: 'grace-saved'; readonly streak: number; readonly tokensLeft: number; readonly milestone?: number }
  | { readonly kind: 'broken'; readonly brokenStreak: number }

function statsFile(): string {
  const dir = process.env['PI_CLIPPY_STATS_DIR'] ?? getAgentDir()
  return join(dir, 'clippy-stats.json')
}

export function dateKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function yesterdayKey(now = new Date()): string {
  return dateKey(new Date(now.getTime() - 86_400_000))
}

export function loadStats(): ClippyStats {
  try {
    const parsed = JSON.parse(readFileSync(statsFile(), 'utf8')) as Partial<ClippyStats>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveStats(stats: ClippyStats): void {
  try {
    mkdirSync(dirname(statsFile()), { recursive: true })
    writeFileSync(statsFile(), JSON.stringify(stats, null, 2), 'utf8')
  } catch {
    // stats are best-effort
  }
}

/** Call once per session start: advances streak/session counters and reports
 * what happened to the streak, so the runtime can react (a milestone throws
 * a party, a break gets a real acknowledgment, a grace save says so). */
export function touchSession(now = new Date()): { readonly stats: ClippyStats; readonly event: StreakEvent } {
  const stats = loadStats()
  const today = dateKey(now)
  if (stats.lastActiveDate === today) {
    const next = { ...stats, sessions: stats.sessions + 1 }
    saveStats(next)
    return { stats: next, event: { kind: 'same-day' } }
  }
  const yesterday = yesterdayKey(now)
  const twoDaysAgo = dateKey(new Date(now.getTime() - 2 * 86_400_000))
  const milestoneOf = (value: number): number | undefined => STREAK_MILESTONES.includes(value) ? value : undefined
  let streak: number
  let graceTokens = stats.graceTokens
  let event: StreakEvent
  if (stats.lastActiveDate === yesterday) {
    streak = stats.streak + 1
    event = { kind: 'continued', streak, milestone: milestoneOf(streak) }
  } else if (stats.lastActiveDate === twoDaysAgo && stats.graceTokens > 0 && stats.streak >= 2) {
    streak = stats.streak + 1
    graceTokens -= 1
    event = { kind: 'grace-saved', streak, tokensLeft: graceTokens, milestone: milestoneOf(streak) }
  } else if (stats.streak >= 2) {
    streak = 1
    event = { kind: 'broken', brokenStreak: stats.streak }
  } else {
    streak = 1
    event = { kind: 'started' }
  }
  const bestStreak = Math.max(stats.bestStreak, streak)
  const next: ClippyStats = { ...stats, lastActiveDate: today, streak, bestStreak, sessions: stats.sessions + 1, graceTokens }
  saveStats(next)
  return { stats: next, event }
}

/** Every balloon shown is a chance to bank streak insurance: one grace token
 * per GRACE_TOKEN_BALLOONS balloons, capped so it stays a rare grace. */
export function bumpBalloons(): void {
  const stats = loadStats()
  const balloons = stats.balloons + 1
  let graceTokens = stats.graceTokens
  let graceWatermark = stats.graceWatermark
  if (balloons - graceWatermark >= GRACE_TOKEN_BALLOONS && graceTokens < MAX_GRACE_TOKENS) {
    graceTokens += 1
    graceWatermark = balloons
  }
  saveStats({ ...stats, balloons, graceTokens, graceWatermark })
}

const PASSED_RE = /\b(\d{1,6})\s+(?:tests?\s+)?passed\b/iu
const FAILED_RE = /\b(\d{1,6})\s+(?:tests?\s+)?failed\b/iu

/** Scan the tail of the session for test counts in tool results, counting
 * each toolResult once (tracked via `lastCountedId`) so repeated scans on
 * the same evidence do not inflate today's totals. */
export function recordTestResultsFromEntries(entries: readonly SessionEntry[]): void {
  const stats = loadStats()
  const today = dateKey()
  const base = stats.testsDate === today ? stats : { ...stats, testsPassedToday: 0, testsFailedToday: 0 }
  const lastNum = base.lastCountedId === '' ? -Infinity : Number(base.lastCountedId)
  let passed = base.testsPassedToday
  let failed = base.testsFailedToday
  let lastId = base.lastCountedId
  let touched = false
  const window = entries.slice(-30)
  // Where the last counted entry sits in this window, so non-numeric ids
  // (uuids and the like) still dedupe: without the positional fallback the
  // numeric compare silently did nothing and every rescan re-counted the
  // same test run into today's totals.
  const countedAt = base.lastCountedId === ''
    ? -1
    : window.findIndex(entry => entry.id === base.lastCountedId)
  for (const [index, entry] of window.entries()) {
    if (entry.type !== 'message') continue
    const message = entry.message
    if (message.role !== 'toolResult') continue
    const idNum = Number(entry.id)
    const alreadyCounted = Number.isFinite(lastNum) && Number.isFinite(idNum)
      ? idNum <= lastNum
      : index <= countedAt
    if (alreadyCounted) continue
    let text = ''
    for (const block of message.content) {
      if (block.type === 'text') text += ` ${block.text}`
    }
    const passedCount = PASSED_RE.exec(text)?.[1]
    const failedCount = FAILED_RE.exec(text)?.[1]
    if (passedCount === undefined && failedCount === undefined) continue
    // Entries arrive in order, so the last one counted is the new watermark.
    lastId = entry.id
    passed += passedCount === undefined ? 0 : Number(passedCount)
    failed += failedCount === undefined ? 0 : Number(failedCount)
    touched = true
  }
  if (!touched) return
  saveStats({ ...base, testsDate: today, testsPassedToday: passed, testsFailedToday: failed, lastCountedId: lastId })
}

export function alreadyGreetedToday(now = new Date()): boolean {
  return loadStats().lastGreetingDate === dateKey(now)
}

export function markGreeted(now = new Date()): void {
  const stats = loadStats()
  saveStats({ ...stats, lastGreetingDate: dateKey(now) })
}

/** One Clippy-style statement from the stats. */
export function greetingStatement(stats: ClippyStats): string {
  if (stats.streak >= 2) return `you are on a ${stats.streak}-day streak`
  if (stats.testsPassedToday > 0) return `you have passed ${stats.testsPassedToday} tests today`
  if (stats.sessions > 1) return `you are back for session number ${stats.sessions}`
  return 'you are getting started on a fresh day'
}

/** The greeting, plus the rank the streak has actually earned — for
 * /clippy stats, where the title is the whole point. */
export function statsStatement(stats: ClippyStats): string {
  return `${greetingStatement(stats)}, and you currently rank as our ${streakTitle(stats.streak)}`
}

/** A streak milestone: real fanfare, not a quiet increment. */
export function milestoneStatement(streak: number): string {
  return `you have hit a ${streak}-day streak, making you our new ${streakTitle(streak)}`
}

/** The streak just broke. Cited by exact number, not softened. */
export function mourningStatement(brokenStreak: number): string {
  return `your ${brokenStreak}-day streak just ended`
}

/** A missed day was covered by a banked grace token instead of a reset. */
export function graceSavedStatement(streak: number, tokensLeft: number): string {
  const tokenWord = tokensLeft === 1 ? 'token' : 'tokens'
  return `you missed a day, and I have chosen to overlook it — your streak stands at ${streak}, `
    + `with ${tokensLeft} grace ${tokenWord} left. Do not make this a habit`
}
