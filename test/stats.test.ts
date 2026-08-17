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

const { loadStats, recordTestResultsFromEntries, greetingStatement, touchSession } = await import('../src/stats.ts')

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
const session = touchSession()
check('a session starts a streak', session.streak >= 1 && session.sessions >= 1)
check('the greeting is a statement that can follow "It looks like"',
  /^you\b/u.test(greetingStatement(loadStats())), greetingStatement(loadStats()))

rmSync(dir, { recursive: true, force: true })

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
