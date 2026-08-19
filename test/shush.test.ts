/** Unit test for being told to shut up (src/shush.ts): the mute itself, the
 * timed mute that expires on its own, the bounded missed-events list, and
 * the catch-up line that makes silence cost something. */
import { catchUpLine, missedEventFor, ShushRegistry, shushStatement } from '../src/shush.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const NOW = 1_700_000_000_000

// --- the mute --------------------------------------------------------------
const registry = new ShushRegistry()
check('nobody starts shushed', !registry.isShushed('clippy', NOW))
registry.shush('clippy', NOW)
check('shushing silences the agent', registry.isShushed('clippy', NOW))
check('shushing one agent leaves the others alone', !registry.isShushed('bonzi', NOW))
check('an untimed mute does not expire', registry.isShushed('clippy', NOW + 86_400_000))
check('the mute records when it started', registry.since('clippy') === NOW)
check('shushed() lists the silenced', registry.shushed(NOW).join() === 'clippy')

// --- the timed mute (the typed "shut up") ---------------------------------
const timed = new ShushRegistry()
timed.shush('clippy', NOW, 60_000)
check('a timed mute is a mute', timed.isShushed('clippy', NOW + 1_000))
check('a timed mute expires on its own', !timed.isShushed('clippy', NOW + 61_000))
check('an expired mute is forgotten', timed.since('clippy') === undefined)

// --- the missed list -------------------------------------------------------
const missed = new ShushRegistry()
missed.note('clippy', 'a green test run', NOW)
check('nothing is filed against an agent who can talk', missed.unshush('clippy').length === 0)
missed.shush('clippy', NOW)
missed.note('clippy', 'a green test run', NOW)
missed.note('clippy', 'a green test run', NOW)
check('the same event is not filed twice', missed.unshush('clippy').length === 1)
missed.shush('clippy', NOW)
for (const event of ['one', 'two', 'three', 'four', 'five', 'six']) missed.note('clippy', event, NOW)
const kept = missed.unshush('clippy')
check('the missed list is bounded', kept.length === 4, `kept ${kept.length}`)
check('the bounded list keeps the most recent', kept[kept.length - 1] === 'six')
check('unshushing lets him talk again', !missed.isShushed('clippy', NOW))

// --- counters --------------------------------------------------------------
const counted = new ShushRegistry()
counted.shush('clippy', NOW)
counted.unshush('clippy')
counted.shush('clippy', NOW)
check('every shush is counted', counted.count('clippy') === 2)
check('an agent never shushed counts zero', counted.count('bonzi') === 0)
counted.clear()
check('clear() forgets everything', counted.count('clippy') === 0 && !counted.isShushed('clippy', NOW))

// --- the lines -------------------------------------------------------------
check('a quiet silence is somehow worse',
  catchUpLine([]).includes('somehow worse'))
check('one missed event is named with his reaction to it',
  catchUpLine(['a green test run']) === 'I can talk again? You missed a green test run AND my reaction to it.')
check('several missed events are listed',
  catchUpLine(['a green test run', 'a third failure in a row']).includes('and a third failure in a row'))
check('the stats line counts the minutes',
  shushStatement(NOW, NOW + 3 * 60_000) === 'you have had me silenced for 3 minutes')
check('one minute is singular',
  shushStatement(NOW, NOW + 60_000).endsWith('1 minute'))
check('missed events have names', missedEventFor('tests-failed') === 'a letter that ripped')

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
