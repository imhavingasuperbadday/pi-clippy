/** Personal stats (src/stats.ts): the daily counters, and above all the
 * "count each test run once" rule. A rescan of the same session evidence
 * happens on every balloon, so a dedup that only works for numeric entry ids
 * quietly inflated today's totals on sessions whose ids are uuids. */
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'pi-clippy-stats-'))
process.env['PI_CLIPPY_STATS_DIR'] = dir

const {
  bumpBalloons,
  graceSavedStatement,
  greetingStatement,
  loadStats,
  milestoneStatement,
  mourningStatement,
  recordTestResultsFromEntries,
  statsStatement,
  streakTitle,
  touchSession,
} = await import('../src/stats.ts')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** One toolResult entry carrying a test summary line. */
function toolResult(id: string, text: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: 'toolResult',
      toolCallId: `call-${id}`,
      toolName: 'bash',
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: Date.now(),
    },
  } as SessionEntry
}

// --- Numeric entry ids: a rescan must not re-count -------------------------
const numeric = [toolResult('1', '12 tests passed, 2 failed')]
recordTestResultsFromEntries(numeric)
recordTestResultsFromEntries(numeric)
recordTestResultsFromEntries(numeric)
const afterNumeric = loadStats()
check('numeric ids count one test run once', afterNumeric.testsPassedToday === 12 && afterNumeric.testsFailedToday === 2,
  `${afterNumeric.testsPassedToday}/${afterNumeric.testsFailedToday}`)

// --- A later run adds to the day's totals ----------------------------------
recordTestResultsFromEntries([...numeric, toolResult('2', '3 tests passed')])
const afterSecond = loadStats()
check('a new run adds to the day', afterSecond.testsPassedToday === 15 && afterSecond.testsFailedToday === 2,
  `${afterSecond.testsPassedToday}/${afterSecond.testsFailedToday}`)

// --- Non-numeric (uuid-style) ids dedupe positionally ----------------------
rmSync(join(dir, 'clippy-stats.json'), { force: true })
const uuids = [toolResult('a1b2-c3', '7 tests passed'), toolResult('d4e5-f6', '1 failed')]
recordTestResultsFromEntries(uuids)
recordTestResultsFromEntries(uuids)
recordTestResultsFromEntries(uuids)
const afterUuid = loadStats()
check('uuid ids count one test run once', afterUuid.testsPassedToday === 7 && afterUuid.testsFailedToday === 1,
  `${afterUuid.testsPassedToday}/${afterUuid.testsFailedToday}`)

recordTestResultsFromEntries([...uuids, toolResult('99zz-xx', '4 tests passed')])
const afterUuidSecond = loadStats()
check('a new uuid run adds to the day', afterUuidSecond.testsPassedToday === 11,
  String(afterUuidSecond.testsPassedToday))

// --- Session counters and the greeting -------------------------------------
const { stats: session, event: firstEvent } = touchSession()
check('a session starts a streak', session.streak >= 1 && session.sessions >= 1)
check('the first-ever session reports "started"', firstEvent.kind === 'started', firstEvent.kind)
check('the greeting is a statement that can follow "It looks like"',
  /^you\b/u.test(greetingStatement(loadStats())), greetingStatement(loadStats()))

// --- A milestone lands exactly on day 3, with the day counted right -------
rmSync(join(dir, 'clippy-stats.json'), { force: true })
const day = (n: number): Date => new Date(2026, 0, n, 12)
touchSession(day(1))
touchSession(day(2))
const { event: day3Event } = touchSession(day(3))
check('day 3 continues the streak to 3', day3Event.kind === 'continued' && day3Event.streak === 3,
  JSON.stringify(day3Event))
check('day 3 is a milestone', day3Event.kind === 'continued' && day3Event.milestone === 3, JSON.stringify(day3Event))

// --- Skipping a day with no grace tokens breaks the streak, by name -------
const { stats: afterBreak, event: breakEvent } = touchSession(day(5))
check('a two-day gap breaks the streak', breakEvent.kind === 'broken' && breakEvent.brokenStreak === 3,
  JSON.stringify(breakEvent))
check('the streak restarts at 1 after a break', afterBreak.streak === 1, String(afterBreak.streak))
check('bestStreak survives the break', afterBreak.bestStreak === 3, String(afterBreak.bestStreak))

// --- A banked grace token covers exactly one missed day --------------------
rmSync(join(dir, 'clippy-stats.json'), { force: true })
touchSession(day(10))
touchSession(day(11))
for (let i = 0; i < 40; i += 1) bumpBalloons()
check('40 balloons bank a grace token', loadStats().graceTokens === 1, String(loadStats().graceTokens))
const { stats: afterGrace, event: graceEvent } = touchSession(day(13))
check('a one-day gap with a token saves the streak', graceEvent.kind === 'grace-saved' && graceEvent.streak === 3,
  JSON.stringify(graceEvent))
check('the spent token is gone', afterGrace.graceTokens === 0, String(afterGrace.graceTokens))
// A second gap right after has no token left, so it breaks normally.
const { event: secondGapEvent } = touchSession(day(15))
check('with no tokens left, the next gap breaks normally', secondGapEvent.kind === 'broken', secondGapEvent.kind)

// --- Rank titles and statement shapes ---------------------------------------
check('streakTitle climbs the ladder', streakTitle(0) === 'Temp' && streakTitle(3) === 'Associate Paperclip'
  && streakTitle(100) === 'Vice President of Not Closing The Editor' && streakTitle(365).includes('Chairman'))
check('statsStatement can follow "It looks like"', /^you\b/u.test(statsStatement(loadStats())))
check('milestoneStatement can follow "It looks like"', /^you\b/u.test(milestoneStatement(7)))
check('mourningStatement names the exact number lost', mourningStatement(12).includes('12'))
check('graceSavedStatement can follow "It looks like"', /^you\b/u.test(graceSavedStatement(5, 1)))

rmSync(dir, { recursive: true, force: true })

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
