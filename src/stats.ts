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
}

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

/** Call once per session start: advances streak/session counters. */
export function touchSession(now = new Date()): ClippyStats {
  const stats = loadStats()
  const today = dateKey(now)
  let streak = stats.streak
  let bestStreak = stats.bestStreak
  if (stats.lastActiveDate !== today) {
    streak = stats.lastActiveDate === yesterdayKey(now) ? streak + 1 : 1
    bestStreak = Math.max(bestStreak, streak)
  }
  const next: ClippyStats = { ...stats, lastActiveDate: today, streak, bestStreak, sessions: stats.sessions + 1 }
  saveStats(next)
  return next
}

export function bumpBalloons(): void {
  const stats = loadStats()
  saveStats({ ...stats, balloons: stats.balloons + 1 })
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
